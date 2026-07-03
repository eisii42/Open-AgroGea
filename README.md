<p align="center">
  <img src="docs/assets/logo.png" alt="AgroGea" width="120" height="120">
</p>

<h1 align="center">AgroGea</h1>

<p align="center">
  <b>La suite GIS agronomica <i>local-first</i> che porta il campo, non solo la mappa, sul tuo dispositivo.</b>
</p>

<p align="center">
  <a href="README.en.md">🇬🇧 English</a> · <b>🇮🇹 Italiano</b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL v3" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/releases"><img alt="Release" src="https://img.shields.io/github/v/release/eisii42/Open-AgroGea?include_prereleases&sort=semver"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/release.yml"><img alt="Release build" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/release.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
</p>

<p align="center">
  <a href="https://eisii42.github.io/Open-AgroGea/"><b>🌐 Prova la demo web</b></a> — edizione Standalone, gira interamente nel browser
</p>

---

AgroGea è una suite agronomica e di gestione del territorio **local-first**: mappa GIS, Quaderno di Campagna digitale, modelli decisionali fitosanitari e bilancio idrico, analisi del suolo e rateo variabile — **funzionanti offline**, in mezzo a un vigneto senza copertura, con sincronizzazione opzionale verso un server aziendale quando torni in rete.

<p align="center">
  <img src="docs/assets/Gif_Readme.gif" alt="AgroGea in azione" width="100%">
</p>

## Local-first

- **Funziona al 100% senza rete, in campo.** Disegni un appezzamento, registri un trattamento, consulti la mappa satellitare, calcoli la resa — tutto già sul dispositivo. Quando torni a portata di rete, AgroGea sincronizza da solo ciò che hai inserito.
- **Velocità istantanea.** Gli overlay catastali, gli spatial join, gli indici di rischio e i calcoli di superficie girano **dentro l'applicazione** (DuckDB Spatial in-browser), non su un server lontano.
- **Riservatezza dei dati aziendali.** I dati produttivi restano in un archivio isolato sul tuo dispositivo (PGlite, PostgreSQL WASM). Per i clienti che lo richiedono, l'intero backend può girare on-premise: i dati non lasciano mai il perimetro aziendale.
- **Nessun blocco operativo.** Se il server centrale è irraggiungibile, le modifiche si accodano localmente (`sync_outbox`) e ripartono da sole al ritorno della connessione, con backoff esponenziale.

## Funzionalità principali

