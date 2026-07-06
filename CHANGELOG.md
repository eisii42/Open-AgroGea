# Changelog

Tutte le modifiche rilevanti dell'edizione **AgroGea Community** sono documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il progetto adotta il [Versionamento Semantico](https://semver.org/lang/it/) (`MAJOR.MINOR.PATCH`).

Gli installer nativi di ogni versione rilasciata sono su [GitHub Releases](https://github.com/eisii42/Open-AgroGea/releases); l'app desktop si aggiorna da sola via Tauri Updater.

## [Non rilasciato]

### Aggiunto — 0.2.0 «Magazzino»
- **Magazzino con anagrafiche reali** (schema locale v16, migrazione additiva e non distruttiva): tabelle `products` (categorie rigide: agrofarmaci con n. registrazione PAN, concimi con titoli N-P-K, sementi, carburante con assegnazione UMA), `product_lots` (lotto, scadenza, giacenza, costo di carico) e `activity_products` (giunzione attività ↔ lotto con costo imputato). Le nuove entità sono sincronizzate via `sync_outbox` come le altre tabelle di dominio; il rollback logico è documentato in testa a `packages/agro-core/src/db/schema.ts`. I campi a testo libero di `treatment_logs` restano intatti come fallback.
- **Nuovo pannello Magazzino** (sidebar → Magazzino): anagrafica prodotti con campi obbligatori per categoria, carico lotti con scadenza e costo, giacenze e **alert di scadenza** con soglia configurabile (default 30 giorni).
- **Scarico reale dalle attività di campo**: nel form del Quaderno la sezione «Scarico da magazzino» (prodotto → lotto → quantità) scarica la giacenza nella **stessa transazione** della registrazione; se la giacenza andrebbe sotto zero l'intera operazione fallisce (blocco atomico) con messaggio chiaro. I lotti **scaduti** sono bloccati (non selezionabili); l'eliminazione di un'operazione con scarichi **reintegra** le giacenze.
- **Valorizzazione CUMP** (Costo Unitario Medio Ponderato): ogni carico aggiorna il costo medio ponderato del prodotto; ogni scarico congela il CUMP corrente in `activity_products` e imputa il costo al campo trattato (`AgroDal.costiProdottiPerCampo`), base del bilancio di campo previsto per la 0.4.0.
- Test dedicati (`tests/agro-warehouse.test.ts`): CUMP, scarico atomico (incluso blocco per giacenza negativa e lotti scaduti), migrazione additiva con dati preesistenti intatti e flusso end-to-end della Definition of Done.

### Aggiunto
- Documentazione tecnica bilingue dei moduli agronomici (`docs/technical/moduli-agronomici.md`, `agronomic-modules.en.md`): formule e assunzioni di indici satellitari, pedotransfer del suolo, bilancio idrico FAO 56/66, DSS fitopatologico, zonazione VRA.
- README e manuale utente in inglese (`README.en.md`, `docs/user-guide/manual.en.md`), con selettore lingua.

## [0.1.0] — 2026-07-03

Primo rilascio pubblico dell'edizione Community (standalone, local-first).

### Aggiunto
- **Mappa GIS** su base hard fork di [GeoLibre](https://github.com/opengeos/GeoLibre): ortofoto satellitare (Esri World Imagery), overlay catastale WMS, imagery storica *Wayback*, import drag-and-drop di Shapefile / GeoJSON / OSM / GeoParquet nel motore di analisi locale (DuckDB Spatial WASM).
- **Quaderno di Campagna Digitale** conforme alle regole PAN/SIAN: tracciabilità di trattamenti fitosanitari e fertilizzazioni, validazione automatica dei campi obbligatori, intervallo di rientro e Tempo di Carenza.
- **Harvest & Analytics**: registrazione raccolte per appezzamento/annata, grafici da tabella attributi, Field Calculator con formule agronomiche (densità piante, resa t/ha, massimale N organico ZVN).
- **DSS & Bilancio Idrico**: mappa del rischio verde/giallo/rosso per appezzamento; bilancio idrico giorno per giorno con evapotraspirazione Penman-Monteith (FAO-56) e stima della riduzione di resa (fattore Ky, FAO-33/66).
- **Analisi del suolo e rateo variabile (VRA)**: zonazione K-means e prescrizioni a dose variabile, export ISO-XML / GeoJSON.
- **Modelli fitopatologici**: gradi-giorno, regola "tre-dieci" per la peronospora della vite, oidio, occhio di pavone dell'olivo.
- **Export per gli enti di controllo** con tracciato scelto in base al Paese: SIAN/PAN (Italia), SIEX/CUE (Spagna, FEGA JSON), tracciato internazionale di base. Import del Fascicolo Aziendale SIAN. Export geometrie in GeoJSON, KML, GPX, CSV, Shapefile e backup completo in GeoJSON Esteso.
- **Storage local-first**: istanza PGlite (PostgreSQL WASM) isolata per azienda, coda `sync_outbox`, sync opzionale verso PostgreSQL on-premise via comando Rust nativo (Tauri v2).
- **App desktop** Windows / macOS / Linux con aggiornamenti automatici via Tauri Updater + GitHub Releases, e demo web standalone in-browser.

[Non rilasciato]: https://github.com/eisii42/Open-AgroGea/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/eisii42/Open-AgroGea/releases/tag/v0.1.0
