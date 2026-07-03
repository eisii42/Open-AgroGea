# Security Policy

🇮🇹 Italiano · [English below](#english)

## Versioni supportate

Gli aggiornamenti di sicurezza sono forniti solo per l'**ultima release** dell'edizione Community. Aggiorna sempre all'ultima versione prima di segnalare un problema.

| Versione | Supportata |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## Come segnalare una vulnerabilità

**Non aprire una issue pubblica** per vulnerabilità di sicurezza.

Usa uno dei due canali privati:

1. **GitHub Private Vulnerability Reporting** (preferito) — dalla scheda *Security* del repository → *Report a vulnerability*.
2. **Email** — [gea.watcher@gmail.com](mailto:gea.watcher@gmail.com), con oggetto che inizia per `[SECURITY]`.

Nella segnalazione includi, se possibile:

- una descrizione del problema e del suo impatto;
- i passi per riprodurlo (proof-of-concept minimale);
- versione di AgroGea, sistema operativo e modalità (desktop Tauri o demo web);
- eventuali proposte di mitigazione.

### Cosa aspettarti

- **Presa in carico** entro **72 ore** lavorative.
- **Valutazione** e conferma (o meno) della vulnerabilità entro **7 giorni**.
- Ti terremo aggiornato sull'avanzamento e concorderemo con te i tempi di **divulgazione coordinata**. Chiediamo di non divulgare pubblicamente prima del rilascio di una correzione (o di massimo **90 giorni**). Il credito ti sarà riconosciuto nelle note di rilascio, se lo desideri.

## Ambito

AgroGea è un'applicazione **local-first**: nell'edizione Community i dati non lasciano il dispositivo e non esiste un backend gestito da noi. Sono rilevanti, ad esempio:

- esecuzione di codice o escalation tramite l'app desktop (shell Tauri v2 / core Rust) e il meccanismo di **auto-update**;
- gestione insicura dei dati locali (istanza PGlite dell'azienda, backup GeoJSON, coda `sync_outbox`);
- vulnerabilità nell'import di file esterni (Shapefile / GeoJSON / OSM / GeoParquet) o nei tracciati di export/import ufficiali (SIAN/PAN, SIEX/CUE);
- gestione insicura di segreti o del canale di sync verso PostgreSQL on-premise, dove configurato.

**Motore GIS vendorizzato:** i pacchetti `@geolibre/*` derivano da [GeoLibre](https://github.com/opengeos/GeoLibre) (MIT). Le vulnerabilità che risiedono nel codice upstream immodificato è opportuno segnalarle **anche** al progetto originale; noi ci occuperemo comunque della porzione vendorizzata in questo repository.

Fuori ambito: report puramente teorici senza impatto pratico, output di scanner automatici senza analisi, e problemi che richiedono un dispositivo già compromesso o l'accesso fisico non attenuabile.

---

## English

🇬🇧 English · [Italiano sopra](#security-policy)

### Supported versions

Security updates are provided only for the **latest release** of the Community edition. Always update to the latest version before reporting an issue.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |
| < 0.1 | ❌ |

### Reporting a vulnerability

**Do not open a public issue** for security vulnerabilities.

Use one of the two private channels:

1. **GitHub Private Vulnerability Reporting** (preferred) — from the repository's *Security* tab → *Report a vulnerability*.
2. **Email** — [gea.watcher@gmail.com](mailto:gea.watcher@gmail.com), with a subject line starting with `[SECURITY]`.

Where possible, include:

- a description of the issue and its impact;
- steps to reproduce (a minimal proof-of-concept);
- AgroGea version, operating system and mode (Tauri desktop or web demo);
- any suggested mitigations.

### What to expect

- **Acknowledgement** within **72** business **hours**.
- **Triage** and confirmation (or not) of the vulnerability within **7 days**.
- We will keep you updated and agree with you on a **coordinated disclosure** timeline. Please do not disclose publicly before a fix is released (or a maximum of **90 days**). You will be credited in the release notes if you wish.

### Scope

AgroGea is a **local-first** application: in the Community edition data never leaves the device and there is no backend operated by us. Relevant issues include, for example:

- code execution or escalation via the desktop app (Tauri v2 shell / Rust core) and the **auto-update** mechanism;
- insecure handling of local data (the farm's PGlite instance, GeoJSON backups, the `sync_outbox` queue);
- vulnerabilities in the import of external files (Shapefile / GeoJSON / OSM / GeoParquet) or in the official export/import formats (SIAN/PAN, SIEX/CUE);
- insecure handling of secrets or of the sync channel to an on-premise PostgreSQL, where configured.

**Vendored GIS engine:** the `@geolibre/*` packages are derived from [GeoLibre](https://github.com/opengeos/GeoLibre) (MIT). Vulnerabilities residing in unmodified upstream code should **also** be reported to the original project; we will still address the portion vendored in this repository.

Out of scope: purely theoretical reports with no practical impact, raw automated-scanner output without analysis, and issues that require an already-compromised device or unmitigable physical access.
