# Security Policy

🇬🇧 English · [Italiano sotto](#italiano)

## Supported versions

Security fixes are released only for the **latest version** of AgroGea. Always update before reporting an issue: the desktop app updates itself.

| Version | Supported |
|---|---|
| 0.6.x | ✅ |
| < 0.6 | ❌ |

## Reporting a vulnerability

**Do not open a public issue** for security vulnerabilities.

Use one of the two private channels:

1. **GitHub Private Vulnerability Reporting** (preferred) — from the repository's *Security* tab → *Report a vulnerability*.
2. **Email** — [gea.watcher@gmail.com](mailto:gea.watcher@gmail.com), with a subject line starting with `[SECURITY]`.

Where possible, include:

- a description of the issue and its impact;
- steps to reproduce (a minimal proof-of-concept);
- AgroGea version, operating system and mode (desktop app, phone, or web demo);
- any suggested mitigations.

### What to expect

- **Acknowledgement** within **72** business **hours**.
- **Triage** and confirmation (or not) of the vulnerability within **7 days**.
- We will keep you updated and agree with you on a **coordinated disclosure** timeline. Please do not disclose publicly before a fix is released (or a maximum of **90 days**). You will be credited in the release notes if you wish.

## Scope

AgroGea is a **local-first** application: farm data stays on the device and there is no backend operated by us. Relevant issues include, for example:

- code execution or privilege escalation through the desktop app (Tauri v2 shell, Rust commands callable from the webview) and the **auto-update** mechanism;
- **untrusted content rendered as code**: imported files (Shapefile / GeoJSON / OSM / GeoParquet / GeoTIFF), map services added by URL (WMS capabilities, attributions), public parcel sources;
- **server-side request forgery** through the native fetchers (map tiles, parcel sources);
- insecure handling of local data: the farm's PGlite instance, backups, the `sync_outbox` queue, the PIN-protected offline vault;
- weaknesses in the optional sync channel to a private PostgreSQL server (TLS, credentials);
- issues in the official export/import formats (SIAN/PAN, SIEX/CUE), e.g. formula injection in exported CSV files.

Out of scope: purely theoretical reports with no practical impact, raw automated-scanner output without analysis, and issues that require an already-compromised device or unmitigable physical access.

## How the project is protected

- **Every pull request to `main`** runs CodeQL (`security-extended`, on JavaScript/TypeScript, Rust and GitHub Actions), gitleaks secret scanning, a ZAP baseline scan of the production web build, the quality gate (typecheck, tests, lint, `cargo check` and the Rust unit tests) and an automated security review. The full git history is scanned for secrets every week.
- **Dependencies** (npm, Cargo, GitHub Actions) are monitored by Dependabot with a waiting period on freshly published versions; all workflow actions are pinned to a commit SHA.
- **Updates are signed**: the updater verifies the minisign signature of every package against the public key built into the app. Windows installers are not code-signed yet.
- The trust boundaries inside the app and where each one is handled are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-boundaries).

## Known advisories

| Advisory | Status |
|---|---|
| **CVE-2026-85061** — MapLibre GL ≤ 6.4.0, XSS through map attributions | **Mitigated since 0.6.0**: every attribution is reduced to plain text and `http(s)` links before MapLibre renders it. The full fix comes with the upgrade to MapLibre 6. |
| **GHSA-wrw7-89jp-8q8g** — `glib` (Linux only) | Part of the GTK stack used by Tauri on Linux; closes when Tauri moves to GTK 4. Windows, macOS and Android are not affected. |

---

## Italiano

