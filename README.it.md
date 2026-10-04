<p align="center">
  <img src="docs/assets/logo.png" alt="AgroGea" width="120" height="120">
</p>

<h1 align="center">AgroGea</h1>

<p align="center">
  <b>La suite GIS agronomica <i>local-first</i> che porta il campo — non solo la mappa — sul tuo dispositivo.</b>
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> · <b>🇮🇹 Italiano</b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licenza: AGPL v3" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/releases"><img alt="Release" src="https://img.shields.io/github/v/release/eisii42/Open-AgroGea?include_prereleases&sort=semver"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/quality.yml/badge.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/sast.yml"><img alt="Security scan" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/sast.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
</p>

<p align="center">
  <a href="https://eisii42.github.io/Open-AgroGea/"><b>🌐 Prova la demo web</b></a> — gira interamente nel browser; nulla di ciò che inserisci ne esce
</p>

---

AgroGea è una suite agronomica e di gestione del territorio **local-first**: mappa GIS, Quaderno di Campagna digitale, modelli decisionali per la difesa e bilancio idrico, analisi del suolo e rateo variabile, autovalutazione PAC e biologico — **tutto funzionante offline**, in mezzo a un vigneto senza copertura.

<p align="center">
  <img src="docs/assets/Gif_Readme.gif" alt="AgroGea in azione" width="100%">
</p>

## Local-first

- **Funziona al 100% senza rete, in campo.** Disegni un appezzamento, registri un trattamento, consulti la mappa, calcoli la resa — tutto già sul dispositivo. La rete serve solo per i servizi online — immagini e indici satellitari, meteo, servizi cartografici web — e per gli aggiornamenti.
- **Velocità istantanea.** Gli overlay catastali, gli spatial join, gli indici di rischio e i calcoli di superficie girano **dentro l'applicazione** (DuckDB Spatial in-browser), non su un server lontano.
- **I dati dell'azienda restano tuoi.** Ogni azienda vive in un archivio isolato sul tuo dispositivo (PGlite, PostgreSQL WASM). Nulla viene inviato da nessuna parte, a meno che tu non lo scelga.
- **Sincronizzazione facoltativa verso un tuo server.** Se vuoi una copia condivisa, AgroGea si sincronizza con un server PostgreSQL gestito da te, su TLS. Le modifiche si accodano localmente (`sync_outbox`) e ripartono da sole quando il server torna raggiungibile.

## Funzionalità principali

