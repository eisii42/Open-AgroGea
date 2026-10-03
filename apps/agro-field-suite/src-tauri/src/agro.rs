//! Comandi nativi AgroGea.
//!
//! * Keystore offline: la sessione (claims di licenza) è cifrata su disco con
//!   AES-256-GCM, chiave derivata dal PIN con Argon2id. Lo sblocco offline
//!   riesce solo se il PIN deriva la stessa chiave: nessun confronto di
//!   password in chiaro, nessun dato leggibile senza PIN.
//! * Sync on-premise: il batch dell'outbox è riversato direttamente nel
//!   PostgreSQL privato del cliente via tokio-postgres (rete locale/VPN).
//!   La stringa di connessione non transita mai nel JS: è risolta qui dal
//!   profilo cifrato salvato sul dispositivo.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use aes_gcm::aead::rand_core::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const OFFLINE_VAULT: &str = "agrogea-offline-session.vault";
const PROFILES_VAULT_PREFIX: &str = "agrogea-pg-profile-";
// Whitelist delle tabelle sincronizzabili verso il Postgres privato. DEVE
// restare identica a `SYNC_TABLES` in @agrogea/core (types.ts), stesso ordine:
// è il contratto del wire format dell'outbox, e `tests/agro-sync-tables.test.ts`
// fallisce se i due elenchi divergono. Una tabella assente da qui fa rifiutare
// ogni sua mutazione al push e la esclude dal pull. Le tabelle local-only
// (weather_config, dss_results, soil_water_indices, data_transfer_logs,
// product_catalogs, cache degli indici) NON si sincronizzano per definizione.
const TABELLE_SYNC: [&str; 27] = [
    "companies",
    "crops",
    "plots_registry",
    "plots_campaign",
    "treatment_logs",
    "weather_readings",
    "soil_samples",
    "infrastructure_assets",
    "harvest_logs",
    "scouting_observations",
    "tenant_memberships",
    // v23: magazzini e anagrafica prodotti/lotti.
    "warehouses",
    "products",
    "product_lots",
    "activity_products",
    // Parco macchine.
    "machines",
    "equipment",
    "activity_machines",
    "maintenance_schedules",
    "maintenance_logs",
    "machine_documents",
    "counter_adjustments",
    "fuel_refills",
    // Pianificazione e Modalità Campo.
    "recipes",
    "planned_tasks",
    "field_operation_sessions",
    // v25: soglie dei parametri di compliance spostate dall'utente.
    "compliance_parameter_overrides",
];

// ---------------------------------------------------------------------------
// Vault cifrato (PIN → Argon2id → AES-256-GCM)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct Vault {
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn vault_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir non disponibile: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

fn derive_key(pin: &str, salt: &[u8]) -> Result<Key<Aes256Gcm>, String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), salt, &mut key)
        .map_err(|e| format!("derivazione chiave fallita: {e}"))?;
    Ok(Key::<Aes256Gcm>::from(key))
}

fn seal(plaintext: &str, pin: &str) -> Result<Vault, String> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_key(pin, &salt)?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| "cifratura fallita".to_string())?;
    Ok(Vault {
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}

fn open(vault: &Vault, pin: &str) -> Result<String, String> {
    let salt = B64.decode(&vault.salt).map_err(|e| e.to_string())?;
    let nonce_bytes = B64.decode(&vault.nonce).map_err(|e| e.to_string())?;
    let ciphertext = B64.decode(&vault.ciphertext).map_err(|e| e.to_string())?;
    let key = derive_key(pin, &salt)?;
    let cipher = Aes256Gcm::new(&key);
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "PIN errato o archivio danneggiato".to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

fn write_vault(app: &AppHandle, name: &str, payload: &str, pin: &str) -> Result<(), String> {
    let vault = seal(payload, pin)?;
    let json = serde_json::to_string(&vault).map_err(|e| e.to_string())?;
    fs::write(vault_path(app, name)?, json).map_err(|e| e.to_string())
}

fn read_vault(app: &AppHandle, name: &str, pin: &str) -> Result<String, String> {
    let path = vault_path(app, name)?;
    let json = fs::read_to_string(&path)
        .map_err(|_| "nessuna sessione offline su questo dispositivo".to_string())?;
    let vault: Vault = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    open(&vault, pin)
}

// ---------------------------------------------------------------------------
// Comandi: sessione offline
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agro_store_offline_session(
    app: AppHandle,
    payload: String,
    pin: String,
) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN troppo corto (minimo 4 caratteri)".into());
    }
    write_vault(&app, OFFLINE_VAULT, &payload, &pin)
}

