# Changelog

Tutte le modifiche rilevanti dell'edizione **AgroGea Community** sono documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il progetto adotta il [Versionamento Semantico](https://semver.org/lang/it/) (`MAJOR.MINOR.PATCH`).

Gli installer nativi di ogni versione rilasciata sono su [GitHub Releases](https://github.com/eisii42/Open-AgroGea/releases); l'app desktop si aggiorna da sola via Tauri Updater.

## [Non rilasciato]

### Aggiunto — 0.3.0 «Parco macchine»
- **Anagrafica mezzi e attrezzi** (schema locale v18, migrazione additiva e non distruttiva): tabelle `machines` (unità motrici tracciate a **ore di lavoro**, stato operativo/in manutenzione/fermo-guasto/dismesso, campi predisposti per l'ammortamento 0.4.0), `equipment` (attrezzi tracciati per **usura** e larghezza di lavoro), `activity_machines` (giunzione attività ↔ mezzo ↔ attrezzo con ore), `maintenance_schedules`/`maintenance_logs`, `machine_documents`, `counter_adjustments` e `fuel_refills`. Tutte sincronizzate via `sync_outbox`; rollback logico documentato in testa a `packages/agro-core/src/db/schema.ts`. I dati preesistenti e il testo libero `machinery_equipment` restano intatti.
- **Sotto-scheda «Mezzi»** dentro il modulo Magazzino: anagrafica mezzi/attrezzi con contatori, stato a semaforo, import **CSV** (anteprima + validazione, import parziale, 100% offline) e cruscotto **«Richiede attenzione»** che aggrega manutenzioni in scadenza/scadute, documenti in scadenza/scaduti, consumi anomali e mezzi fermi.
- **Contatori ore automatici** (§5.2): registrando un'operazione di campo si seleziona un **mezzo già a database** (motrice + attrezzo opz.) con le ore; al salvataggio i contatori si **incrementano** nella stessa transazione dell'attività; modifica/cancellazione li **stornano** senza scostamenti. Le rettifiche manuali (lettura iniziale, sostituzione motore) passano da `counter_adjustments` con audit trail; l'incremento automatico riparte dal valore rettificato.
- **Scadenziario manutenzione** ordinaria/straordinaria con trigger a **tempo** (data/intervallo) o a **ore** (soglia contaore) e alert a soglia; la registrazione di un intervento **riprogramma** il piano ricorrente e può **scaricare un ricambio dal magazzino** (blocco atomico, riuso della logica 0.2.0) o registrarlo come testo + costo. Il dettaglio mezzo mostra storico interventi e prossima scadenza.
- **Scadenziario documenti** del mezzo (revisione, assicurazione/RCA, bollo, collaudo, altro) con alert a soglia sulla data di scadenza e **semaforo** valido/in scadenza/scaduto.
- **Refill carburante** (pannello a sé, staccato dal Magazzino): un pulsante rapido a bordo campo — sotto le note geotaggate — apre il form **precompilato** (data odierna, ultimo mezzo, cisterna suggerita). Il rifornimento **scarica** un lotto `carburante` (la cisterna aziendale) dal magazzino con blocco atomico, deriva il riferimento **UMA** dal prodotto ed è tracciato per mezzo con litri, data e lettura contaore. Elenco filtrabile per mezzo e per cisterna; storno che reintegra la cisterna.
- **Consumo carburante l/h** e **anomalie** (§5.6): consumo medio e ultimo intervallo pieno-a-pieno derivati dai rifornimenti + contaore (engine puro in `@agrogea/tools`, casi limite gestiti: contaore mancante, primo rifornimento, refill parziale); segnalazione di anomalia oltre soglia dalla media storica.
- **Impostazioni profilo**: le nuove sezioni «Parco macchine» (`panelMezzi`) e il pulsante «Refill carburante» (`panelRefill`) sono attivabili/disattivabili dalle impostazioni del profilo.
- Test dedicati (`tests/agro-machinery.test.ts`): migrazione additiva, contatori con storno su modifica/cancellazione e interazione con le rettifiche, refill atomico (blocco per giacenza cisterna insufficiente, coerenza cisterna→mezzo), manutenzione a soglia (tempo/ore) e riprogrammazione, scarico ricambio atomico, documenti a soglia, consumo l/h + anomalie e flusso end-to-end della Definition of Done.

### Corretto — Export CSV del Quaderno di Campagna (QDCA)
- **Tipo operazione localizzato**: il CSV riporta l'etichetta leggibile nella lingua attiva (es. «Raccolta», «Semina/Trapianto») invece del codice interno inglese (`harvest`, `sowing`); default italiano anche fuori dalla UI.
- **Codici SIAN sempre riportati**: i riferimenti ministeriali (codice coltura, isola, appezzamento) si risolvono via `plot_campaign_id` con **fallback per appezzamento + anno**, così i codici compilati nella scheda coltura DOPO la registrazione — o su operazioni non agganciate (es. semina con auto-assegnazione) — compaiono comunque. Il dialog carica le campagne di **tutte le annate**, non solo quella attiva.
- **Le raccolte rientrano nel QDCA**: gli eventi di raccolta (`harvest_logs`) confluiscono nell'export come operazioni `harvest` (cultivar, quantità raccolta in kg, destinazione), con i codici SIAN della campagna del campo; due nuove colonne dedicate «Quantità raccolta (kg)» e «Destinazione raccolta».

### Aggiunto — 0.2.0 «Magazzino»
- **Magazzino con anagrafiche reali** (schema locale v16, migrazione additiva e non distruttiva): tabelle `products` (categorie rigide: agrofarmaci con n. registrazione PAN, concimi con titoli N-P-K, sementi, carburante con assegnazione UMA), `product_lots` (lotto, scadenza, giacenza, costo di carico) e `activity_products` (giunzione attività ↔ lotto con costo imputato). Le nuove entità sono sincronizzate via `sync_outbox` come le altre tabelle di dominio; il rollback logico è documentato in testa a `packages/agro-core/src/db/schema.ts`. I campi a testo libero di `treatment_logs` restano intatti come fallback.
- **Nuovo pannello Magazzino** (sidebar → Magazzino): anagrafica prodotti con campi obbligatori per categoria, carico lotti con scadenza e costo, giacenze e **alert di scadenza** con soglia configurabile (default 30 giorni).
- **Scarico reale dalle attività di campo**: nel form del Quaderno la sezione «Scarico da magazzino» (prodotto → lotto → quantità) scarica la giacenza nella **stessa transazione** della registrazione; se la giacenza andrebbe sotto zero l'intera operazione fallisce (blocco atomico) con messaggio chiaro. I lotti **scaduti** sono bloccati (non selezionabili); l'eliminazione di un'operazione con scarichi **reintegra** le giacenze.
- **Valorizzazione CUMP** (Costo Unitario Medio Ponderato): ogni carico aggiorna il costo medio ponderato del prodotto; ogni scarico congela il CUMP corrente in `activity_products` e imputa il costo al campo trattato (`AgroDal.costiProdottiPerCampo`), base del bilancio di campo previsto per la 0.4.0.
- Test dedicati (`tests/agro-warehouse.test.ts`): CUMP, scarico atomico (incluso blocco per giacenza negativa e lotti scaduti), migrazione additiva con dati preesistenti intatti e flusso end-to-end della Definition of Done.
- **Anagrafica prodotti estesa**: creazione prodotto con **carico iniziale contestuale** (lotto, scadenza, quantità obbligatoria, costo); sostanza attiva (agrofarmaci), fornitore, **scorta minima** con badge di riordino; categoria residuale «Altro / materiali»; **Command Center a due pagine** («Colture e appezzamenti» + «Azienda» con andamento generale, stato magazzino e costo prodotti per campo); modulo Magazzino disattivabile dalle impostazioni profilo (`panelMagazzino`).

### Aggiunto — 0.2.0 «Automazioni del ciclo colturale» (schema locale v17, additivo)
- **Dose ⇄ scarico riconciliati**: nel form operazione la quantità scaricata segue automaticamente il totale calcolato (dose × superficie, o totale manuale kg); l'edit manuale mostra la **dose effettiva** e segnala lo scostamento; i prodotti con unità non riconciliabile non sono selezionabili. Lotto preselezionato in **FEFO** e **split automatico multi-lotto** quando un lotto non basta.
- **Semina → coltura automatica**: l'anagrafica della semente porta l'**identità colturale** (specie, nome scientifico, varietà, tipo coltura in `products.metadata`); seminando su un campo libero l'operazione crea automaticamente scheda coltura (`crops`) e campagna agraria (`plots_campaign`), con densità di semina derivata dalla dose.
- **Il raccolto chiude il ciclo**: colonna `plots_campaign.closed_at` + indice unico parziale sulle campagne aperte (possibile il **secondo raccolto** nello stesso anno). Alla raccolta di un'annuale la chiusura è proposta pre-attiva; il campo torna libero (mappa neutra, DSS spento). Rollback logico documentato in `packages/agro-core/src/db/schema.ts`.
- **Compliance dichiarativa SIAN/SIEX** (`compliance/sian-campaign.ts`): il paese risolto sceglie il sistema (IT → SIAN, ES → SIEX/CUE, stessa terna di campi `plots_campaign` consumata dagli export); badge «SIAN/SIEX ✗» nei selettori campo, banner alla raccolta con CTA «Completa ora» (apre Dati coltura puntata sul campo) e **override esplicito** per salvare comunque; alert cliccabile nella pagina Azienda.
- **Micro-automazioni**: carenza/rientro di default dall'anagrafica agrofarmaco; operatore/CF/patentino ricordati per dispositivo; «**Ripeti operazione**» dal registro (form precompilato, data odierna); cultivar della raccolta precompilata dalla coltura di campagna; badge ⚠ lotti in scadenza sul modulo Magazzino in sidebar.
- Test (`tests/agro-crop-cycle.test.ts`): chiusura campagna e secondo raccolto, indice unico parziale, metadata prodotti, compliance dichiarativa country-aware, campo libero dopo chiusura.

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