- 📱 **Pensata per il campo, su telefono e computer** — sul telefono una barra di navigazione in basso, schede che si trascinano con un pollice e il meteo sempre in vista; sul computer una barra di icone per i moduli e più moduli aperti fianco a fianco in una colonna ridimensionabile. **Tocca il logo** per un unico elenco di ciò che va sistemato in azienda: registrazioni incomplete, dati di campagna, lotti in scadenza, scadenze del parco macchine, appezzamenti senza dati del suolo.
- 🗺️ **Mappa GIS completa** — ortofoto satellitare (Esri World Imagery), overlay catastale WMS, imagery storica *Wayback* per confrontare lo stesso terreno in epoche diverse, import drag-and-drop di Shapefile / GeoJSON / OSM / GeoParquet nel motore di analisi locale. **Qualunque servizio WMS** si aggiunge dall'indirizzo e si salva come sfondo della mappa, e le tue **ortofoto GeoTIFF** funzionano offline.
- 🧭 **Particelle già pubblicate, non ridisegnate** — in gran parte d'Europa le particelle agricole sono già vettorializzate e pubblicate come dato aperto. Scegli la fonte ufficiale, cerchi nella zona che stai guardando, le vedi comparire sulla mappa con i loro dati al passaggio del mouse, e ne adotti una con un click: il disegno a mano resta come rettifica e ripiego, non come flusso principale. Ogni appezzamento adottato conserva **da dove viene, di che annata è e con quale licenza** — l'attribuzione viaggia col dato fino all'export. Oggi Paesi Bassi (BRP/PDOK) e Francia (RPG/IGN), verificati contro i servizi vivi; aggiungere un paese significa aggiungere un record JSON al catalogo, non scrivere codice.
- 📒 **Quaderno di Campagna Digitale** — tracciabilità dei trattamenti fitosanitari e delle fertilizzazioni conforme alle regole **PAN/SIAN**, con validazione automatica dei campi obbligatori, intervallo di rientro e Tempo di Carenza calcolati e sotto controllo prima del conferimento. Le operazioni si **modificano** direttamente, e ogni registrazione mostra i campi che le mancano per essere conforme.
- 🌾 **Harvest & Analytics** — registrazione raccolte per appezzamento/annata, grafici a barre e istogrammi al volo dalla tabella attributi, Field Calculator con formule agronomiche pronte all'uso (densità piante, resa t/ha, massimale N organico ZVN) e schede KPI che componi tu.
- 🌡️ **DSS & Bilancio Idrico** — mappa colorata del rischio (verde/giallo/rosso) per appezzamento, che combina stress idrico, rischio fitopatologico, vigore NDVI e fertilità del suolo; bilancio idrico giorno per giorno con evapotraspirazione **Penman-Monteith (FAO-56)** e stima della riduzione di resa (fattore Ky, FAO-33/66).
- 🎯 **Analisi del suolo e rateo variabile (VRA)** — zonazione e prescrizioni a rateo variabile a partire da analisi del suolo e indici vegetazionali Sentinel-2.
- 🚜 **Geofencing e Modalità Campo** — pianifichi la lavorazione in ufficio, poi in trattore non tocchi più nulla: entrando nell'appezzamento il **GPS riconosce il campo** e propone la task programmata, uno schermo ad altissimo contrasto mostra velocità, tempo e cosa stai facendo (con note vocali geotaggate), e alla conclusione basta dichiarare **quanto hai lavorato** perché la lavorazione **si registri da sola nel Quaderno**, con le quantità ricalcolate su quella superficie e lo scarico di magazzino. Sotto il 100% la task resta aperta e si riprende il giorno dopo. Avviso automatico se sul campo è ancora aperto un **tempo di rientro** da trattamento.
- ⚖️ **Normativa: autovalutazione PAC e biologico** — appezzamento per appezzamento, come te la passeresti a un controllo: ammissibilità, condizionalità (BCAA), eco-schemi e biologico, con quattro esiti (compreso *non decidibile*), le scene satellitari realmente usate, la confidenza e i fattori che la limitano, e soglie modificabili col riferimento normativo accanto. Pendenza da Copernicus DEM, reticolo idrografico da OpenStreetMap, ortofoto tue per gli elementi non produttivi. È un'autovalutazione, e lo dichiara ovunque.
- 📦 **Magazzino e parco macchine** — più depositi georeferenziati come punti sulla mappa, lotti con scadenza e giacenza per deposito, scarico reale e costo CUMP imputato al campo; mezzi e attrezzi con contatori ore, manutenzioni e rifornimenti.
- 📅 **Calendario aziendale** — una griglia mensile con tutto ciò che ha una data: task da fare, operazioni registrate, raccolte, meteo giorno per giorno, giorni a rischio DSS e giorni di stress idrico. Da lì pianifichi una task o registri un'operazione **sul giorno che hai aperto**.
- 📤 **Export per gli enti di controllo** — tracciato scelto automaticamente in base al Paese dell'azienda: **SIAN/PAN** (Italia, CSV Excel-ready con BOM UTF-8), **SIEX/CUE** (Spagna, JSON FEGA), tracciato internazionale di base per gli altri Paesi UE. Import del Fascicolo Aziendale SIAN con creazione automatica degli appezzamenti mancanti. Export geometrie in GeoJSON, KML, GPX, CSV, Shapefile. Backup completo o selettivo (periodo e sezioni) in GeoJSON esteso, ripristinabile anche dal primo avvio.

Guida completa all'uso: [Manuale utente](docs/user-guide/manuale.md) · Come funzionano i moduli agronomici: [Documentazione tecnica](docs/technical/moduli-agronomici.md) · Cosa cambia in ogni versione: [CHANGELOG](CHANGELOG.md).

## Installazione

