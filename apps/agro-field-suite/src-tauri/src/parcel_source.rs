//! Trasporto nativo per le fonti di particelle (LPIS, catasto, INSPIRE).
//!
//! Il recupero avviene qui e non nel webview per tre ragioni concrete:
//!
//! * **CORS** — i geoportali pubblici quasi mai espongono gli header che il
//!   browser pretende. È lo stesso motivo per cui esiste `agro_fetch_map_tile`.
//! * **Concorrenza controllata** — i servizi regionali sono fragili: un
//!   semaforo tiene le richieste parallele entro un limite prudente invece di
//!   lasciare che sia il webview a decidere quante aprirne.
//! * **Superficie di rete governata** — il webview può chiedere di raggiungere
//!   solo gli host dichiarati dal catalogo, e mai un indirizzo interno.
//!
//! ## Il modello di minaccia, e cosa questo modulo garantisce davvero
//!
//! Il rischio non è l'utente: è che una voce di catalogo malevola (o un
//! reindirizzamento ostile) trasformi l'app in una sonda verso la rete privata
//! di chi la usa — il router di casa, un gestionale aziendale, un servizio di
//! metadati cloud. Tre difese, in ordine:
//!
//! 1. **Allow-list degli host**, registrata all'avvio a partire dal catalogo:
//!    resta un'unica fonte di verità (il catalogo JSON) e l'applicazione la
//!    fa rispettare qui, dove il webview non può aggirarla.
//! 2. **Blocco degli indirizzi non pubblici**: l'host viene risolto PRIMA della
//!    richiesta e ogni indirizzo di loopback, privato, link-local, CGNAT o
//!    unique-local fa fallire la chiamata.
//! 3. **Reindirizzamenti ricontrollati**: seguire un `302` verso `127.0.0.1`
//!    aggirerebbe entrambe le difese, quindi ogni salto è riverificato contro
//!    l'allow-list.
//!
//! Un limite che è giusto dichiarare invece di far finta che non ci sia: fra la
//! risoluzione DNS del controllo e quella della richiesta vera esiste una
//! finestra di rebinding. Chiuderla richiederebbe di forzare la connessione
//! sull'indirizzo già verificato; per fonti pubbliche di dati aperti, con host
//! su allow-list, il costo non è giustificato. Se un giorno si ammetteranno
//! host su rete privata (come previsto per i WMS aziendali), quella finestra va
//! chiusa prima.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::redirect::Policy;
use tauri::State;
use tokio::sync::Semaphore;

/// Richieste parallele ammesse. I portali regionali cedono ben prima dei limiti
/// di un browser: meglio una coda che una raffica.
const MAX_CONCURRENT_REQUESTS: usize = 4;

/// Tempo massimo per una singola richiesta, connessione inclusa.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Salti di reindirizzamento ammessi (ognuno riverificato sull'allow-list).
const MAX_REDIRECTS: usize = 5;

/// Tentativi totali per una richiesta (1 iniziale + 2 ripetizioni).
const MAX_ATTEMPTS: usize = 3;

/// Attesa prima della prima ripetizione; raddoppia a ogni tentativo.
const RETRY_BACKOFF: Duration = Duration::from_millis(500);

/// Tetto sulla risposta accettata: una pagina WFS legittima sta ampiamente
/// sotto, e senza un limite un servizio impazzito esaurirebbe la memoria del
/// dispositivo.
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

/// Host ammessi, semaforo di concorrenza e client HTTP riusato.
pub struct ParcelSourceTransport {
    hosts: Arc<Mutex<HashSet<String>>>,
    permits: Semaphore,
    client: reqwest::Client,
}

/// Normalizza un host per il confronto (i nomi DNS non sono case-sensitive).
fn normalize_host(host: &str) -> String {
    host.trim().trim_end_matches('.').to_ascii_lowercase()
}

/// True se l'host è nell'allow-list registrata dal catalogo.
fn host_allowed(hosts: &Arc<Mutex<HashSet<String>>>, host: &str) -> bool {
    match hosts.lock() {
        Ok(set) => set.contains(&normalize_host(host)),
        // Un lock avvelenato non deve diventare un permesso: si nega.
        Err(_) => false,
    }
}

/// True se l'indirizzo IPv4 NON è instradabile sulla rete pubblica.
fn is_private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        // 100.64.0.0/10 — CGNAT, non coperto da is_private().
        || (a == 100 && (64..128).contains(&b))
        // 0.0.0.0/8 — "questa rete".
        || a == 0
        // 192.0.0.0/24 — assegnazioni speciali IETF.
        || (ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 0)
}

