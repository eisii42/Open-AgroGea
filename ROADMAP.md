# Roadmap — AgroGea

> **Aggiornata il 4 ottobre 2026**, dopo il rilascio della **0.6.0**. Le
> modifiche versione per versione sono nel [CHANGELOG](./CHANGELOG.md).

## ✅ Disponibile oggi

- **Interfaccia pensata per il campo** (0.6.0): sul telefono barra di
  navigazione in basso, schede trascinabili e meteo sempre in vista; sul
  computer barra di icone dei moduli e più moduli aperti insieme in una colonna
  ridimensionabile; centro **«Da risolvere»** con tutto ciò che va sistemato in
  azienda; modifica delle operazioni del Quaderno
- Pipeline di sicurezza automatica su ogni pull request (CodeQL, gitleaks, ZAP,
  revisione automatica, Dependabot) e correzioni di sicurezza della 0.6.0

- Mappa GIS completa (ortofoto Esri, overlay Catasto WMS, Wayback imagery storica, import Shapefile/GeoJSON/OSM/GeoParquet)
- Particelle da fonti pubbliche: si sceglie una fonte ufficiale dal catalogo, si
  cercano le particelle nella zona inquadrata (o si clicca un punto), si vedono
  sulla mappa con i loro dati e si adottano una alla volta — provenienza, annata
  e licenza restano su ogni appezzamento. Paesi Bassi (BRP/PDOK) e Francia
  (RPG/IGN) verificati contro i servizi vivi
- Primo avvio guidato: nuova azienda, oppure ripristino da un backup
- Modulo **Normativa**: autovalutazione PAC (ammissibilità, BCAA, eco-schemi,
  trasversali) e biologico, con esiti tracciabili, confidenza dichiarata e soglie
  modificabili
- Magazzini multipli georeferenziati, certificazione dell'operatore e regime di
  produzione per annata
- Cartografia raster: servizi WMS da indirizzo (salvabili come sfondo) e ortofoto GeoTIFF offline
- Quaderno di Campagna Digitale con validazione PAN (trattamenti fitosanitari, fertilizzazioni, Tempo di Carenza)
- Harvest & Analytics (registrazione raccolte, grafici, Field Calculator)
- DSS & Bilancio Idrico (mappa colorata del rischio, evapotraspirazione FAO-56, riduzione di resa Ky FAO-33/66)
- Analisi del suolo e rateo variabile (VRA)
- Export SIAN/PAN (Italia), SIEX/CUE (Spagna), tracciato UE di base; import Fascicolo Aziendale SIAN
- Export geometrie (GeoJSON, KML, GPX, CSV, Shapefile) e backup/ripristino dati azienda (GeoJSON esteso v3, con scelta di periodo e sezioni)
- Funzionamento 100% offline, storage locale isolato (PGlite)
- Aggiornamenti automatici desktop (Tauri Updater + GitHub Releases)
- App desktop, telefono e web dallo stesso codice (Tauri v2); installer Windows
  pubblicati a ogni release, macOS e Linux compilabili dai sorgenti

## 🚧 Prossime patch — `0.6.x`

Nessuna nuova funzione: documentazione, rifiniture e la parte di sicurezza
rimasta aperta dopo la 0.6.0.

- **`0.6.1` — Documentazione**: manuali IT/EN allineati alla nuova interfaccia,
  README principale in inglese, ARCHITECTURE con l'interfaccia 0.6 e i confini
  di sicurezza, guida per contribuire con i controlli delle pull request e il
  processo di release, Security Policy aggiornata
- **MapLibre 6**: aggiornamento del motore cartografico insieme ai suoi plugin.
  Chiude per intero la CVE-2026-85061, oggi neutralizzata nell'app
- **PGlite / PostgreSQL**: aggiornamento con migrazione esplicita dei dati
  (esportazione con la versione attuale e reimportazione), oggi escluso dagli
  aggiornamenti automatici perché il nuovo formato non apre i database esistenti
- **PIN offline**: lunghezza minima 6 caratteri, parametri Argon2 rinforzati e
  pepper per-dispositivo nel keychain di sistema, con un archivio versionato che
  continui ad aprire quelli già creati