Scarica l'installer da [GitHub Releases](https://github.com/eisii42/Open-AgroGea/releases): gli installer già pronti sono pubblicati per **Windows**, e l'app desktop poi si aggiorna da sola. Su macOS e Linux si compila dai sorgenti con i comandi qui sotto.

## Avvio rapido (dai sorgenti)

Requisiti: **Node.js 22+** e toolchain **Rust** ([rustup](https://rustup.rs/)) per l'app nativa. Su Linux servono anche i [prerequisiti di Tauri](https://v2.tauri.app/start/prerequisites/) (WebKitGTK).

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps

npm run dev:standalone              # l'app nel browser (Vite, porta 5174)
npx tauri dev -w agro-field-suite   # app desktop nativa (Tauri v2)
```

Build degli installer nativi (richiede Rust/Cargo):

```bash
npm run build:standalone
npm run tauri:build             # .msi/.exe (Windows), .dmg/.app (macOS), .AppImage (Linux)
```

Controlli di qualità:

```bash
npm run typecheck
npm test                        # test del dominio agronomico
npm run lint
npm run check:rust              # cargo check dell'app nativa
```

## Architettura in breve

- **App**: [`apps/agro-field-suite`](apps/agro-field-suite) — React + TypeScript su Vite, shell **Tauri v2** (core nativo Rust) per desktop, mobile e web dallo stesso codice.
- **Motore cartografico** ([`packages/core`](packages/core), [`map`](packages/map), [`ui`](packages/ui), [`plugins`](packages/plugins), [`attribute-table`](packages/attribute-table)) — cartografia basata su MapLibre, gestione dei livelli, plugin di mappa e tabella attributi.
- **Contratto delle particelle** ([`packages/agro-parcel`](packages/agro-parcel)) — pacchetto foglia senza dipendenze: il tipo `Parcel`, il catalogo delle fonti pubbliche (un JSON per fonte) e gli adapter WFS/OGC API. Consumabile da solo, anche da altri repository.
- **Dominio agronomico** ([`packages/agro-core`](packages/agro-core), [`agro-ui`](packages/agro-ui), [`plugins/agro-tools`](plugins/agro-tools)) — store Zustand, DAL **PGlite** (PostgreSQL WASM) locale per azienda, Sync Engine, engine di calcolo puri (NDVI/NDRE, FAO 56/66, fenologia, suolo, normativa).
- **Analisi spaziale in-browser** — **DuckDB Spatial (WASM)** legge i dati transazionali da PGlite per overlay, spatial join e zonazione, senza mai lasciare il dispositivo.
- **Sincronizzazione** — coda `sync_outbox` locale: di default resta no-op (i dati non lasciano mai il dispositivo); opzionalmente si drena verso un server PostgreSQL privato via comando Rust nativo.

Approfondimenti in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Aggiornamenti automatici (desktop)

L'app desktop si aggiorna da sola tramite **Tauri Updater** + GitHub Releases: controllo discreto all'avvio, banner con le note di rilascio e pulsante "Aggiorna ora", download con barra di avanzamento, nessun aggiornamento silenzioso. Dettagli: [docs/technical/desktop-auto-update.md](docs/technical/desktop-auto-update.md).

## Roadmap

Stato attuale e prossimi passi: [ROADMAP.md](ROADMAP.md).

## Contribuire

Segnalazioni di bug, richieste di funzionalità e pull request sono benvenute — vedi la [guida per contribuire](docs/contributing.md).

## Sicurezza

Per segnalare una vulnerabilità **non aprire una issue pubblica**: segui la [Security Policy](SECURITY.md). Ogni pull request passa da analisi statica (CodeQL), ricerca di segreti (gitleaks), scansione dinamica della build web (ZAP) e revisione di sicurezza automatica; le dipendenze sono controllate ogni settimana.

## Licenza

AgroGea è distribuito con licenza **[GNU AGPLv3](LICENSE)** © 2026 Andrea Carnasciali.

Alcuni componenti inclusi mantengono la propria licenza originale (MIT e altre): dettagli sull'attribuzione in [NOTICE](NOTICE), licenze di tutte le dipendenze di terze parti in [`apps/agro-field-suite/THIRD_PARTY_LICENSES.txt`](apps/agro-field-suite/THIRD_PARTY_LICENSES.txt).