/// True se l'indirizzo IPv6 NON è instradabile sulla rete pubblica.
fn is_private_v6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        // ::ffff:127.0.0.1 raggiunge il loopback quanto 127.0.0.1.
        return is_private_v4(mapped);
    }
    let first = ip.segments()[0];
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        // fc00::/7 — unique local.
        || (first & 0xfe00) == 0xfc00
        // fe80::/10 — link local.
        || (first & 0xffc0) == 0xfe80
}

/// True se l'indirizzo non è raggiungibile sulla rete pubblica.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_v4(v4),
        IpAddr::V6(v6) => is_private_v6(v6),
    }
}

/// Risolve l'host e fallisce se un solo indirizzo punta a una rete non pubblica.
///
/// Il controllo è su TUTTI gli indirizzi restituiti, non sul primo: un nome che
/// risolve a un indirizzo pubblico e a `127.0.0.1` sarebbe un aggiramento
/// perfettamente valido se ci si fermasse al primo.
async fn assert_public_host(host: &str, port: u16) -> Result<(), String> {
    let target = format!("{host}:{port}");
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        target
            .to_socket_addrs()
            .map(|addrs| addrs.map(|addr| addr.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| format!("Risoluzione DNS interrotta: {e}"))?
    .map_err(|e| format!("Host non risolvibile: {e}"))?;

    if resolved.is_empty() {
        return Err(format!("Host non risolvibile: {host}"));
    }
    if let Some(ip) = resolved.iter().copied().find(|ip| is_private_ip(*ip)) {
        return Err(format!(
            "L'host \"{host}\" risolve a un indirizzo non pubblico ({ip}): richiesta bloccata."
        ));
    }
    Ok(())
}

impl ParcelSourceTransport {
    /// Costruisce il trasporto con l'allow-list vuota: la popola il frontend
    /// all'avvio, a partire dal catalogo.
    pub fn new() -> Result<Self, String> {
        let hosts: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let redirect_hosts = Arc::clone(&hosts);
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(Policy::custom(move |attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS {
                    return attempt.error("troppi reindirizzamenti");
                }
                match attempt.url().host_str() {
                    // Ogni salto è riverificato: è il punto in cui un
                    // reindirizzamento verso la rete interna viene fermato.
                    Some(host) if host_allowed(&redirect_hosts, host) => attempt.follow(),
                    _ => attempt.error("reindirizzamento verso un host non consentito"),
                }
            }))
            .build()
            .map_err(|e| format!("Client HTTP non inizializzabile: {e}"))?;

        Ok(Self {
            hosts,
            permits: Semaphore::new(MAX_CONCURRENT_REQUESTS),
            client,
        })
    }
}

/// Legge il corpo della risposta fermandosi al tetto di {@link MAX_RESPONSE_BYTES}.
async fn read_body_capped(response: reqwest::Response) -> Result<String, String> {
    // Quando il servizio dichiara la lunghezza si rifiuta subito, senza
    // scaricare nulla.
    if let Some(declared) = response.content_length() {
        if declared > MAX_RESPONSE_BYTES as u64 {
            return Err(format!(
                "Risposta troppo grande ({declared} byte): il limite è {MAX_RESPONSE_BYTES}."
            ));
        }
    }
    let mut response = response;
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Lettura della risposta fallita: {e}"))?
    {
        if buffer.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(format!(
                "Risposta troppo grande: il limite è {MAX_RESPONSE_BYTES} byte."
            ));
        }
        buffer.extend_from_slice(&chunk);
    }
    String::from_utf8(buffer).map_err(|_| "La risposta non è testo UTF-8.".to_string())
}

/// True se vale la pena ritentare: guasti di rete e indisponibilità temporanee.
fn is_transient(status: Option<reqwest::StatusCode>) -> bool {
    match status {
        // Nessuno stato = errore di trasporto (connessione, timeout, DNS).
        None => true,
        Some(code) => code.is_server_error() || code.as_u16() == 429,
    }
}