[🇬🇧 English above](#security-policy) · 🇮🇹 Italiano

### Versioni supportate

Le correzioni di sicurezza escono solo per l'**ultima versione** di AgroGea. Aggiorna sempre prima di segnalare un problema: l'app desktop si aggiorna da sola.

| Versione | Supportata |
|---|---|
| 0.6.x | ✅ |
| < 0.6 | ❌ |

### Come segnalare una vulnerabilità

**Non aprire una issue pubblica** per vulnerabilità di sicurezza.

Usa uno dei due canali privati:

1. **GitHub Private Vulnerability Reporting** (preferito) — dalla scheda *Security* del repository → *Report a vulnerability*.
2. **Email** — [gea.watcher@gmail.com](mailto:gea.watcher@gmail.com), con oggetto che inizia per `[SECURITY]`.

Nella segnalazione includi, se possibile:

- una descrizione del problema e del suo impatto;
- i passi per riprodurlo (proof-of-concept minimale);
- versione di AgroGea, sistema operativo e modalità (app desktop, telefono o demo web);
- eventuali proposte di mitigazione.

#### Cosa aspettarti

- **Presa in carico** entro **72 ore** lavorative.
- **Valutazione** e conferma (o meno) della vulnerabilità entro **7 giorni**.
- Ti terremo aggiornato sull'avanzamento e concorderemo con te i tempi di **divulgazione coordinata**. Chiediamo di non divulgare pubblicamente prima del rilascio di una correzione (o di massimo **90 giorni**). Il credito ti sarà riconosciuto nelle note di rilascio, se lo desideri.

### Ambito

AgroGea è un'applicazione **local-first**: i dati dell'azienda restano sul dispositivo e non esiste un backend gestito da noi. Sono rilevanti, ad esempio:

- esecuzione di codice o escalation di privilegi tramite l'app desktop (shell Tauri v2, comandi Rust richiamabili dalla webview) e il meccanismo di **auto-update**;
- **contenuti non fidati interpretati come codice**: file importati (Shapefile / GeoJSON / OSM / GeoParquet / GeoTIFF), servizi cartografici aggiunti da indirizzo (capabilities e attribuzioni WMS), fonti pubbliche di particelle;
- **richieste lato server forgiate (SSRF)** tramite i fetcher nativi (tile della mappa, fonti di particelle);
- gestione insicura dei dati locali: istanza PGlite dell'azienda, backup, coda `sync_outbox`, archivio offline protetto dal PIN;
- debolezze del canale di sincronizzazione facoltativo verso un server PostgreSQL privato (TLS, credenziali);
- problemi nei tracciati ufficiali di export/import (SIAN/PAN, SIEX/CUE), ad esempio formula injection nei CSV esportati.

Fuori ambito: report puramente teorici senza impatto pratico, output di scanner automatici senza analisi, e problemi che richiedono un dispositivo già compromesso o l'accesso fisico non attenuabile.

### Come è protetto il progetto

- **Ogni pull request verso `main`** passa da CodeQL (`security-extended`, su JavaScript/TypeScript, Rust e GitHub Actions), ricerca di segreti con gitleaks, scansione ZAP baseline della build web di produzione, gate di qualità (typecheck, test, lint, `cargo check` e test Rust) e revisione di sicurezza automatica. Ogni settimana tutta la history git viene controllata in cerca di segreti.
- **Le dipendenze** (npm, Cargo, GitHub Actions) sono monitorate da Dependabot, con un periodo di attesa sulle versioni appena pubblicate; tutte le action dei workflow sono fissate allo SHA del commit.
- **Gli aggiornamenti sono firmati**: l'updater verifica la firma minisign di ogni pacchetto con la chiave pubblica inclusa nell'app. Gli installer Windows non hanno ancora la firma di codice.
- I confini di fiducia dentro l'app e il punto in cui ciascuno è gestito sono elencati in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-boundaries).

### Avvisi noti

| Avviso | Stato |
|---|---|
| **CVE-2026-85061** — MapLibre GL ≤ 6.4.0, XSS tramite le attribuzioni della mappa | **Mitigato dalla 0.6.0**: ogni attribuzione viene ridotta a testo e link `http(s)` prima che MapLibre la mostri. La correzione completa arriva con l'aggiornamento a MapLibre 6. |
| **GHSA-wrw7-89jp-8q8g** — `glib` (solo Linux) | Fa parte della libreria GTK usata da Tauri su Linux; si chiude quando Tauri passerà a GTK 4. Windows, macOS e Android non sono coinvolti. |