#[tauri::command]
pub fn agro_unlock_offline_session(app: AppHandle, pin: String) -> Result<String, String> {
    read_vault(&app, OFFLINE_VAULT, &pin)
}

/// Provisioning del profilo di connessione on-premise (fatto una tantum
/// dall'amministratore, online): la stringa di connessione è cifrata col PIN
/// del dispositivo e indicizzata dall'id profilo presente nelle claims.
#[tauri::command]
pub fn agro_store_connection_profile(
    app: AppHandle,
    profilo: String,
    connection_string: String,
    pin: String,
) -> Result<(), String> {
    let safe: String = profilo
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        return Err("id profilo non valido".into());
    }
    write_vault(
        &app,
        &format!("{PROFILES_VAULT_PREFIX}{safe}.vault"),
        &connection_string,
        &pin,
    )
}

// ---------------------------------------------------------------------------
// Comandi: push on-premise (tokio-postgres)
// ---------------------------------------------------------------------------

/// Mutazione dell'outbox come serializzata dal JS (`toWirePayload` in
/// @agrogea/core sync/targets.ts): i nomi dei campi sono il contratto.
#[derive(Deserialize)]
struct WireMutation {
    mutation_id: String,
    table_name: String,
    row_id: String,
    operation: String,
    payload: Option<serde_json::Value>,
    mutated_at: String,
    device_id: String,
}

#[derive(Serialize)]
pub struct PushResult {
    applied: u32,
    skipped_lww: u32,
    duplicates: u32,
}

// ---------------------------------------------------------------------------
// Connessione PostgreSQL on-premise (TLS opzionale via sslmode)
// ---------------------------------------------------------------------------

/// Modalità TLS desunta da `sslmode` nella stringa di connessione (semantica
/// libpq).
#[derive(Debug, PartialEq)]
enum SslMode {
    /// Nessun TLS (`disable`): solo su scelta esplicita.
    Disable,
    /// TLS se il server lo offre, altrimenti in chiaro, senza verifica del
    /// certificato (`prefer`/`allow`; default libpq se `sslmode` è assente).
    Prefer,
    /// TLS obbligatorio senza verifica del certificato (`require`: server
    /// privato/self-signed).
    Require,
    /// TLS obbligatorio, catena verificata col trust store di sistema, nome host
    /// non verificato (`verify-ca`).
    VerifyCa,
    /// TLS obbligatorio, catena e nome host verificati (`verify-full`).
    VerifyFull,
}

/// Legge `sslmode` e restituisce la stringa di connessione con un valore che
/// tokio-postgres sa interpretare: accetta solo `disable`/`prefer`/`require`,
/// quindi `allow` diventa `prefer` e `verify-*` diventano `require` (la verifica
/// la fa il connettore TLS). Un valore sconosciuto resta invariato, così
/// tokio-postgres lo rifiuta con un errore esplicito invece di ripiegare in
/// silenzio sul chiaro.
fn normalize_sslmode(conn: &str) -> (SslMode, String) {
    // to_ascii_lowercase preserva le posizioni in byte (password non ASCII).
    let lower = conn.to_ascii_lowercase();
    let Some(idx) = lower.find("sslmode=") else {
        return (SslMode::Prefer, conn.to_string());
    };
    let start = idx + "sslmode=".len();
    let end = lower[start..]
        .find([' ', '&'])
        .map_or(conn.len(), |offset| start + offset);
    let (mode, value) = match &lower[start..end] {
        "disable" => (SslMode::Disable, "disable"),
        "allow" | "prefer" => (SslMode::Prefer, "prefer"),
        "require" => (SslMode::Require, "require"),
        "verify-ca" => (SslMode::VerifyCa, "require"),
        "verify-full" => (SslMode::VerifyFull, "require"),
        _ => return (SslMode::Require, conn.to_string()),
    };
    (mode, format!("{}{}{}", &conn[..start], value, &conn[end..]))
}