- **Proxy tile nativo**: oltre a timeout e tetti già attivi dalla 0.6.0, blocco
  degli indirizzi privati/loopback (anti-SSRF) con opt-in esplicito per i WMS su
  rete aziendale
- **CSP della webview**: rimozione di `unsafe-eval` (resta solo
  `wasm-unsafe-eval` per PGlite/DuckDB) e restrizione di `connect-src`
- **Installer**: build macOS e Linux nella CI di release, firma di codice per
  Windows

## 🔭 Piano di rilascio (`0.2.0` → `1.0.0`)

Ogni minor version è un incremento rilasciabile con valore d'uso concreto. Le
versioni `0.2.0`–`0.4.0` (Magazzino, Parco macchine, Modalità Campo) sono
sequenziali perché condividono un prerequisito tecnico. La `0.5.0` (particelle
pubbliche e Normativa) e la `0.6.0` (interfaccia e sicurezza) sono state
anteposte al binario DSS, che slitta quindi di due minor: le versioni
`0.7.0`–`0.10.0` (DSS) restano un **binario parallelo indipendente** che può
essere anticipato o interlacciato, senza vincoli di dipendenza.

### `0.2.0` — Magazzino ✅ rilasciata

Include il refactor del modello dati che abilita anche le versioni successive. Oggi
`treatment_logs` registra già le attività di campo, ma prodotti e mezzi vi sono
salvati come testo libero: questa versione introduce le anagrafiche e le tabelle di
giunzione, con migrazione additiva non distruttiva (PGlite) che mantiene i campi
testo come fallback finché non collegati.

- Fondamenta dati: anagrafiche `products` (categorie rigide — agrofarmaci con
  patentino, concimi con titoli N-P-K, sementi, carburante con assegnazioni UMA) e
  `product_lots` (lotto, scadenza, giacenza); tabella di giunzione
  `activity_products` (attività ↔ lotto, quantità, costo); estensione di DAL,
  coda `sync_outbox`, tipi di dominio e form attività.
- Tracciabilità obbligatoria di scadenze e lotti di produzione con alert di
  scadenza.
- Scarico reale al salvataggio dell'attività con controllo di inventario (blocco
  atomico se la giacenza va in negativo).
- Valorizzazione economica con Costo Unitario Medio Ponderato (CUMP): il costo
  vivo dei prodotti scaricati confluisce sul campo trattato.
- **Rilascio quando:** un'attività di campo scarica un lotto reale, la giacenza si
  aggiorna e il costo prodotti è imputato al campo.

> **Esteso dopo la pianificazione originale** (schema v23, rilasciato con la `0.5.0`):
> il magazzino non è più unico e implicito. Una tabella `warehouses` con posizione
> puntuale facoltativa dà all'azienda **più depositi**, ciascuno un POI cliccabile
> sulla mappa; la collocazione vive su `product_lots.warehouse_id`, così lo stesso
> prodotto può stare in due depositi con scadenze e quantità diverse. Dettagli
> nella sezione *0.5.0* del [CHANGELOG](./CHANGELOG.md).

### `0.3.0` — Parco macchine ✅ rilasciata

- Anagrafiche `machines` (unità motrici) ed `equipment` (attrezzi) con la giunzione
  `activity_machines` (attività ↔ macchina ↔ attrezzo, ore).
- Separazione logica tra unità motrici (trattori/mietitrebbie, tracciate a ore di
  lavoro) e attrezzi (aratri/botti, tracciati per usura e larghezza di lavoro).
- Contatori ore aggiornati automaticamente al salvataggio dell'attività, con storno
  su modifica/cancellazione e rettifiche manuali tracciate (`counter_adjustments`).
- Scadenziario di manutenzione ordinaria e straordinaria con alert basati sul
  tempo o sulle ore di utilizzo effettive, riprogrammazione del piano e scarico
  ricambi dal magazzino; scadenziario documenti (revisione, RCA, bollo, collaudo).
- Refill carburante che scarica la cisterna dal magazzino (blocco atomico) con
  accesso rapido a bordo campo, consumo l/h derivato e segnalazione anomalie.