/// Registra gli host che il trasporto può raggiungere, sostituendo i precedenti.
///
/// Li deriva il frontend dal catalogo delle fonti: così il catalogo resta
/// l'unica fonte di verità (nessun elenco duplicato in Rust che scivolerebbe
/// fuori sincrono), ma è questo modulo a farli rispettare.
#[tauri::command]
pub async fn agro_register_parcel_source_hosts(
    transport: State<'_, ParcelSourceTransport>,
    hosts: Vec<String>,
) -> Result<usize, String> {
    let normalized: HashSet<String> = hosts
        .iter()
        .map(|host| normalize_host(host))
        .filter(|host| !host.is_empty())
        .collect();
    let count = normalized.len();
    *transport
        .hosts
        .lock()
        .map_err(|_| "Allow-list degli host non accessibile.".to_string())? = normalized;
    Ok(count)
}

/// Recupera un documento da una fonte di particelle, restituendone il testo.
///
/// Fallisce — invece di restituire un risultato vuoto — quando l'URL non è
/// ammesso: una fonte bloccata e una fonte senza dati sono due fatti diversi, e
/// confonderli renderebbe impossibile capire perché una mappa resta vuota.
#[tauri::command]
pub async fn agro_fetch_parcel_source(
    transport: State<'_, ParcelSourceTransport>,
    url: String,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URL non valido: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Sono ammessi solo gli schemi http e https.".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL privo di host.".to_string())?
        .to_string();

    if !host_allowed(&transport.hosts, &host) {
        return Err(format!(
            "L'host \"{host}\" non è fra le fonti dichiarate nel catalogo."
        ));
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Porta non determinabile.".to_string())?;
    assert_public_host(&host, port).await?;

    // Il permesso si tiene per tutta la richiesta: è ciò che limita davvero le
    // connessioni aperte contemporaneamente verso i portali.
    let _permit = transport
        .permits
        .acquire()
        .await
        .map_err(|_| "Semaforo delle richieste non disponibile.".to_string())?;

    let mut backoff = RETRY_BACKOFF;
    let mut last_error = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let outcome = transport.client.get(parsed.clone()).send().await;
        let (status, error) = match outcome {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    return read_body_capped(response).await;
                }
                (
                    Some(status),
                    format!("Il servizio ha risposto {status}."),
                )
            }
            Err(e) => (None, format!("Richiesta fallita: {e}")),
        };

        last_error = error;
        if attempt == MAX_ATTEMPTS || !is_transient(status) {
            break;
        }
        tokio::time::sleep(backoff).await;
        backoff *= 2;
    }

    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocca_gli_indirizzi_non_pubblici() {
        for raw in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "172.16.0.1",
            "169.254.169.254", // metadati cloud: il bersaglio SSRF classico
            "100.64.0.1",      // CGNAT
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1", // loopback mascherato da IPv6
        ] {
            let ip: IpAddr = raw.parse().expect("indirizzo di prova valido");
            assert!(is_private_ip(ip), "{raw} doveva essere bloccato");
        }
    }

    #[test]
    fn lascia_passare_gli_indirizzi_pubblici() {
        for raw in ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            let ip: IpAddr = raw.parse().expect("indirizzo di prova valido");
            assert!(!is_private_ip(ip), "{raw} doveva passare");
        }
    }

    #[test]
    fn il_confronto_degli_host_ignora_maiuscole_e_punto_finale() {
        assert_eq!(normalize_host("Service.PDOK.nl."), "service.pdok.nl");
        assert_eq!(normalize_host("  example.org "), "example.org");
    }

    #[test]
    fn l_allow_list_ammette_solo_gli_host_registrati() {
        let hosts: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        hosts
            .lock()
            .expect("lock disponibile nel test")
            .insert("service.pdok.nl".to_string());

        assert!(host_allowed(&hosts, "service.pdok.nl"));
        // Stesso host scritto diversamente: deve comunque passare.
        assert!(host_allowed(&hosts, "Service.PDOK.nl."));
        // Un host non registrato è negato, e così un sottodominio che gli
        // somiglia: il confronto è sull'host intero, non su un prefisso.
        assert!(!host_allowed(&hosts, "evil.example.org"));
        assert!(!host_allowed(&hosts, "service.pdok.nl.evil.example.org"));
        assert!(!host_allowed(&hosts, "127.0.0.1"));
    }

    #[test]
    fn ritenta_solo_i_guasti_temporanei() {
        use reqwest::StatusCode;
        assert!(is_transient(None));
        assert!(is_transient(Some(StatusCode::INTERNAL_SERVER_ERROR)));
        assert!(is_transient(Some(StatusCode::TOO_MANY_REQUESTS)));
        // Un 404 non migliora ritentando: si fallisce subito.
        assert!(!is_transient(Some(StatusCode::NOT_FOUND)));
        assert!(!is_transient(Some(StatusCode::FORBIDDEN)));
    }
}
