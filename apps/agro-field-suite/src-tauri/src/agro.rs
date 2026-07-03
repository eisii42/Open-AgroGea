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
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const OFFLINE_VAULT: &str = "agrogea-offline-session.vault";
const PROFILES_VAULT_PREFIX: &str = "agrogea-pg-profile-";
// Whitelist delle tabelle sincronizzabili verso il Postgres privato. DEVE
// restare identica all'union `TabellaSync` in @agrogea/core (types.ts): è il
// contratto del wire format dell'outbox. Le tabelle local-only (weather_config,
// dss_results, soil_water_indices, data_transfer_logs, product_catalogs) NON
// si sincronizzano per definizione.
const TABELLE_SYNC: [&str; 11] = [
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

/// Modalità TLS desunta da `sslmode` nella stringa di connessione.
enum SslMode {
    /// Nessun TLS (rete locale/VPN). Default storico se `sslmode` è assente.
    Disable,
    /// Cifra senza verificare il certificato (server privato/self-signed).
    Require,
    /// Cifra e verifica il certificato col trust store del sistema operativo.
    Verify,
}

fn parse_sslmode(conn: &str) -> SslMode {
    let lower = conn.to_lowercase();
    let Some(idx) = lower.find("sslmode=") else {
        return SslMode::Disable;
    };
    let val = lower[idx + "sslmode=".len()..]
        .split(|c| c == ' ' || c == '&')
        .next()
        .unwrap_or("");
    match val {
        "require" | "prefer" | "allow" => SslMode::Require,
        "verify-ca" | "verify-full" => SslMode::Verify,
        _ => SslMode::Disable,
    }
}

/// Apre una connessione al PostgreSQL on-premise scegliendo il TLS in base a
/// `sslmode`: assente/`disable` → NoTls (LAN/VPN, default storico); `require` →
/// TLS senza verifica del certificato (server privato/self-signed); `verify-ca`/
/// `verify-full` → TLS con verifica via trust store di sistema. Avvia il task
/// della connessione in background e ritorna solo il Client.
async fn connect_pg(conn_string: &str) -> Result<tokio_postgres::Client, String> {
    fn fail(e: tokio_postgres::Error) -> String {
        format!("connessione PostgreSQL on-premise fallita: {e}")
    }
    match parse_sslmode(conn_string) {
        SslMode::Disable => {
            let (client, connection) =
                tokio_postgres::connect(conn_string, tokio_postgres::NoTls)
                    .await
                    .map_err(fail)?;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = connection.await {
                    log::error!("connessione on-premise interrotta: {e}");
                }
            });
            Ok(client)
        }
        mode => {
            let mut builder = native_tls::TlsConnector::builder();
            if matches!(mode, SslMode::Require) {
                // Semantica libpq "require": cifra ma non verifica (self-signed).
                builder.danger_accept_invalid_certs(true);
                builder.danger_accept_invalid_hostnames(true);
            }
            let connector = builder
                .build()
                .map_err(|e| format!("inizializzazione TLS fallita: {e}"))?;
            let tls = postgres_native_tls::MakeTlsConnector::new(connector);
            let (client, connection) =
                tokio_postgres::connect(conn_string, tls).await.map_err(fail)?;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = connection.await {
                    log::error!("connessione on-premise interrotta: {e}");
                }
            });
            Ok(client)
        }
    }
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
#[tauri::command]
pub async fn agro_fetch_map_tile(url: String) -> Result<tauri::ipc::Response, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL tile non valido: ammessi solo http(s).".into());
    }
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Richiesta tile fallita: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Tile server ha risposto {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Lettura tile fallita: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}
