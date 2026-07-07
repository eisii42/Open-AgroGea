# AgroGea — Manuale utente: dal primo avvio all'uso quotidiano

> 🇮🇹 Italiano · [🇬🇧 English](./manual.en.md)

> Guida **passo-passo** all'edizione Desktop Open Source. Parte dall'app appena installata e ti accompagna lungo il flusso di lavoro completo:
> **Dati aziendali → Appezzamenti → Colture** e poi l'uso di **tutti i moduli** della suite.
>
> Per capire *come funzionano* i moduli agronomici a livello scientifico (indici satellitari, mappe VRA, bilancio idrico), vedi la [Documentazione tecnica dei moduli](../technical/moduli-agronomici.md).

---

## Indice

1. [Prima di iniziare](#1-prima-di-iniziare)
2. [Come è fatta la schermata](#2-come-è-fatta-la-schermata)
3. [Il workflow di base (3 passi)](#3-il-workflow-di-base-3-passi)
   - [Passo 1 — Inserire i dati dell'azienda](#passo-1--inserire-i-dati-dellazienda)
   - [Passo 2 — Disegnare un appezzamento](#passo-2--disegnare-un-appezzamento)
   - [Passo 3 — Assegnare la coltura all'appezzamento](#passo-3--assegnare-la-coltura-allappezzamento)
4. [Usare i moduli](#4-usare-i-moduli)
   - [4.1 Quaderno di Campagna — registrare le operazioni](#41-quaderno-di-campagna--registrare-le-operazioni)
   - [4.2 Raccolta](#42-raccolta)
   - [4.3 Modulo Suolo — indici satellitari (NDVI e altri)](#43-modulo-suolo--indici-satellitari-ndvi-e-altri)
   - [4.4 Mappe a rateo variabile (VRA)](#44-mappe-a-rateo-variabile-vra)
   - [4.5 Acqua — Bilancio idrico (FAO 56/66)](#45-acqua--bilancio-idrico-fao-5666)
   - [4.6 Coltura · DSS — la mappa del rischio](#46-coltura--dss--la-mappa-del-rischio)
   - [4.7 Disegno — infrastrutture, POI, gestione e stampa](#47-disegno--infrastrutture-poi-gestione-e-stampa)
   - [4.8 Add Data — importare i tuoi strati](#48-add-data--importare-i-tuoi-strati)
   - [4.9 Tabella attributi, Field Calculator e grafici](#49-tabella-attributi-field-calculator-e-grafici)
   - [4.10 Data Command Center — la dashboard analitica](#410-data-command-center--la-dashboard-analitica)
   - [4.11 Esportazioni ufficiali e backup](#411-esportazioni-ufficiali-e-backup)
   - [4.12 Impostazioni: meteo, tema, profilo](#412-impostazioni-meteo-tema-profilo)
   - [4.13 Magazzino — prodotti, lotti e giacenze](#413-magazzino--prodotti-lotti-e-giacenze)
5. [Scorciatoie e produttività](#5-scorciatoie-e-produttività)
6. [Il flusso consigliato di una stagione](#6-il-flusso-consigliato-di-una-stagione)

---

## 1. Prima di iniziare

L'edizione Desktop Open Source funziona **subito, senza login e senza connessione**: si apre su **una singola azienda locale** già pronta all'uso. Non c'è nulla da configurare per cominciare — tutti i dati vivono sul tuo dispositivo.

Per lavorare al meglio, tieni presente due cose fin da subito:

- **La connessione serve solo per la mappa satellitare e per gli aggiornamenti.** Il disegno degli appezzamenti, il Quaderno, i calcoli e gli export girano offline. Se sei in campo senza rete, l'ortofoto potrebbe non caricarsi ma tutto il resto funziona.
- **Non serve "salvare il progetto".** Ogni dato che inserisci è scritto immediatamente nell'archivio locale. Non esiste un pulsante "Salva tutto": salvi scheda per scheda.

> **Consiglio:** il workflow è pensato per essere seguito **in ordine** la prima volta (azienda → appezzamenti → colture). Una volta che i dati di base ci sono, i moduli si usano nell'ordine che preferisci.

---

## 2. Come è fatta la schermata

L'interfaccia è **geocentrica**: la mappa occupa tutto lo schermo e ogni funzione si apre come **pannello laterale** sopra la mappa (che non viene mai ricaricata).

**La barra in alto (header):**

- **Logo AgroGea** e, accanto, il **nome dell'azienda attiva** (mostra `-` finché non lo compili nel Passo 1).
- **Add Data** — per trascinare/importare file esterni (vedi §4.8).
- **Scheda meteo** — condizioni del giorno e previsione a 4 giorni.
- **Switcher di vista** — due pulsanti: **Mappa** (il lavoro sul campo) e **Command Center** (la dashboard analitica, §4.10).
- A destra: **LED di stato** (nell'edizione locale i dati restano sempre sul dispositivo), **selettore tema** (Chiaro / Scuro / Verde), **menu Aiuto** (`?`) e **menu profilo**.

**La sidebar dei moduli:**

Si apre dalla **maniglia** sul bordo della mappa e raccoglie tutti gli strumenti, raggruppati in moduli espandibili:

| Modulo | Strumenti |
|---|---|
| **Suolo** | Analisi indici (NDVI…), Mappe VRA |
| **Coltura** | Dati coltura, Modelli DSS |
| **Acqua** | Bilancio idrico |
| **Disegno** | Disegna appezzamento, Disegna infrastruttura, Disegna POI, Gestisci, Stampa |
| **Quaderno (QDC)** | Operazioni, Raccolta, Export SIAN |
| **Impostazioni** | Anagrafica azienda, Meteo |

Cliccando uno strumento si apre il pannello corrispondente; cliccandolo di nuovo si chiude.

**L'annata (Campagna Agraria):** molti moduli lavorano su un **anno di campagna**. Lo imposti dentro il modulo Coltura con i pulsanti **− / +** accanto all'anno: è il contesto temporale condiviso (colture, DSS, export).

---

## 3. Il workflow di base (3 passi)

Questo è il cuore del tutorial: i tre passaggi che trasformano l'app vuota in un'azienda mappata e pronta all'analisi.

### Passo 1 — Inserire i dati dell'azienda

Prima di tutto diamo un'identità all'azienda: servirà per intestare i registri e per scegliere il **tracciato di export corretto in base al Paese**.

1. Apri la sidebar → modulo **Impostazioni** → **Anagrafica azienda** (icona palazzo 🏢).
2. Il pannello è diviso in **quattro sezioni**, selezionabili dalla colonnina di sinistra:
   - **Identità** — Ragione sociale, forma giuridica, codice azienda nazionale, Partita IVA.
   - **Codici** — Codice SDI, PEC, ID Fascicolo Aziendale, Organismo Pagatore.
   - **Sede** — Indirizzo, CAP, Comune, Provincia, Regione, **Paese**, email.
   - **Referente** — Nome e ruolo del referente aziendale.
3. Compila i campi che ti servono (la **Ragione sociale** è il minimo consigliato: comparirà nell'header).
4. Premi **Salva**.

> **Perché il Paese conta:** determina i cataloghi nazionali proposti (specie, varietà, prodotti) e il formato dei registri ufficiali. Ad esempio, con `Italia` avrai l'export **SIAN/PAN**; con `Spagna` il **SIEX/CUE**. Puoi comunque cambiarlo in seguito.

Da questo momento il nome dell'azienda appare nella barra in alto: sei pronto a mappare il territorio.

### Passo 2 — Disegnare un appezzamento

Un **appezzamento** è la particella fisica coltivata, definita da una geometria sulla mappa. Lo disegni direttamente sull'ortofoto.

1. (Consigliato) Attiva lo sfondo **Satellite** per vedere il terreno: usa lo **switch dei basemap** sulla mappa. In Italia puoi sovrapporre anche il layer **Catasto** per allinearti alle particelle catastali.
2. Apri la sidebar → modulo **Disegno** → **Disegna appezzamento**.
3. Sulla mappa, **clicca vertice dopo vertice** per tracciare il perimetro del campo; **doppio clic** (o chiudi sul primo vertice) per terminare il poligono.
4. Appena chiudi la forma si apre automaticamente la **scheda dati del nuovo appezzamento**:
   - L'**area geodetica** (ha) è già calcolata e mostrata in sola lettura.
   - **Nome appezzamento** — dagli un nome riconoscibile (es. "Vigna alta", "Seminativo Ovest").
   - **Tipo di irrigazione** — opzionale (es. goccia, aspersione).
5. Premi **Salva**: l'appezzamento entra nell'archivio locale e compare colorato sulla mappa.

**Modificare un appezzamento già creato:** clicca il campo sulla mappa per aprirne la **scheda di dettaglio**. Da qui puoi:

- rinominarlo o cambiare l'irrigazione;
- premere **Modifica geometria** per trascinare i vertici (l'area si ricalcola al salvataggio);
- inserire la **Composizione del suolo** (classe tessiturale o percentuali sabbia/limo/argilla, sostanza organica, pH, N-P-K): sono i dati che alimentano il bilancio idrico e il DSS;
- eliminare l'elemento (cancellazione protetta: devi digitare il nome esatto).

> Ripeti il Passo 2 per tutti i campi dell'azienda. Non serve farli tutti subito: puoi aggiungerne altri in qualsiasi momento.

### Passo 3 — Assegnare la coltura all'appezzamento

Ogni appezzamento porta una **coltura per annata**. È questo il dato che "accende" i moduli agronomici: senza una coltura, DSS e bilancio idrico non sanno quale coefficiente colturale usare.

1. Apri la sidebar → modulo **Coltura** → **Dati coltura**.
2. In alto scegli l'**annata** (Campagna Agraria) con **− / +**.
3. Seleziona l'**appezzamento** dal menu a tendina (mostra il nome e l'eventuale coltura già presente).
4. (Se disponibile) Usa il **quick-pick dal registro nazionale** per scegliere la specie: compila automaticamente nome comune, nome scientifico e codice ministeriale.
5. Scegli il **tipo di coltura** dai riquadri: **Vite, Olivo, Frutteto, Seminativo, Orticoltura**. Ogni tipo mostra i campi di filiera pertinenti:
   - *Perenni* (vite/olivo/frutteto): varietà, clone, portainnesto, sesto d'impianto, anno d'impianto…
   - *Annuali* (seminativo/orticoltura): varietà, ciclo, e la **data di semina/trapianto** (che leggerai dal Quaderno).
6. Compila l'**identità della specie** (nome comune obbligatorio; varietà e nome scientifico consigliati) e i **campi di filiera**.
7. Nella sezione **Dati dichiarativi di campagna** indica la **superficie dichiarata** (preimpostata sull'area geodetica) e, se li hai, i codici particella/coltura per il Fascicolo.
8. Premi **Salva coltura**.

> **Copia dall'anno precedente:** se registri una nuova annata su un appezzamento perenne che aveva già una coltura, il form **precompila** i valori dell'ultimo anno disponibile (creando comunque righe nuove per la stagione, senza toccare lo storico). Ti basta rivedere e salvare.

Fatto: hai un'azienda con i suoi campi e le rispettive colture. **Tutti i moduli seguenti ora funzionano.**

---

## 4. Usare i moduli

Da qui in poi l'ordine è libero: usa il modulo che ti serve. Molti pannelli condividono la stessa logica — **selezioni uno o più appezzamenti** e lanci il calcolo.

### 4.1 Quaderno di Campagna — registrare le operazioni

Il Quaderno raccoglie la **tracciabilità** di tutto ciò che fai in campo, conforme alle regole **PAN/SIAN**.

1. Apri la sidebar → **Quaderno (QDC)** → **Operazioni**.
2. Premi **＋ Registra operazione** e scegli il **tipo**:
   - **Trattamento fitosanitario** — prodotto e numero di registrazione, sostanza attiva, avversità, dose e unità (kg/ha, l/ha, kg/hl…), operatore e patentino, intervallo di rientro, **tempo di carenza**.
   - **Fertilizzazione** — tipo di concime, titolo **N-P-K** (formato `n-n-n`), quantità.
   - **Irrigazione** — volume/durata (alimenta anche il bilancio idrico).
   - **Lavorazione** — operazioni meccaniche sul terreno.
   - **Semina / Trapianto** — la data che fa da riferimento per le colture annuali e per i modelli fenologici.
   - **Campionamento suolo** — analisi (pH, sostanza organica, N-P-K) georiferita, salvata come punto sulla mappa.
3. Seleziona l'**appezzamento**, compila i campi e **salva**. Con i fitosanitari e le fertilizzazioni AgroGea esegue la **validazione PAN**: segnala con chiarezza i campi obbligatori mancanti.

**Scarico da magazzino (0.2.0):** per trattamenti, fertilizzazioni e semine la sezione dedicata scarica i lotti reali. La quantità **segue automaticamente** il totale calcolato dalla dose; se la modifichi a mano vedi la **dose effettiva** e l'eventuale scostamento. Il lotto è preselezionato in **FEFO** (scadenza più vicina), i lotti scaduti sono bloccati e, se un lotto non basta, un click **divide lo scarico su più lotti**. Selezionando il prodotto si precompilano registrazione, sostanza attiva e — se impostati in anagrafica — carenza e rientro di default.

**Semina smart:** seminando una **semente di magazzino** su un campo senza coltura, l'operazione propone di **assegnare automaticamente la coltura al campo** (scheda coltura + campagna agraria, densità derivata dalla dose). I dati dichiarativi (codici SIAN) restano da completare in Dati coltura.

**Consultare e filtrare:** la lista si filtra per **intervallo di date** e per **appezzamento**. Puoi anche attivare **Mostra sulla mappa** per proiettare le operazioni filtrate come simboli georiferiti. Clicca su una voce per vederne il dettaglio; il cestino la elimina (con conferma); l'icona **copia** la ripete con un form precompilato alla data di oggi (operatore e patentino sono ricordati tra un'operazione e l'altra).

> **Scorciatoia dal campo:** clicca un appezzamento sulla mappa e apri il Quaderno **già filtrato** su quel campo — registrare una nuova operazione resta a un tap di distanza.

### 4.2 Raccolta

Per registrare i conferimenti e alimentare le analisi di resa:

1. Sidebar → **Quaderno (QDC)** → **Raccolta**.
2. Per ogni raccolta indica **appezzamento, cultivar, quantità (kg), destinazione/logistica e data**. La cultivar si precompila dalla coltura di campagna del campo; la raccolta è agganciata alla Campagna Agraria **aperta**.

**Chiusura del ciclo colturale:** per le colture **annuali** (seminativi/orticole) il raccolto propone — con spunta pre-attiva — di **chiudere la campagna**: il campo torna libero (mappa neutra, DSS spento) e una nuova semina può ripartire anche nello stesso anno (secondo raccolto). Le perenni restano aperte.

**Compliance SIAN/SIEX:** se il campo ha una campagna con dati dichiarativi incompleti (codice coltura, isola/parcela SIGPAC, appezzamento/recinto), il form lo segnala con un banner e il badge «SIAN ✗» (o «SIEX ✗» in Spagna) nel selettore: puoi **completare subito** dai Dati coltura o registrare comunque con una spunta esplicita.

Questi dati diventano i grafici di resa nel Command Center e nella tabella attributi (§4.9–4.10).

### 4.3 Modulo Suolo — indici satellitari (NDVI e altri)

Calcola il vigore vegetativo da immagini satellitari (Sentinel-2 via STAC).

1. Sidebar → **Suolo** → **Analisi indici**.
2. Spunta gli **indici** da calcolare: **NDVI, NDRE, MSAVI2, SAVI, NDWI**. Marca uno di essi come **overlay** (sarà quello colorato sulla mappa).
3. Seleziona **uno o più appezzamenti**.
4. Regola il filtro **copertura nuvolosa** (slider %) e la **strategia temporale**: ultima immagine, ultimi 15/30 giorni, o un **intervallo personalizzato** (max 60 giorni, con grafico di trend).
5. Premi **Calcola**. Ottieni le medie più recenti per appezzamento/indice, l'**overlay raster** sulla mappa e — se hai una serie con più date — il grafico dell'andamento.

In fondo al pannello trovi anche lo **scatter NDVI ↔ chimica del suolo** (pH, sostanza organica, N-P-K), con il coefficiente di correlazione: utile per capire se il vigore segue la fertilità.

### 4.4 Mappe a rateo variabile (VRA)

Genera prescrizioni a dose variabile per i terminali dei trattori.

1. Sidebar → **Suolo** → **Mappe VRA**.
2. Scegli **appezzamento**, **indice di base** (es. NDVI), **tipo di lavorazione** (concimazione, fertilizzazione, trattamento, semina, irrigazione).
3. Imposta il **numero di zone** (da 2 a 5) e la **risoluzione** della cella; assegna il **rateo** (quantità) di ciascuna zona.
4. **Genera**: la mappa viene zonata via K-means. Poi **esporta** per i terminali di campo (**ISO-XML** / **GeoJSON**).

### 4.5 Acqua — Bilancio idrico (FAO 56/66)

Calcola giorno per giorno il fabbisogno d'acqua e ti dice quando il campo entra in stress.

1. Sidebar → **Acqua** → **Bilancio idrico**.
2. Seleziona **uno o più appezzamenti** (devono avere una **coltura** assegnata: serve il coefficiente colturale Kc).
3. (Opzionale) Se hai importato una **mappa del suolo** via Add Data, puoi indicarla come sorgente dei parametri idro-pedologici.
4. Premi **Calcola bilancio**. Per ogni campo ottieni:
   - la **deplezione radicale Dr** rispetto alla soglia **RAW**, l'acqua disponibile (AWC), i mm irrigati nel periodo e i **giorni di autonomia**;
   - lo **stato idrico** (adeguato / in stress);
   - un grafico con deplezione, piogge e irrigazioni degli ultimi ~75 giorni;
   - l'**export dello storico umidità** (GeoJSON / Shapefile / CSV).
5. Attiva **Mostra rischio sulla mappa** per l'overlay coropletico.

> La qualità del calcolo migliora con i dati che fornisci: **composizione del suolo** dell'appezzamento (Passo 2), **campionamenti** e **irrigazioni** registrate nel Quaderno.

### 4.6 Coltura · DSS — la mappa del rischio

Il Sistema di Supporto alle Decisioni sintetizza stress idrico, rischio fitopatologico, vigore (NDVI) e fertilità in un **punteggio colorato** per campo.

1. Sidebar → **Coltura** → **Modelli DSS**.
2. Spunta gli **appezzamenti** (devono avere una coltura con un modulo verticale: vite/olivo/frutteto/cereali/orticoltura).
3. Premi **Calcola modelli**. Ogni campo riceve una **scheda di rischio**:
   - 🟢 **Verde** — ottimale;
   - 🟡 **Giallo** — allerta, da monitorare;
   - 🔴 **Rosso** — critico, intervento consigliato.

I pesi sono calibrati per coltura (le arboree pesano di più vigore e patologie, i seminativi lo stress idrico).

### 4.7 Disegno — infrastrutture, POI, gestione e stampa

Oltre agli appezzamenti, il modulo **Disegno** gestisce il resto degli elementi territoriali:

- **Disegna infrastruttura** (linea) — condotte, recinzioni, reti antigrandine, strade. Alla chiusura inserisci tipo, nome e stato; la **lunghezza** è calcolata.
- **Disegna POI** (punto) — pozzi, trappole, sensori IoT, ingressi, fabbricati.
- **Gestisci** — apre il **Registro geometrie**: esci dalla modalità disegno e il tap sulla mappa **seleziona** gli elementi per modificarli o eliminarli.
- **Stampa** — apri il **compositore di stampa** per generare una mappa impaginata dell'azienda (es. per tecnici, consorzi, enti).

### 4.8 Add Data — importare i tuoi strati

Per portare dati esterni nella mappa:

1. Header → **Add Data** (oppure **trascina** il file nella finestra).
2. Formati supportati: **Shapefile** (con `.dbf`/`.shx`/`.prj`), **GeoJSON**, estratti **OSM**, **GeoParquet**.
3. Il file viene caricato nel motore di analisi locale e mostrato come nuovo layer sovrapponibile (utile anche come **mappa del suolo** per il bilancio idrico, §4.5).

Puoi anche attivare la **timeline storica "Esri Wayback"** per confrontare lo stesso terreno in epoche diverse.

### 4.9 Tabella attributi, Field Calculator e grafici

La **tabella attributi** integrata trasforma i tuoi dati in un foglio analizzabile. Le tabelle disponibili sono **Raccolte**, **Registro operazioni** e **Appezzamenti**.

- **Charts Panel** — genera al volo grafici (barre sulla resa per varietà, istogrammi del vigore NDVI…).
- **Field Calculator** — deriva nuovi campi con formule pronte (chip cliccabili):
  - **Densità piante** = `numero_piante / area_ha`
  - **Resa (t/ha)** = `(resa_kg / 1000) / area_ha`
  - **Max N organico (ZVN)** = `area_ha × 170`

  Aggiunge solo **nuovi** campi: i dati originali restano intatti.
- La tabella può essere **staccata su una finestra separata** (secondo schermo).

### 4.10 Data Command Center — la dashboard analitica

Dal pulsante **Command Center** nell'header passi dalla mappa alla **dashboard**, divisa in **due pagine**:

- **Colture e appezzamenti** — l'analisi agronomica: filtri annata → coltura → campi, KPI, calendario delle operazioni, dashboard personalizzabili e report direzionale.
- **Azienda** — l'andamento generale: superficie/operazioni/raccolto dell'annata, **stato del Magazzino** (valore giacenze a CUMP, lotti scaduti/in scadenza, prodotti sotto scorta), **costo prodotti per campo** e backup/ripristino. Un alert cliccabile segnala le campagne con dati dichiarativi (SIAN/SIEX) incompleti.

### 4.11 Esportazioni ufficiali e backup

**Registri per i controlli** — AgroGea sceglie il tracciato in base al **Paese** dell'azienda:

- **Italia — SIAN/PAN:** da **Quaderno (QDC) → Export SIAN**. CSV ottimizzato per Excel italiano (separatore `;`, BOM UTF-8), con codici ministeriali Isola/Appezzamento.
- **Spagna — SIEX/CUE:** *Cuaderno Digital* in JSON (FEGA).
- **Altri Paesi UE / Francia:** CSV internazionale (separatore `,`, date ISO).

**Import del Fascicolo SIAN** — puoi importare il Fascicolo Aziendale: AgroGea crea gli appezzamenti mancanti dalle geometrie, normalizza le colture e popola la Campagna dell'annata, riconoscendo i campi già presenti senza duplicati.

**Export delle geometrie** — appezzamenti e layer in **GeoJSON, KML, GPX, CSV, Shapefile**.

**Backup completo** — un'istantanea dell'intera azienda (anagrafica, appezzamenti, colture, Quaderno, raccolte, infrastrutture) in un unico file **GeoJSON Esteso**, e la relativa **importazione/ripristino**.

> Ogni import/export viene annotato in un **giornale dei trasferimenti** locale: hai sempre lo storico di cosa è entrato e uscito.

### 4.12 Impostazioni: meteo, tema, profilo

- **Meteo** (Impostazioni → Meteo) — configura la stazione/sorgente meteo che alimenta il bilancio idrico e il DSS.
- **Tema** — Chiaro / Scuro / Verde, dal selettore nell'header.
- **Profilo** — dal menu utente in alto a destra: preferenze e impostazioni dell'app.

### 4.13 Magazzino — prodotti, lotti e giacenze

Il Magazzino tiene l'**anagrafica dei prodotti** e i loro **lotti** con scadenza, giacenza e costo, e collega tutto alle attività del Quaderno.

1. Sidebar → **Magazzino** → **Prodotti e lotti**.
2. **＋ Nuovo prodotto** e scegli la **categoria** (rigida — determina i campi obbligatori):
   - **Agrofarmaco** — richiede il **n. di registrazione PAN**; in più sostanza attiva e **carenza/rientro di default** (precompilati poi nel Quaderno);
   - **Concime** — richiede i **titoli N-P-K** (percentuali);
   - **Semente** — con l'**identità colturale** (specie, nome scientifico, varietà, tipo coltura): è ciò che abilita l'assegnazione automatica della coltura alla semina;
   - **Carburante** — richiede il codice di **assegnazione UMA**;
   - **Altro / materiali** — lubrificanti e consumabili, senza campi extra.

   Il form include il **carico iniziale** (lotto di produzione, scadenza, **quantità obbligatoria** e costo): un prodotto nasce già con la sua giacenza. Facoltativi per tutte le categorie: fornitore e **scorta minima** (sotto soglia appare il badge di riordino).
3. Dal dettaglio prodotto, **Carica lotto** aggiunge i carichi successivi. Ogni carico aggiorna il **CUMP** (Costo Unitario Medio Ponderato) del prodotto con la media ponderata sulle giacenze.

**Scarico dalle attività:** nel form del Quaderno (trattamenti, fertilizzazioni, semine) compare la sezione **Scarico da magazzino**: scegli prodotto → lotto → quantità. Al salvataggio la giacenza si scarica **realmente**, in un'unica transazione con l'attività: se la quantità supera la disponibilità, **l'intera registrazione fallisce** (nessuno scarico parziale) con un messaggio chiaro. Il costo dei prodotti (quantità × CUMP al momento dello scarico) è **imputato al campo trattato** e sarà la base del bilancio di campo.

**Scadenze:** i lotti **scaduti** sono evidenziati e il loro uso nelle attività è **bloccato** (non selezionabili); i lotti **in scadenza** entro la soglia configurabile (default 30 giorni) sono segnalati con un alert nel pannello.

> **Compatibilità:** le registrazioni esistenti con prodotti/mezzi a testo libero restano valide; lo scarico da magazzino è facoltativo e si affianca al testo libero finché non colleghi un lotto reale. Eliminando un'operazione con scarichi, le giacenze vengono **reintegrate** automaticamente.

---

## 5. Scorciatoie e produttività

- **Command Palette** — dal menu **Aiuto (`?`)** apri la palette per saltare a qualsiasi azione o pannello digitandone il nome.
- **Clic su un campo** — apre la sua scheda; da lì raggiungi rapidamente Quaderno filtrato, dettaglio e modifica.
- **Menu Aiuto** — Command Palette, elenco scorciatoie, diagnostica, feedback, aggiornamenti e informazioni.
- **Aggiornamenti automatici** — all'avvio l'app verifica nuove versioni e mostra un banner con le note di rilascio; nessun download parte senza il tuo consenso.

---

## 6. Il flusso consigliato di una stagione

Una traccia pratica che mette in fila i moduli nell'ordine tipico di una campagna:

1. **Setup** (una tantum): Anagrafica azienda → disegno di tutti gli appezzamenti → composizione del suolo dove disponibile.
2. **Inizio campagna:** imposta l'**annata** e assegna la **coltura** a ogni appezzamento (Passo 3). Registra **semina/trapianto** nel Quaderno per le annuali.
3. **Durante la stagione:**
   - registra nel **Quaderno** trattamenti, fertilizzazioni, irrigazioni e lavorazioni;
   - monitora il vigore con l'**Analisi indici** (NDVI…);
   - pianifica le irrigazioni con il **Bilancio idrico** e tieni d'occhio la **mappa DSS**;
   - genera **mappe VRA** per le operazioni a dose variabile.
4. **Raccolta:** registra i conferimenti nel modulo **Raccolta**; analizza rese e vigore in **Tabella attributi** e **Command Center**.
5. **Fine campagna / controlli:** esporta i registri ufficiali (**SIAN/PAN** o equivalente) e fai un **backup GeoJSON** completo dell'azienda.

---

> Per la spiegazione scientifica dei moduli (indici satellitari, VRA, bilancio idrico, DSS) vedi la [Documentazione tecnica dei moduli](../technical/moduli-agronomici.md); per gli aggiornamenti automatici il documento [Desktop Auto-Update](../technical/desktop-auto-update.md).
