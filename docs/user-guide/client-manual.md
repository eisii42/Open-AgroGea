# AgroGea — Manuale Utente (Edizione Desktop Open Source)

> Guida operativa per **agronomi e aziende agricole** che usano l'edizione Desktop Open Source.
> AgroGea è la suite agronomica e di gestione del territorio che porta la potenza di un GIS professionale direttamente in campo, **anche senza connessione**.

---

## 1. La Proposta di Valore Local-First

AgroGea non è un gestionale "nel cloud" come i SaaS tradizionali. È un'applicazione **local-first**: il programma e i tuoi dati vivono **sul tuo dispositivo**, e la connessione serve solo per gli aggiornamenti dell'app, mai per lavorare. Cosa significa concretamente:

- **Funziona al 100% senza rete, in campo.** In mezzo a un vigneto senza copertura puoi disegnare un appezzamento, registrare un trattamento, consultare la mappa satellitare e calcolare la resa. Tutto è già sul dispositivo.
- **Velocità istantanea.** I calcoli GIS (overlay catastali, sovrapposizioni, indici di rischio, calcoli di superficie) girano **dentro l'applicazione**, non su un server lontano. Niente attese di caricamento, niente "rotella che gira": la mappa risponde appena tocchi lo schermo.
- **Totale riservatezza dei dati aziendali.** I dati produttivi (mappe, registri, rese, analisi del suolo) restano in un archivio **isolato sul tuo dispositivo** e non vengono mai inviati altrove: l'edizione Desktop Open Source non ha sincronizzazione né account.

L'edizione Desktop Open Source lavora su **una singola azienda locale** — nessun login, nessun cloud, nessun limite di piano: si apre e funziona subito.

---

## 2. Guida all'Uso dei Moduli Agronomici

La dashboard è **geocentrica**: la mappa occupa tutto lo schermo e i moduli si aprono come pannelli laterali.