- 🗺️ **Mappa GIS completa** — ortofoto satellitare (Esri World Imagery), overlay catastale WMS, imagery storica *Wayback* per confrontare lo stesso terreno in epoche diverse, import drag-and-drop di Shapefile / GeoJSON / OSM / GeoParquet nel motore di analisi locale. È costruita come **hard fork** del motore GIS [GeoLibre](https://github.com/opengeos/GeoLibre): la cartografia, il rendering vettoriale e gli strumenti di analisi spaziale sono l'eredità diretta di un motore GIS professionale; sopra a questa base AgroGea aggiunge l'intero dominio agronomico — tracciabilità colturale, DSS, export per gli enti di controllo.
- 📒 **Quaderno di Campagna Digitale** — tracciabilità dei trattamenti fitosanitari e delle fertilizzazioni conforme alle regole **PAN/SIAN**, con validazione automatica dei campi obbligatori, intervallo di rientro e Tempo di Carenza calcolati e sotto controllo prima del conferimento.
- 🌾 **Harvest & Analytics** — registrazione raccolte per appezzamento/annata, grafici a barre e istogrammi al volo dalla tabella attributi, Field Calculator con formule agronomiche pronte all'uso (densità piante, resa t/ha, massimale N organico ZVN).
- 🌡️ **DSS & Bilancio Idrico** — mappa colorata del rischio (verde/giallo/rosso) per appezzamento, che combina stress idrico, rischio fitopatologico, vigore NDVI e fertilità del suolo; bilancio idrico giorno per giorno con evapotraspirazione **Penman-Monteith (FAO-56)** e stima della riduzione di resa (fattore Ky, FAO-33/66).
- 🎯 **Analisi del suolo e rateo variabile (VRA)** — zonazione e prescrizioni a rateo variabile a partire da analisi del suolo e indici vegetazionali.
- 📤 **Export per gli enti di controllo** — tracciato scelto automaticamente in base al Paese dell'azienda: **SIAN/PAN** (Italia, CSV Excel-ready con BOM UTF-8), **SIEX/CUE** (Spagna, JSON FEGA), tracciato internazionale di base per gli altri Paesi UE. Import del Fascicolo Aziendale SIAN con creazione automatica degli appezzamenti mancanti. Export geometrie in GeoJSON, KML, GPX, CSV, Shapefile.

Guida completa all'uso: [Manuale utente](docs/user-guide/manuale.md) · Funzionamento dei moduli agronomici: [Documentazione tecnica](docs/technical/moduli-agronomici.md).

## Avvio rapido

Requisiti: **Node.js 22+**, toolchain **Rust** ([rustup](https://rustup.rs/)) per la build desktop nativa.

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps

npm run dev:standalone          # edizione desktop OSS, nel browser (Vite, porta 5174)
npx tauri dev -w agro-field-suite   # app desktop nativa (Tauri v2)
```

Build installer nativi (richiede Rust/Cargo):

```bash
npm run build:standalone
npm run tauri:build             # genera .msi/.exe (Windows), .dmg/.app (macOS), .AppImage (Linux)
```

Altri comandi utili:

```bash
npm run typecheck
npm test                        # test del dominio agronomico
npm run lint
```

## Architettura in breve

- **App**: [`apps/agro-field-suite`](apps/agro-field-suite) — React + TypeScript su Vite, shell **Tauri v2** (core nativo Rust) per desktop/mobile/web dallo stesso codice.
- **Motore GIS** ([`packages/core`](packages/core), [`map`](packages/map), [`ui`](packages/ui), [`plugins`](packages/plugins), [`attribute-table`](packages/attribute-table)) — vendorizzato da GeoLibre (MIT).
- **Dominio agronomico** ([`packages/agro-core`](packages/agro-core), [`agro-ui`](packages/agro-ui), [`plugins/agro-tools`](plugins/agro-tools)) — store Zustand, DAL **PGlite** (PostgreSQL WASM) locale per azienda, Sync Engine, engine di calcolo puri (NDVI/NDRE, FAO 56/66, fenologia, suolo).
- **Analisi spaziale in-browser** — **DuckDB Spatial (WASM)** legge i dati transazionali da PGlite per overlay, spatial join e zonazione, senza mai lasciare il dispositivo.
- **Sincronizzazione** — coda `sync_outbox` locale: di default resta no-op (i dati non lasciano mai il dispositivo); opzionalmente si drena verso un PostgreSQL on-premise via comando Rust nativo.

## Aggiornamenti automatici (desktop)

L'app desktop si aggiorna da sola via **Tauri Updater** + GitHub Releases: controllo discreto all'avvio, banner con changelog e pulsante "Aggiorna ora", download con barra di avanzamento, nessun aggiornamento silenzioso. Dettagli: [docs/technical/desktop-auto-update.md](docs/technical/desktop-auto-update.md).

## Roadmap

Stato attuale e prossimi passi dell'edizione Community: [ROADMAP.md](ROADMAP.md).

## Contribuire

Segnalazioni di bug, richieste di funzionalità e pull request sono benvenute — vedi la [guida per contribuire](docs/contributing.md). Cronologia delle versioni in [CHANGELOG.md](CHANGELOG.md).

## Sicurezza

Per segnalare una vulnerabilità **non aprire una issue pubblica**: segui la [Security Policy](SECURITY.md).

## Licenza

AgroGea è distribuito con licenza **[GNU AGPLv3](LICENSE)** © 2026 Andrea Carnasciali.

Il motore GIS vendorizzato (pacchetti `@geolibre/*` in `packages/core`, `map`, `ui`, `plugins`, `attribute-table`) resta distribuito secondo i termini della sua licenza originale — **[MIT](packages/core/LICENSE)** © Qiusheng Wu — come previsto dalla licenza stessa. Dettagli sull'attribuzione in [NOTICE](NOTICE); licenze di tutte le dipendenze di terze parti in [`apps/agro-field-suite/THIRD_PARTY_LICENSES.txt`](apps/agro-field-suite/THIRD_PARTY_LICENSES.txt).