/// Apre una connessione al PostgreSQL on-premise scegliendo il TLS in base a
/// `sslmode` (vedi {@link SslMode}). Avvia il task della connessione in
/// background e ritorna solo il Client.
async fn connect_pg(conn_string: &str) -> Result<tokio_postgres::Client, String> {
    fn fail(e: tokio_postgres::Error) -> String {
        format!("connessione PostgreSQL on-premise fallita: {e}")
    }
    let (mode, conn) = normalize_sslmode(conn_string);
    if mode == SslMode::Disable {
        let (client, connection) = tokio_postgres::connect(&conn, tokio_postgres::NoTls)
            .await
            .map_err(fail)?;
        tauri::async_runtime::spawn(async move {
            if let Err(e) = connection.await {
                log::error!("connessione on-premise interrotta: {e}");
            }
        });
        return Ok(client);
    }
    let mut builder = native_tls::TlsConnector::builder();
    match mode {
        // Semantica libpq di prefer/require: cifra ma non verifica (self-signed).
        SslMode::Prefer | SslMode::Require => {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        SslMode::VerifyCa => {
            builder.danger_accept_invalid_hostnames(true);
        }
        SslMode::VerifyFull | SslMode::Disable => {}
    }
    let connector = builder
        .build()
        .map_err(|e| format!("inizializzazione TLS fallita: {e}"))?;
    let tls = postgres_native_tls::MakeTlsConnector::new(connector);
    let (client, connection) = tokio_postgres::connect(&conn, tls).await.map_err(fail)?;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connection.await {
            log::error!("connessione on-premise interrotta: {e}");
        }
    });
    Ok(client)
}

/// Risolve la stringa di connessione dal vault cifrato del profilo. La stringa
/// non transita mai dal JS: vive solo qui, decifrata col PIN del dispositivo.
fn resolve_connection_string(
    app: &AppHandle,
    profilo: &str,
    pin: Option<&str>,
) -> Result<String, String> {
    let safe: String = profilo
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    read_vault(
        app,
        &format!("{PROFILES_VAULT_PREFIX}{safe}.vault"),
        pin.unwrap_or(""),
    )
    .map_err(|e| format!("profilo on-premise '{profilo}' non disponibile: {e}"))
}

/// Colonne aggiornabili della tabella (esclude chiavi e colonne server-side),
/// lette da information_schema così lo schema può evolvere senza toccare Rust.
async fn updatable_columns(
    client: &tokio_postgres::Client,
    tabella: &str,
) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1
               and column_name not in ('id', 'tenant_id', 'created_at', 'geom')",
            &[&tabella],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