### 2.1 Mappa & Add Data
- **Sfondi cartografici** — Puoi attivare l'ortofoto **Satellite** (Esri World Imagery, alta risoluzione) e l'overlay **Catasto** (WMS dell'Agenzia delle Entrate, particelle catastali) come strati di sfondo, con visibilità e opacità regolabili.
- **Importa strati esterni (Add Data)** — Trascina nell'app i tuoi file vettoriali: **Shapefile** (con i file accessori `.dbf`/`.shx`/`.prj`), **GeoJSON**, estratti **OSM**, GeoParquet. AgroGea li carica istantaneamente nel motore di analisi locale e li mostra come nuovi layer sovrapponibili.
- **Timeline storica "Esri Wayback Imagery"** — Attiva l'imagery satellitare storica per **confrontare lo stesso terreno in epoche diverse**: utile per documentare l'evoluzione di un impianto, verificare lavorazioni passate o ricostruire eventi (es. una grandinata). Scorri tra le release disponibili dal selettore temporale.

### 2.2 Quaderno di Campagna Digitale (QDCD)
Il Quaderno raccoglie tutta la **tracciabilità** delle operazioni colturali, conforme alle regole **PAN/SIAN**. Per ogni trattamento fitosanitario inserisci:

- **Prodotto e numero di registrazione** del fitofarmaco, **sostanza attiva**, **avversità bersaglio**;
- **Dose** e unità di misura (kg/ha, l/ha, kg/hl, l/hl, g/hl, m³), con la **quantità totale** calcolata automaticamente sulla superficie dell'appezzamento;
- **Operatore** e relativo **codice fiscale**, **numero di patentino/certificato di abilitazione**;
- **Intervallo di rientro** (ore) e **Tempo di Carenza** (giorni).

> **Validazione PAN automatica** — Quando registri un fitosanitario, AgroGea verifica che i campi obbligatori (avversità, prodotto, numero di registrazione, sostanza attiva, dose, unità ammessa, patentino) siano compilati correttamente, segnalando con chiarezza ciò che manca. Lo stesso vale per le fertilizzazioni (tipo concime, titolo N-P-K nel formato `n-n-n`, quantità).

Il **Tempo di Carenza** registrato sull'operazione è la base del controllo che protegge la raccolta: confrontando la data di trattamento + i giorni di carenza con la data di raccolta, l'agronomo ha sempre sotto controllo l'intervallo di sicurezza prima del conferimento.

Cliccando su un appezzamento in mappa puoi aprire il Quaderno **già filtrato** sulle lavorazioni di quel campo.

### 2.3 Harvest & Analytics
- **Registrazione raccolte (Modulo Raccolta)** — Per ogni appezzamento e annata registri **cultivar**, **quantità (kg)**, **destinazione/logistica** e data. Le raccolte sono agganciate alla Campagna Agraria del campo.
- **Charts Panel** — Dalla **tabella attributi** integrata puoi generare al volo grafici sui tuoi dati: ad esempio **grafici a barre** sulla resa per varietà (somma/media dei kg per cultivar o per destinazione) oppure **istogrammi** sulla distribuzione del vigore NDVI tra gli appezzamenti.
- **Field Calculator** — Deriva nuovi campi calcolati con formule pronte all'uso, inserite come chip cliccabili:
  - **Densità piante** = `numero_piante / area_ha`
  - **Resa (t/ha)** = `(resa_kg / 1000) / area_ha`
  - **Max N organico (ZVN)** = `area_ha × 170` (massimale azoto organico in Zona Vulnerabile ai Nitrati)

  Il calcolatore aggiunge solo **nuovi** campi: i dati originali restano protetti.

Le tabelle analizzabili sono **Raccolte**, **Registro operazioni** e **Appezzamenti**. La tabella si può anche **staccare su una finestra separata** (secondo schermo).

### 2.4 DSS & Bilancio Idrico
Il **Sistema di Supporto alle Decisioni** trasforma dati meteo, satellitari e di suolo in una **mappa colorata del rischio** per ogni appezzamento.

- **La Mappa Colorata (Verde / Giallo / Rosso)** — Ogni appezzamento è colorato secondo un punteggio di rischio sintetico:
  - 🟢 **Verde — ottimale**: nessuna criticità rilevante.
  - 🟡 **Giallo — allerta**: condizioni da monitorare (ingresso in stress o rischio fungino crescente).
  - 🔴 **Rosso — critico**: intervento consigliato.

  Il punteggio combina **stress idrico**, **rischio fitopatologico** (modelli fungini), **vigore** (NDVI) e **fertilità del suolo** (azoto, sostanza organica), con pesi calibrati per coltura: le arboree pesano di più vigore e patologie, i seminativi lo stress idrico.

- **Bilancio idrico (FAO 56/66)** — AgroGea calcola giorno per giorno il fabbisogno d'acqua della coltura partendo dall'equazione di evapotraspirazione di riferimento **Penman-Monteith (FAO-56)** sui dati della tua stazione meteo, moltiplicata per il coefficiente colturale della fase fenologica (ETc), e tiene il conto dell'acqua nel suolo (pioggia + irrigazioni − consumi). Ti dice quando il campo entra in **stress idrico** e stima la potenziale **riduzione di resa** (fattore Ky, FAO-33/66), così pianifichi le irrigazioni con dati, non a sensazione.

---

## 3. Esportazione e Controlli Ufficiali

AgroGea genera con un clic i registri pronti per **ispezioni e controlli del Fascicolo Aziendale**, scegliendo automaticamente il tracciato corretto in base al **Paese** dell'azienda.

- **Italia — SIAN/PAN** — Il Quaderno di Campagna si esporta in **CSV ottimizzato per Microsoft Excel in lingua italiana**: separatore **`;`** (punto e virgola) e **BOM UTF-8**, così Excel apre il file con le colonne e gli accenti corretti senza alcuna conversione manuale. Il tracciato include i codici ministeriali Isola/Appezzamento e i riferimenti di registrazione dei prodotti.
- **Spagna — SIEX/CUE** — Esporta il *Cuaderno Digital de Explotación* in formato JSON strutturato (FEGA), con i campi in spagnolo.
- **Altri Paesi UE / Francia** — Tracciato internazionale di base: CSV con separatore `,`, UTF-8 pulito, date in formato ISO `AAAA-MM-GG`.

Oltre ai registri, puoi **esportare le geometrie** dei tuoi appezzamenti e layer nei formati standard del settore: **GeoJSON, KML, GPX, CSV e Shapefile** — pronti per essere condivisi con tecnici, consorzi o enti di controllo.

> **Tracciabilità degli scambi** — Ogni importazione ed esportazione viene annotata in un **giornale dei trasferimenti** locale, così hai sempre la storia di cosa è entrato e cosa è uscito dall'applicazione.

### Importazione del Fascicolo SIAN
Puoi **importare il Fascicolo Aziendale SIAN**: AgroGea decodifica i campi, crea automaticamente gli appezzamenti fisici mancanti (dalle geometrie), normalizza le colture e popola lo stato di Campagna Agraria dell'annata indicata con i codici ministeriali e le superfici dichiarate. I campi già presenti vengono riconosciuti e aggiornati, senza duplicati.

## 4. Backup e Trasferimento dei Dati

Dal **Data Command Center** puoi:

- **Esporta dati azienda (GeoJSON)** — scarica un'istantanea completa dell'azienda in un unico file GeoJSON Esteso: anagrafica, appezzamenti con geometria, **colture e Campagne Agrarie**, Quaderno di Campagna (trattamenti, analisi del suolo, raccolte), infrastrutture/POI e rilievi di campo.
- **Importa dati** — ripristina i dati da un file esportato in precedenza, come **ripristino** dello stato locale, previa conferma di sovrascrittura.

Il formato è uno standard **GeoJSON** apribile anche in altri software GIS.

## 5. Aggiornamenti Automatici

L'app si mantiene aggiornata da sola. All'avvio verifica in modo discreto la presenza di nuove versioni; se ne trova una, mostra un **banner** in alto con la versione e le **note di rilascio** e un pulsante **«Aggiorna ora»**. Premendolo, l'aggiornamento viene scaricato (con barra di avanzamento) e installato, e l'app si **riavvia** automaticamente sulla nuova versione. Nessun download parte senza il tuo consenso. Dettagli: [Desktop Auto-Update](../technical/desktop-auto-update.md).

---