- **Rilascio quando:** l'uso di un mezzo in campo incrementa i suoi contatori e fa
  scattare gli alert di manutenzione a soglia. ✔️

### `0.4.0` — Geofencing e Modalità Campo low-touch ✅ rilasciata

L'operatore in trattore non deve compilare moduli. Questa versione chiude il
cerchio fra ciò che è stato *pianificato* in ufficio e ciò che viene *eseguito* in
campo, riducendo la registrazione di una lavorazione a zero digitazioni.

- Riquadro **Pianificazione Task e Ricette** a schermo intero: schede di lavorazione
  programmate per appezzamento (`planned_tasks`) e miscele riutilizzabili
  (`recipes`, prodotti con dose per ettaro) preparate prima di uscire in campo.
- **Geofencing GPS automatico**: nessun pulsante da ricordare. All'ingresso in un
  appezzamento — confermato da una permanenza continuativa di 15 s, con isteresi
  d'uscita contro il jitter del segnale — il sistema cerca le task programmate su
  quel campo e propone quella prioritaria a tutto schermo; senza task offre un
  avvio rapido per tipo di lavorazione.
- **Alert di sicurezza sul tempo di rientro**: se sul campo insiste un trattamento
  il cui intervallo di rientro non è ancora scaduto, l'ingresso mostra un avviso
  con prodotto e ore residue, da confermare esplicitamente prima di iniziare —
  la tutela degli operatori diversi da chi ha trattato.
- **Modalità Campo ad altissimo contrasto**: fondo nero e cifre giganti leggibili
  al sole dal sedile del trattore, controlli tattili oltre 80 px per l'uso coi
  guanti. Velocità, ettari lavorati e tempo attivo in tempo reale; pausa/ripresa;
  note vocali geotaggate registrate e conservate sul dispositivo.
- **Tracciato GPS** accumulato e persistito a lotti (`field_operation_sessions`):
  la superficie realmente lavorata viene misurata, non dichiarata.
- **Registrazione automatica nel Quaderno di Campagna**: alla conclusione la
  lavorazione finisce nel registro senza conferme né digitazioni — una riga per
  prodotto della miscela, quantità ricalcolate sulla superficie GPS effettiva,
  scarico dei lotti di magazzino con costo CUMP congelato, task e sessione chiuse.
  Tutto in un'unica transazione, idempotente: un doppio tocco non può duplicare
  un registro di rilevanza legale.
- **Completezza PAN a monte**: la task avvisa già in pianificazione se produrrebbe
  un record non conforme (patentino, n. registrazione, dose, avversità), e un
  sistema di notifica a contatore segnala le registrazioni incomplete da
  completare — necessario, perché con la scrittura automatica non c'è un momento
  di revisione manuale.
- **Rilascio quando:** entrare in un campo con una task programmata, lavorare e
  uscire produce una registrazione conforme nel Quaderno senza che l'operatore
  abbia digitato nulla. ✔️

> **`0.4.1`** ✅ rilasciata — calendario aziendale, schede KPI personalizzate,
> import CSV dei prodotti, superficie lavorata dichiarata a fine sessione.

### `0.5.0` — Particelle pubbliche e Normativa ✅ rilasciata

Due prerequisiti di ogni lavoro successivo: sapere **quali campi** ha l'azienda
senza ridisegnarli, e sapere **come starebbero** davanti a un controllo.

- **Particelle da fonti pubbliche**: nuovo pacchetto `@agrogea/parcel` (contratto
  `Parcel`, catalogo delle fonti come JSON, adapter WFS/OGC API), trasporto nativo
  Rust con allow-list e blocco degli indirizzi privati, adozione esplicita una
  particella alla volta con provenienza, annata e licenza persistite (schema v22).
  Fonti verificate: Paesi Bassi (BRP/PDOK) e Francia (RPG/IGN).
- **Primo avvio guidato**: nuova azienda con paese scelto dall'utente, oppure
  ripristino da backup — niente più azienda di default inventata.