#[tauri::command]
pub async fn agro_push_mutations(
    app: AppHandle,
    profilo: String,
    tenant_id: String,
    mutations: String,
    pin: Option<String>,
) -> Result<PushResult, String> {
    let batch: Vec<WireMutation> =
        serde_json::from_str(&mutations).map_err(|e| format!("batch non valido: {e}"))?;

    // Risolve la connessione dal vault e apre (TLS opzionale via sslmode).
    let conn_string = resolve_connection_string(&app, &profilo, pin.as_deref())?;
    let client = connect_pg(&conn_string).await?;

    let mut result = PushResult {
        applied: 0,
        skipped_lww: 0,
        duplicates: 0,
    };
    // Clausola di upsert per tabella, costruita una volta per batch: evita di
    // interrogare information_schema a ogni mutazione (N query → 1 per tabella).
    let mut set_clause_cache: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for m in batch {
        if !TABELLE_SYNC.contains(&m.table_name.as_str()) {
            return Err(format!("tabella non sincronizzabile: {}", m.table_name));
        }
        let mutation_uuid: uuid::Uuid = m.mutation_id.parse().map_err(|e| format!("{e}"))?;
        let riga_uuid: uuid::Uuid = m.row_id.parse().map_err(|e| format!("{e}"))?;
        let tenant_uuid: uuid::Uuid = tenant_id.parse().map_err(|e| format!("{e}"))?;

        // Idempotenza: pista di audit condivisa da tutti i data plane remoti
        // (tabella creata dalla stessa migrazione sull'istanza del cliente).
        let dup = client
            .query_opt(
                "select 1 from sync_mutazioni_applicate where mutation_id = $1",
                &[&mutation_uuid],
            )
            .await
            .map_err(|e| e.to_string())?;
        if dup.is_some() {
            result.duplicates += 1;
            continue;
        }

        // LWW sul timestamp certificato dal client.
        let existing = client
            .query_opt(
                &format!("select updated_at from {} where id = $1", m.table_name),
                &[&riga_uuid],
            )
            .await
            .map_err(|e| e.to_string())?;
        let newer = match existing {
            None => true,
            Some(row) => {
                let row_ts: std::time::SystemTime = row.get(0);
                let check = client
                    .query_one("select $1::text::timestamptz >= $2", &[&m.mutated_at, &row_ts])
                    .await
                    .map_err(|e| e.to_string())?;
                check.get::<_, bool>(0)
            }
        };

        if newer {
            if m.operation == "delete" {
                client
                    .execute(
                        &format!(
                            "update {} set deleted_at = $2::text::timestamptz,
                                    updated_at = $2::text::timestamptz where id = $1",
                            m.table_name
                        ),
                        &[&riga_uuid, &m.mutated_at],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
            } else {
                let payload = m
                    .payload
                    .clone()
                    .ok_or_else(|| "payload mancante per insert/update".to_string())?;
                let set_clause = match set_clause_cache.get(&m.table_name) {
                    Some(clause) => clause.clone(),
                    None => {
                        let columns = updatable_columns(&client, &m.table_name).await?;
                        let clause = columns
                            .iter()
                            .map(|c| format!("{c} = excluded.{c}"))
                            .collect::<Vec<_>>()
                            .join(", ");
                        set_clause_cache.insert(m.table_name.clone(), clause.clone());
                        clause
                    }
                };
                client
                    .execute(
                        &format!(
                            "insert into {t}
                               select * from jsonb_populate_record(null::{t}, $1)
                             on conflict (id) do update set {set_clause}",
                            t = m.table_name
                        ),
                        &[&payload],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
            }
            result.applied += 1;
        } else {
            result.skipped_lww += 1;
        }

        client
            .execute(
                "insert into sync_mutazioni_applicate
                   (mutation_id, tenant_id, tabella, riga_id, operazione,
                    mutato_il, applicata, device_id)
                 values ($1, $2, $3, $4, $5, $6::text::timestamptz, $7, $8)",
                &[
                    &mutation_uuid,
                    &tenant_uuid,
                    &m.table_name,
                    &riga_uuid,
                    &m.operation,
                    &m.mutated_at,
                    &newer,
                    &m.device_id,
                ],
            )
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Comando: pull on-premise (idratazione inversa, sync bidirezionale)
// ---------------------------------------------------------------------------

/// Scarica dal PostgreSQL privato le righe del tenant per le tabelle
/// sincronizzabili e le ritorna come mappa `{ tabella: [righe] }`. La colonna
/// PostGIS `geom` è esclusa via `to_jsonb(t) - 'geom'` (PGlite usa la geometria
/// GeoJSON nella colonna `geometria`); i tombstone (`deleted_at`) sono inclusi
/// per propagare le cancellazioni fatte su altri dispositivi. L'applicazione
/// LWW al PGlite locale è fatta lato JS (`AgroDal.applyRemoteRows`).
///
/// Pull INCREMENTALE: `watermarks` è una mappa JSON `{ tabella: iso }` con
/// l'ultimo `updated_at` già visto per tabella; quando presente, si scaricano
/// solo le righe più recenti. Assente o vuota → pull totale (primo avvio).
#[tauri::command]
pub async fn agro_pull_mutations(
    app: AppHandle,
    profilo: String,
    tenant_id: String,
    pin: Option<String>,
    watermarks: Option<String>,
) -> Result<serde_json::Value, String> {
    let tenant_uuid: uuid::Uuid = tenant_id.parse().map_err(|e| format!("{e}"))?;
    let since: std::collections::HashMap<String, String> = match watermarks.as_deref() {
        None | Some("") => std::collections::HashMap::new(),
        Some(raw) => {
            serde_json::from_str(raw).map_err(|e| format!("watermarks non validi: {e}"))?
        }
    };
    let conn_string = resolve_connection_string(&app, &profilo, pin.as_deref())?;
    let client = connect_pg(&conn_string).await?;

    let mut out = serde_json::Map::new();
    for tabella in TABELLE_SYNC {
        // Nome tabella da costante interna (whitelist): nessuna SQL injection.
        let row = match since.get(tabella) {
            Some(ts) => {
                let sql = format!(
                    "select coalesce(jsonb_agg(to_jsonb(t) - 'geom'), '[]'::jsonb)
                     from public.{tabella} t
                     where t.tenant_id = $1 and t.updated_at > $2::text::timestamptz"
                );
                client.query_one(&sql, &[&tenant_uuid, ts]).await
            }
            None => {
                let sql = format!(
                    "select coalesce(jsonb_agg(to_jsonb(t) - 'geom'), '[]'::jsonb)
                     from public.{tabella} t where t.tenant_id = $1"
                );
                client.query_one(&sql, &[&tenant_uuid]).await
            }
        }
        .map_err(|e| format!("pull {tabella} fallito: {e}"))?;
        let rows: serde_json::Value = row.get(0);
        out.insert(tabella.to_string(), rows);
    }
    Ok(serde_json::Value::Object(out))
}

// ---------------------------------------------------------------------------
// Proxy tile cartografiche (CORS)
// ---------------------------------------------------------------------------
//
// I server WMS pubblici (es. Catasto dell'Agenzia delle Entrate) non espongono
// header CORS: nel webview MapLibre carica i tile raster con
// crossOrigin="anonymous" e senza CORS la texture WebGL fallisce. Il dev server
// Vite ha un proxy equivalente (`/__geolibre_wms_proxy`); nel build NATIVO questo
// comando recupera il tile lato Rust (nessun vincolo CORS) e ne restituisce i
// byte grezzi al protocollo MapLibre custom registrato nel frontend
// (`lib/tauriWmsProtocol.ts`). Solo http(s): nessun accesso a file locali.
//
// Il comando è raggiungibile da qualunque codice giri nella WebView: timeout,
// redirect limitati (e solo verso http(s)) e un tetto ai byte letti impediscono
// che un URL ostile lo trasformi in un download infinito o in un rimbalzo
// verso schemi non previsti.
const TILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const TILE_MAX_REDIRECTS: usize = 5;
const TILE_MAX_BYTES: usize = 16 * 1024 * 1024;

fn tile_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(TILE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= TILE_MAX_REDIRECTS {
                attempt.error("troppi redirect")
            } else if matches!(attempt.url().scheme(), "http" | "https") {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| format!("Inizializzazione client tile fallita: {e}"))?;
    Ok(CLIENT.get_or_init(|| client))
}

#[tauri::command]
pub async fn agro_fetch_map_tile(url: String) -> Result<tauri::ipc::Response, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "URL tile non valido.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("URL tile non valido: ammessi solo http(s).".into());
    }
    let mut response = tile_client()?
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Richiesta tile fallita: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Tile server ha risposto {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|declared| declared > TILE_MAX_BYTES as u64)
    {
        return Err(format!("Tile troppo grande: il limite è {TILE_MAX_BYTES} byte."));
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Lettura tile fallita: {e}"))?
    {
        if bytes.len() + chunk.len() > TILE_MAX_BYTES {
            return Err(format!("Tile troppo grande: il limite è {TILE_MAX_BYTES} byte."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Valore atteso fisso: Argon2id v0x13, m=19 MiB, t=2, p=1, 32 byte (gli
    /// stessi parametri delle versioni già installate, verificati anche con
    /// crypto.argon2Sync di Node). Se un aggiornamento di argon2 cambiasse i
    /// default, i keystore offline esistenti non si aprirebbero più: questo test
    /// lo impedisce.
    #[test]
    fn pin_key_derivation_is_stable() {
        let key = derive_key("1234", &[7u8; 16]).unwrap();
        let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "ccdba260ebb6d611a0a90347637f612d15d15625b28693b5b0c4ad4942768807"
        );
    }

    #[test]
    fn vault_round_trip_and_wrong_pin() {
        let vault = seal("host=db password=segreto", "2468").unwrap();
        assert_eq!(open(&vault, "2468").unwrap(), "host=db password=segreto");
        assert!(open(&vault, "0000").is_err());
        let other = seal("host=db password=segreto", "2468").unwrap();
        assert_ne!(vault.salt, other.salt);
        assert_ne!(vault.nonce, other.nonce);
    }

    #[test]
    fn missing_sslmode_prefers_tls() {
        let (mode, conn) = normalize_sslmode("host=db user=agro");
        assert_eq!(mode, SslMode::Prefer);
        assert_eq!(conn, "host=db user=agro");
    }

    #[test]
    fn verify_modes_become_require_for_tokio_postgres() {
        let (mode, conn) = normalize_sslmode("host=db sslmode=verify-full user=agro");
        assert_eq!(mode, SslMode::VerifyFull);
        assert_eq!(conn, "host=db sslmode=require user=agro");
        let (mode, conn) = normalize_sslmode("postgres://agro@db/farm?sslmode=Verify-CA&application_name=x");
        assert_eq!(mode, SslMode::VerifyCa);
        assert_eq!(conn, "postgres://agro@db/farm?sslmode=require&application_name=x");
    }

    #[test]
    fn allow_maps_to_prefer_and_disable_stays_plain() {
        assert_eq!(normalize_sslmode("sslmode=allow").1, "sslmode=prefer");
        assert_eq!(normalize_sslmode("host=db sslmode=disable").0, SslMode::Disable);
    }

    #[test]
    fn non_ascii_password_keeps_byte_offsets() {
        let (mode, conn) = normalize_sslmode("password=pàssw€rd sslmode=verify-full");
        assert_eq!(mode, SslMode::VerifyFull);
        assert_eq!(conn, "password=pàssw€rd sslmode=require");
    }

    #[test]
    fn unknown_value_is_left_for_tokio_postgres_to_reject() {
        assert_eq!(normalize_sslmode("sslmode=bogus").1, "sslmode=bogus");
    }
}