- **Modulo Normativa**: diciotto schede di autovalutazione PAC e biologico, con
  quattro esiti (incluso *non decidibile*), scene e parametri tracciati,
  confidenza con i fattori che la limitano, soglie modificabili (schema v25).
  BCAA 4/5/8 si procurano il dato da OSM, Copernicus DEM e ortofoto GeoTIFF.
- **Certificazione dell'operatore e regime di produzione per annata** (v24).
- **Magazzini multipli georeferenziati** (v23), limiti di zoom 13–17, segnali di
  attenzione sugli appezzamenti.
- **Backup v3** con perimetro selezionabile (periodo e sezioni) e migrazione
  automatica dei file v1/v2.
- **Rilascio quando:** un'azienda olandese o francese parte dal primo avvio,
  adotta i propri campi dalla fonte ufficiale e ottiene un'autovalutazione PAC
  con esiti tracciabili, senza disegnare nulla a mano.

**Ancora aperti dalla `0.5.x`:** nuove fonti di particelle nel catalogo
(un record JSON per fonte), attivazione deliberata della verifica settimanale
delle fonti (`sources-verify.yml`, oggi solo manuale).

### `0.6.0` — Interfaccia per il campo e sicurezza ✅ rilasciata

Una release di interfaccia: AgroGea si usa soprattutto in campo, con una mano,
e il telefono non poteva restare una versione ristretta del desktop.

- **Telefono**: barra di navigazione in basso (Mappa · Calendario · Dashboard ·
  Quaderno · Moduli), schede con tre altezze trascinabili e tasto Indietro di
  Android, controlli mappa e azioni rapide a portata di pollice, meteo sempre
  visibile, testi e controlli più grandi.
- **Computer**: barra di icone dei moduli, più moduli aperti insieme in una
  colonna ridimensionabile, controlli mappa in una colonna con il riquadro
  *Livelli*, ricerca `Ctrl K` da ogni vista, Esc a pila e focus gestito nelle
  finestre.
- **Centro «Da risolvere»**: un unico elenco di registrazioni incomplete, dati di
  campagna, lotti in scadenza, scadenze dei mezzi e appezzamenti senza suolo,
  costruito sui motori già esistenti.
- **Quaderno**: modifica delle operazioni sulla stessa riga e dati mancanti
  segnalati su ogni registrazione.
- **Sicurezza**: pipeline automatica sulle pull request; XSS delle attribuzioni
  (CVE-2026-85061) neutralizzata, TLS della sincronizzazione corretto, comando
  nativo dei tile limitato, input del worker controllato.
- **Rilascio quando:** un'operazione si registra, si corregge e si ritrova
  completa dal telefono, in campo, senza passare dal computer. ✔️

### `0.7.0` — DSS: difesa completa sulle colture esistenti

Modelli infettivi veri (oltre alla sola fenologia oggi presente) sulle colture già
supportate. Ogni coltura è una cartella in `modules/crops/` registrata nel registro
moduli.

- Fusariosi della spiga su frumento (finestra BBCH 61-69), Ticchiolatura del melo
  (tabella di Mills), TomCast su pomodoro, Botrite su vite.

### `0.8.0` — DSS: nuovi cereali

- Mais (GDD base 10 °C, rischio aflatossine), orzo, riso.

### `0.9.0` — DSS: nuove arboree e orticole

- Pero (Stemphylium), agrumi (mal secco), patata (modello tipo Mileos/SIMPHYT).

### `0.10.0` — DSS: colture industriali e oleaginose

- Colza (Sclerotinia), barbabietola da zucchero (CercoBet), girasole, soia.

### `0.11.0` — API sensoristica esterna

Sfruttando lo schema `weather_readings` già presente, adapter di ingest da API
esterne per sensoristica fissa e mobile, con pipeline che alimenta direttamente i
modelli DSS.

### `1.0.0` — Prima release stabile

- Revisione UX complessiva sulla base dei feedback raccolti dalle versioni
  precedenti.
- Hardening finale e installer multi-OS verificati: prima release pubblica stabile
  e feature-complete.
- Revisione versione mobile.

---

Per proporre o discutere una voce di roadmap, apri una
[issue](https://github.com/eisii42/Open-AgroGea/issues). Vedi anche la
[guida per contribuire](docs/contributing.md).
