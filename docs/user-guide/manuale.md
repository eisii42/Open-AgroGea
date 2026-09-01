# AgroGea — Manuale utente: dal primo avvio all'uso quotidiano

> 🇮🇹 Italiano · [🇬🇧 English](./manual.en.md)

> **Versione documento 0.4.1** · aggiornato il 21 agosto 2026 · descrive **AgroGea Community 0.4.1**. Se la tua app mostra una versione diversa (menu **?** → *Informazioni*), le differenze sono elencate nel [CHANGELOG](../../CHANGELOG.md).
>
> Include inoltre le novità ancora **non rilasciate** presenti su `dev` (sezione *Non rilasciato* del CHANGELOG): **magazzini multipli e georeferenziati**, **limiti di zoom della mappa** e **segnali di attenzione sugli appezzamenti**.

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
   - [4.11 Calendario aziendale](#411-calendario-aziendale)
   - [4.12 Esportazioni ufficiali e backup](#412-esportazioni-ufficiali-e-backup)
   - [4.13 Impostazioni: meteo, tema, profilo](#413-impostazioni-meteo-tema-profilo)
   - [4.14 Magazzino — depositi, prodotti, lotti e giacenze](#414-magazzino--depositi-prodotti-lotti-e-giacenze)
   - [4.15 Parco macchine — mezzi, manutenzione e carburante](#415-parco-macchine--mezzi-manutenzione-e-carburante)
   - [4.16 Pianificazione Task e Modalità Campo — il flusso senza digitazioni](#416-pianificazione-task-e-modalità-campo--il-flusso-senza-digitazioni)
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
- **Switcher di vista** — tre pulsanti: **Mappa** (il lavoro sul campo), **Calendario** (tutto ciò che ha una data, §4.11) e **Command Center** (la dashboard analitica, §4.10). Le tre viste restano montate: passare dall'una all'altra non ricarica la mappa né rifà i calcoli.
- A destra: **LED di stato** (nell'edizione locale i dati restano sempre sul dispositivo), **selettore tema** (Chiaro / Scuro / Verde), **menu Aiuto** (`?`) e **menu profilo**.

**La sidebar dei moduli:**

Si apre dalla **maniglia** sul bordo della mappa e raccoglie tutti gli strumenti, raggruppati in moduli espandibili:

| Modulo | Strumenti |
|---|---|
| **Suolo** | Analisi indici (NDVI…), Mappe VRA |
| **Coltura** | Dati coltura, Modelli DSS |
| **Acqua** | Bilancio idrico |
| **Disegno** | Disegna appezzamento, Disegna infrastruttura, Disegna POI, Lista appezzamenti, Stampa |
| **Quaderno (QDC)** | Operazioni, Raccolta, Export SIAN |
| **Magazzino** | Prodotti e lotti (con l'anagrafica dei **Magazzini**), Parco macchine |
| **Impostazioni** | Anagrafica azienda, Meteo |

Cliccando uno strumento si apre il pannello corrispondente; cliccandolo di nuovo si chiude.

**I controlli della mappa** stanno nella colonna a destra e sono quelli nativi del motore cartografico, **tradotti nella lingua dell'app**: zoom **＋ / −**, **bussola** (trascina per ruotare, clicca per rimettere il nord in alto — quando la mappa è già a nord il pulsante mostra una piccola **N**), **schermo intero**, **trova la mia posizione**, **rilievo 3D**, **righello** (misura distanze e aree, con unità selezionabili), **gestore livelli** (visibilità, opacità, ordine, stile) e **🔍 Cerca luogo** per la ricerca toponomastica.

> **Quanto si può zoomare.** La mappa di campo si muove **solo fra lo zoom 13 e il 17**: sotto il 13 si guarderebbe una regione, sopra il 17 si sovracampionano pixel di ortofoto che non esistono — in mezzo c'è tutto il lavoro agronomico, dal comprensorio al filare. Sono gli **estremi assoluti**: dalle Impostazioni profilo puoi *stringere* l'intervallo (es. 14–16), mai allargarlo. Nota di contorno: l'ortofoto Esri ha copertura garantita fino allo zoom 18, quindi con questi limiti non capita mai di vedere tessere vuote.

**Simboli sulla mappa.** Oltre agli appezzamenti colorati per coltura, la mappa mostra da sé:

- 🏬 i **POI dei magazzini** georeferenziati (riquadro indaco, icona per tipologia, badge coi lotti in giacenza): un tocco apre la scheda di quel deposito (§4.14);
- **!** un pallino blu sui campi che hanno **lavorazioni previste** (task programmate o in corso): un tocco apre la scheda dell'appezzamento, da cui si avviano;
- **⚠** un triangolo ambra sui campi a cui **mancano dei dati** — tessitura del suolo, dati dichiarativi di campagna (SIAN/SIEX), righe del Quaderno incomplete. Il tocco porta direttamente dove si compila il dato più urgente. Compare **solo** dove c'è davvero qualcosa da sistemare: un simbolo su ogni campo non segnalerebbe più nulla.

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

> **Aperto dalla sidebar mostra sempre l'intera azienda.** È una garanzia, non una casualità: un registro di compliance non deve poter mostrare, senza dirlo, il sottoinsieme di un singolo appezzamento rimasto da una consultazione precedente. Se vuoi le operazioni di *un* campo, usa il filtro **Appezzamento** qui dentro, oppure tocca il campo sulla mappa e apri la sua scheda.

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

> **Scorciatoia dal campo:** clicca un appezzamento sulla mappa per aprirne la **scheda** (§4.16) — le operazioni già registrate su quel campo sono lì, insieme alle task programmate, e da lì apri il Quaderno o avvii la lavorazione.

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
2. Spunta gli **indici** da calcolare: **NDVI** (vigore), **NDRE** (stato azotato), **MSAVI2** e **SAVI** (corretti per il suolo nudo), **NDWI** (acqua libera) e **NDMI** (umidità della coltura, la spia dello stress idrico). Marca uno di essi come **indice primario**: è quello colorato sulla mappa.
3. Seleziona **uno o più appezzamenti**.
4. Regola il filtro **copertura nuvolosa** (slider %) e la **strategia temporale**: ultima immagine, ultimi 15/30 giorni, o un **intervallo personalizzato** (max 60 giorni, con grafico di trend).
5. Premi **Calcola**. Ottieni le medie più recenti per appezzamento/indice, la **griglia di celle colorate** sulla mappa e — se hai una serie con più date — il grafico dell'andamento.

> **La scala colore è relativa al campo, non assoluta.** I colori si distribuiscono sui valori realmente presenti nei campi calcolati (scartando il 2% agli estremi), non sull'intervallo teorico −1..1. È ciò che fa emergere la variabilità *interna* all'appezzamento — la stessa che serve per zonare una mappa VRA — invece di una macchia uniformemente verde. Il valore assoluto resta leggibile nella colorbar e nelle medie del pannello.

In fondo al pannello trovi anche lo **scatter NDVI ↔ chimica del suolo** (pH, sostanza organica, N-P-K), con il coefficiente di correlazione: utile per capire se il vigore segue la fertilità.

**Time slider — navigare le date sulla mappa.** Dopo un calcolo compare in basso sulla mappa una **barra temporale** con tutte le scene satellitari disponibili per l'appezzamento scelto: ti sposti da una data all'altra e la mappa si ridisegna, oppure premi **▶** per far scorrere la serie come un'animazione. Resta utilizzabile anche a pannello Suolo chiuso; il pulsante **Mostra / Nascondi time slider** in fondo al pannello lo fa sparire e ricomparire.

- Ogni scena mostra la sua **copertura nuvolosa** e se è **già calcolata** (in cache, ridisegno immediato) o **da calcolare** (viene elaborata al volo quando ci si sposta sopra).
- Nello stesso giorno il satellite può depositare più immagini: AgroGea tiene **la meno nuvolosa** e nasconde le altre come *doppioni del giorno*, mostrabili con un click se vuoi confrontarle.
- Se una scena non è più elaborabile (asset scaduti lato satellite) te lo dice e basta rilanciare l'analisi.

**Le immagini già calcolate restano sul dispositivo.** Ogni scena elaborata viene conservata localmente per **24 mesi** — due annate, così i confronti anno-su-anno restano possibili — e riaprendo l'app si ridisegna **senza rete**. All'avvio, non più di **una volta ogni 12 ore**, AgroGea controlla in background se il satellite ha depositato nuove immagini e ne calcola l'NDVI: quando apri il modulo il lavoro è spesso già fatto. È un dato ricalcolabile: non occupa spazio nei backup della sincronizzazione e può essere ricostruito in qualsiasi momento rilanciando l'analisi.

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
- **Lista appezzamenti** — l'elenco di tutto ciò che hai tracciato (appezzamenti, infrastrutture, POI). Il tap su una voce **inquadra** l'elemento sulla mappa e ne apre la scheda: parametri del suolo, metadati, modifica della geometria, eliminazione protetta. Aprendola esci dalla modalità disegno, così il tap sulla mappa torna a **selezionare** invece di tracciare.
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

- **Colture e appezzamenti** — l'analisi agronomica: filtri annata → coltura → campi, **indici personalizzati**, grafici componibili e report direzionale.
- **Azienda** — l'andamento generale: superficie/operazioni/raccolto dell'annata, **stato del Magazzino** (valore giacenze a CUMP, lotti scaduti/in scadenza, prodotti sotto scorta), **costo prodotti per campo** e backup/ripristino. Un alert cliccabile segnala le campagne con dati dichiarativi (SIAN/SIEX) incompleti.

#### Indici personalizzati (schede KPI)

Al posto della vecchia griglia di indici fissi, le schede KPI le **componi tu**. **＋ Aggiungi indice** e scegli, in quest'ordine:

1. **Sorgente dati** — Appezzamenti, Operazioni (Quaderno), Raccolte, Bilancio idrico, Meteo, DSS.
2. **Funzione** — Conteggio, Somma, Media, Minimo, Massimo o **Rapporto (A / B)** — e la **misura** su cui applicarla (es. quantità totale, kg raccolti, mm di pioggia, superficie).
3. **Periodo** — l'annata in corso, gli **ultimi N giorni**, o tutto lo storico.

Facoltativi ma utili: un **filtro** su una dimensione (es. solo i trattamenti fitosanitari), l'**unità di misura** e i decimali da mostrare, l'**andamento** (sparkline + variazione rispetto al periodo precedente) e le **soglie di colore**, con la direzione dell'allarme — *supera la soglia* per un indice che peggiora salendo (giorni di stress), *scende sotto* per uno che peggiora scendendo (NDVI medio).

Le schede si **trascinano per riordinarle** e si modificano o eliminano dalla scheda stessa. Sono **preferenze di visualizzazione**, salvate per azienda sul dispositivo: non entrano nei dati di dominio e non vengono sincronizzate. Alla prima apertura ne trovi tre di esempio (superficie in scope, operazioni dell'annata, pioggia degli ultimi 30 giorni): modificale o cancellale senza timori.

> Il **calendario delle operazioni** non vive più qui dentro: è diventato una vista a sé, raggiungibile dall'header (§4.11).

### 4.11 Calendario aziendale

Dal pulsante **Calendario** nell'header apri una **griglia mensile con tutto ciò che ha una data**, in un posto solo:

| Colore | Cosa mostra |
|---|---|
| **Task pianificate** | ciò che deve ancora essere fatto (tratteggiato: è futuro) |
| **Operazioni** | le registrazioni del Quaderno di Campagna |
| **Raccolte** | i conferimenti registrati |
| **Rischio DSS** | i giorni a rischio elevato dei modelli fitopatologici |
| **Stress idrico** | i giorni in cui il bilancio idrico segnala che è il momento di irrigare |

In ogni cella compare anche il **meteo del giorno** — icona, massima/minima e millimetri — sia per il passato sia per la previsione. È un dato di contorno: se sei offline le celle restano senza meteo e il calendario funziona ugualmente.

**Cosa puoi fare:**

- spostarti fra i mesi con **‹ ›** o tornare a **Oggi**; filtrare per **appezzamento** o vedere tutta l'azienda; accendere e spegnere le singole categorie dalla **legenda**;
- **cliccare un giorno** per aprirne il dettaglio: cosa è successo (o succederà) in quella data, il meteo, e due porte d'ingresso — **Pianifica task** e **Registra operazione**, entrambe **sul giorno che hai aperto**, mai su "oggi" per errore;
- ricaricare rischio DSS e bilancio idrico con il pulsante **⟳**.

> **Il calendario consulta il registro, non lo riscrive.** Operazioni e raccolte si aprono nella loro scheda di sola lettura: correzioni e cancellazioni restano dove vive il record (Quaderno, modulo Raccolta), perché un registro di rilevanza legale non deve avere due porte di modifica con regole diverse. Restano modificabili — e annullabili — le sole **task**, che sono pianificazione e non registrazione.
>
> DSS e stress idrico compaiono **appena i rispettivi calcoli vengono eseguiti** (dalla mappa o dal Command Center): il calendario li legge, non li ricalcola.

### 4.12 Esportazioni ufficiali e backup

**Registri per i controlli** — AgroGea sceglie il tracciato in base al **Paese** dell'azienda:

- **Italia — SIAN/PAN:** da **Quaderno (QDC) → Export SIAN**. CSV ottimizzato per Excel italiano (separatore `;`, BOM UTF-8), con codici ministeriali Isola/Appezzamento.
- **Spagna — SIEX/CUE:** *Cuaderno Digital* in JSON (FEGA).
- **Altri Paesi UE / Francia:** CSV internazionale (separatore `,`, date ISO).

L'export CSV copre l'**intero Quaderno di Campagna Agraria**: comprende sia i trattamenti sia le **raccolte** (riga «Raccolta» con quantità in kg e destinazione). Il tipo operazione è riportato **nella tua lingua**, non con codici interni. I **codici SIAN/SIEX** compaiono anche se compilati nella scheda coltura dopo aver registrato l'operazione: vengono risolti per appezzamento e annata, così basta completarli una volta in Dati coltura. Colonne, ordine, separatore e filtri (date, campi, colture, tipi) restano interamente configurabili.

**Import del Fascicolo SIAN** — puoi importare il Fascicolo Aziendale: AgroGea crea gli appezzamenti mancanti dalle geometrie, normalizza le colture e popola la Campagna dell'annata, riconoscendo i campi già presenti senza duplicati.

**Export delle geometrie** — appezzamenti e layer in **GeoJSON, KML, GPX, CSV, Shapefile**.

**Backup completo** — un'istantanea dell'intera azienda (anagrafica, appezzamenti, colture, Quaderno, raccolte, infrastrutture) in un unico file **GeoJSON Esteso**, e la relativa **importazione/ripristino**.

> Ogni import/export viene annotato in un **giornale dei trasferimenti** locale: hai sempre lo storico di cosa è entrato e uscito.

### 4.13 Impostazioni: meteo, tema, profilo

- **Meteo** (Impostazioni → Meteo) — configura la stazione/sorgente meteo che alimenta il bilancio idrico e il DSS.
- **Tema** — Chiaro / Scuro / Verde, dal selettore nell'header.
- **Profilo** — dal menu utente in alto a destra: preferenze e impostazioni dell'app. Qui, oltre a moduli visibili, lingua e unità di misura, c'è la **Vista della mappa**: *zoom minimo* e *zoom massimo* consentiti, selezionabili fra 13 e 17 (vedi §2). Serve a fissare la scala di lavoro: chi lavora sempre a filare può stringere a 16–17 e non perdere più l'inquadratura.

### 4.14 Magazzino — depositi, prodotti, lotti e giacenze

Il Magazzino tiene tre cose collegate: i **depositi** (dove la merce sta davvero), l'**anagrafica dei prodotti** e i loro **lotti** con scadenza, giacenza e costo. Le attività del Quaderno scaricano da qui.

> **La giacenza vive nel lotto, non nel prodotto.** È il singolo lotto ad avere una collocazione, e per questo lo stesso prodotto può stare in due depositi con scadenze e quantità diverse senza duplicare l'anagrafica.

#### I depositi

Un'azienda può averne quanti ne servono: il capannone, il deposito fitofarmaci sotto chiave, la cisterna del gasolio, il silos delle sementi.

1. Sidebar → **Magazzino** → **Prodotti e lotti** → pulsante **Magazzini**, in testa al pannello accanto al selettore.
2. **＋ Nuovo magazzino**: dai un **nome** ("Capannone Nord", "Deposito fitofarmaci") e scegli la **tipologia** — *Generico, Deposito fitosanitari, Deposito concimi, Deposito sementi, Cisterna carburante, Rimessa mezzi*. La tipologia non impone regole: sceglie l'**icona** con cui il deposito compare sulla mappa e aiuta a distinguerli in elenco.
3. **Posizione sulla mappa** (facoltativa): premi **Tocca la mappa**, poi tocca il punto dove il deposito sta. Da lì in avanti il magazzino è un **POI cliccabile** — riquadro indaco con l'icona della sua tipologia e un **badge** che conta i lotti in giacenza. Un magazzino senza posizione resta valido: è un magazzino "logico", raggiungibile solo dal modulo.
4. Facoltativi: **indirizzo** e **note**. Il ✏️ modifica un deposito esistente, anche solo per spostarne il punto.

**Aprire un magazzino dalla mappa:** tocca il suo POI. Il modulo si apre già **puntato su quel deposito**, qualunque schermata avessi lasciato aperta prima (un altro prodotto, l'anagrafica depositi, un form): chi tocca un magazzino sulla mappa si aspetta di vederne il contenuto, non di dover ritrovare la strada.

**Filtrare per deposito:** il selettore **Magazzino** in testa al pannello sceglie fra *Tutti i magazzini* — la vista aggregata, con l'anagrafica completa anche dei prodotti a giacenza zero — e un singolo deposito, dove compare **solo ciò che ci sta dentro**. Con un deposito selezionato, giacenze, alert di scadenza e badge di sotto-scorta sono calcolati **su quel deposito**.

**Eliminare un magazzino non elimina la merce:** i suoi lotti tornano **«non assegnati»** e continuano a contare nella giacenza complessiva dell'azienda. Chiudere un deposito è un fatto logistico, non una distruzione di scorte.

#### Prodotti e lotti

1. Sidebar → **Magazzino** → **Prodotti e lotti**.
2. **＋ Nuovo prodotto** e scegli la **categoria** (rigida — determina i campi obbligatori):
   - **Agrofarmaco** — richiede il **n. di registrazione PAN**; in più sostanza attiva e **carenza/rientro di default** (precompilati poi nel Quaderno);
   - **Concime** — richiede i **titoli N-P-K** (percentuali);
   - **Semente** — con l'**identità colturale** (specie, nome scientifico, varietà, tipo coltura): è ciò che abilita l'assegnazione automatica della coltura alla semina;
   - **Carburante** — richiede il codice di **assegnazione UMA**;
   - **Altro / materiali** — lubrificanti e consumabili, senza campi extra.

   Il form include il **carico iniziale** (magazzino di destinazione, lotto di produzione, scadenza, **quantità obbligatoria** e costo): un prodotto nasce già con la sua giacenza, e già collocata. Facoltativi per tutte le categorie: fornitore e **scorta minima** (sotto soglia appare il badge di riordino).
3. Dal dettaglio prodotto, **Carica lotto** aggiunge i carichi successivi, ciascuno col proprio **magazzino di destinazione**. Ogni carico aggiorna il **CUMP** (Costo Unitario Medio Ponderato) del prodotto con la media ponderata sulle giacenze — il CUMP è **di prodotto**, non di deposito: è il costo medio della merce, non del posto in cui è appoggiata. Nell'elenco dei lotti, ogni riga mostra il deposito in cui si trova.
4. **Importa CSV** — per popolare l'anagrafica in un colpo solo (es. il listino del consorzio o l'export del gestionale precedente), senza rete.

> **Il magazzino di destinazione è facoltativo.** Il selettore propone *Non assegnato*, ed è la scelta giusta finché non hai definito i depositi: la giacenza è reale e utilizzabile lo stesso, semplicemente non ha una collocazione. Se hai un solo magazzino viene proposto da sé, e se stai lavorando dentro un deposito è quello a essere preselezionato.

**Come si prepara il file CSV dei prodotti:**

- **Riga d'intestazione obbligatoria**; il separatore (`;` o `,`) viene riconosciuto da solo, così va bene anche un CSV salvato da Excel in italiano.
- **Colonne obbligatorie:** `category`, `name`, `unit`.
- **Facoltative:** `registration_number`, `active_substance`, `npk_n`, `npk_p`, `npk_k`, `uma_code`, `supplier`, `notes`, `min_stock`, `safety_period_days`, `reentry_interval_h`, `species`, `scientific_name`, `variety_name`, `crop_category` e — per il carico iniziale — `lot_number`, `expires_at`, `initial_quantity`, `unit_cost`.
- `category` accetta sia i codici (`phytosanitary`, `fertilizer`, `seed`, `fuel`, `other`) sia i nomi italiani (`agrofarmaco`, `concime`, `semente`, `carburante`, `altro`).
- **Valgono le stesse regole del form**, non una scorciatoia: agrofarmaci → n. di registrazione, concimi → titoli N-P-K fra 0 e 100, carburante → codice UMA.
- Il **carico iniziale è facoltativo**: con `initial_quantity` e `unit_cost` nasce anche il lotto e il CUMP si muove; senza, entra la sola anagrafica a giacenza zero. La scadenza va scritta come `AAAA-MM-GG`.

Il pulsante **Scarica modello** ti dà un CSV già impostato con una riga di esempio per categoria. Prima di scrivere qualcosa vedi l'**anteprima** con quante righe sono valide e, per ognuna, l'errore preciso (categoria sconosciuta, n. registrazione mancante, prodotto già presente in magazzino…): le righe valide si importano comunque, le altre restano fuori e le correggi con calma nel file.

> **Dove finiscono i lotti importati:** nel **deposito su cui il modulo è puntato** quando lanci l'import. Se il selettore è su *Tutti i magazzini*, i carichi entrano senza collocazione. Il file CSV non ha una colonna per il magazzino: seleziona prima il deposito, poi importa.

**Scarico dalle attività:** nel form del Quaderno (trattamenti, fertilizzazioni, semine) compare la sezione **Scarico da magazzino**: scegli prodotto → lotto → quantità. Al salvataggio la giacenza si scarica **realmente**, in un'unica transazione con l'attività: se la quantità supera la disponibilità, **l'intera registrazione fallisce** (nessuno scarico parziale) con un messaggio chiaro. Il costo dei prodotti (quantità × CUMP al momento dello scarico) è **imputato al campo trattato** e sarà la base del bilancio di campo.

**Scadenze:** i lotti **scaduti** sono evidenziati e il loro uso nelle attività è **bloccato** (non selezionabili); i lotti **in scadenza** entro la soglia configurabile (default 30 giorni) sono segnalati con un alert nel pannello.

> **Compatibilità:** le registrazioni esistenti con prodotti/mezzi a testo libero restano valide; lo scarico da magazzino è facoltativo e si affianca al testo libero finché non colleghi un lotto reale. Eliminando un'operazione con scarichi, le giacenze vengono **reintegrate** automaticamente. I lotti caricati **prima** dell'introduzione dei depositi multipli risultano *non assegnati*: nessun dato è cambiato, continuano a contare nella giacenza e restano utilizzabili nelle attività. La collocazione si sceglie **al carico**: un lotto già esistente non si sposta fra depositi (per collocare vecchie scorte, caricale nel deposito giusto man mano che rientrano).

---

### 4.15 Parco macchine — mezzi, manutenzione e carburante

Il Parco macchine gestisce i **mezzi** (unità motrici) e gli **attrezzi**, li collega alle operazioni di campo con **contatori ore automatici**, tiene lo scadenziario di **manutenzione** e **documenti**, e traccia i **rifornimenti** di carburante.

**Anagrafica (Sidebar → Magazzino → Mezzi):**

1. **＋ Nuovo mezzo** (trattore, mietitrebbia…) o **＋ Nuovo attrezzo** (aratro, botte…). I mezzi sono tracciati a **ore di lavoro**, gli attrezzi per **usura** e **larghezza di lavoro**. Alla creazione puoi indicare la **lettura iniziale** del contaore. Lo **stato** (operativo / in manutenzione / fermo-guasto / dismesso) ha un semaforo; i mezzi **dismessi** restano nello storico ma spariscono dalle liste di selezione.
2. **Import CSV** — popola velocemente il parco da un file (denominazione, tipo, targa, anno, contaore iniziale) con **anteprima e validazione**: le righe non valide sono segnalate e saltate, l'import parziale è consentito. Tutto in locale, senza rete.
3. Dal **dettaglio mezzo** gestisci: **contatore** (con rettifiche manuali tracciate — lettura iniziale, sostituzione motore), **documenti** con semaforo, **scadenziario manutenzione** e **consumo l/h**.

**Contatori automatici:** registrando un'operazione nel Quaderno (trattamento, fertilizzazione, semina, lavorazione, irrigazione) compare la sezione **Mezzo**: scegli il mezzo (e l'eventuale attrezzo) **dall'elenco** — niente testo libero — e le **ore**. Al salvataggio i contatori si **incrementano** in automatico; modificando o eliminando l'operazione si **ricalcolano** senza errori. Il form propone l'**ultima combinazione** usata e avvisa se il mezzo scelto **non è operativo** (senza bloccare). Se il mezzo non esiste, **＋ Nuovo mezzo** lo crea al volo e lo seleziona.

**Manutenzione:** crea piani **ordinari** o **straordinari** con scadenza a **tempo** (ogni N giorni / data) o a **ore** (soglia sul contaore). All'avvicinarsi o al superamento della soglia scatta l'**alert**. **Registra intervento** annota data, ore, descrizione, costo e ricambi; collegando un lotto di magazzino, il ricambio viene **scaricato** dalla giacenza (blocco atomico). L'intervento **riprogramma** automaticamente il piano ricorrente.

**Documenti:** revisione, assicurazione/RCA, bollo, collaudo. Ogni documento ha un **semaforo** (valido / in scadenza / scaduto) e genera l'alert a soglia sulla data di scadenza; puoi allegare un file locale.

**Refill carburante (pulsante rapido in mappa):** sotto il pulsante delle **note geotaggate** (colonna controlli, in alto a sinistra sulla mappa) trovi il pulsante **⛽ Refill**. A bordo campo aprilo: il form è **precompilato** (data odierna, ultimo mezzo, cisterna con più giacenza). Indica **litri** e la **cisterna** (un lotto di categoria *carburante*), con l'eventuale **lettura contaore**; salvi in un tap. Il rifornimento **scarica** la cisterna dal magazzino (blocco atomico se la giacenza non basta) e deriva il riferimento **UMA** dal prodotto. Dallo stesso pannello vedi l'elenco filtrabile per mezzo e per cisterna.

**Consumo e anomalie:** nel dettaglio mezzo il **consumo medio l/h** e l'ultimo intervallo si calcolano col metodo **pieno-a-pieno** (litri ÷ ore tra due pieni con lettura contaore). Un consumo che si discosta oltre soglia dalla media storica è segnalato come **anomalia** (possibile spia di guasto o lettura errata): è un avviso, non un blocco.

**Richiede attenzione:** in cima alla scheda Mezzi un cruscotto aggrega, senza click aggiuntivi, ciò che è **actionable** — manutenzioni in scadenza/scadute, documenti in scadenza/scaduti, consumi anomali e mezzi fermi. Ogni voce porta al dettaglio del mezzo.

> **Attivazione:** le sezioni **Mezzi** e il pulsante **Refill** si mostrano/nascondono dalle **Impostazioni profilo → Moduli** (voci `Parco macchine` e `Refill carburante`). Il Refill è **staccato** dal resto del Magazzino: si raggiunge solo dal pulsante rapido in mappa.

---

### 4.16 Pianificazione Task e Modalità Campo — il flusso senza digitazioni

L'idea è semplice: **decidi in ufficio, in trattore non tocchi più nulla**. Prepari la lavorazione la sera prima, e quando il giorno dopo entri nel campo il resto avviene da sé, fino alla registrazione nel Quaderno.

#### Prima: preparare la task (Sidebar → Pianificazione Task → Task & Ricette)

1. **＋ Nuova Ricetta** — una **miscela riutilizzabile** ("Anti-oidico standard", "Concimazione fogliare NPK"): dai un nome, aggiungi i prodotti con la **dose per ettaro** e l'unità. Scegliendo il prodotto dal **Magazzino** vengono ricopiati da soli numero di registrazione, sostanza attiva e — per i concimi — tipo e titolo N-P-K: sono i campi che il Quaderno pretenderà, ed è qui che si compilano una volta per sempre.
2. **＋ Nuova Task** — la **scheda di lavorazione programmata**. Scegli **per primo il tipo di operazione**: da quello dipendono i campi che compaiono, esattamente gli stessi che il Quaderno chiederebbe per quella lavorazione.

   | Tipo | Cosa ti chiede in più |
   |---|---|
   | Trattamento fitosanitario | ricetta, **avversità** (dalla stessa lista del Quaderno, non testo libero), n. patentino |
   | Fertilizzazione | ricetta |
   | Lavorazione del terreno | tipo di lavorazione |
   | Irrigazione | apporto in mm o hl |
   | Semina | semente dal Magazzino + dose |
   | Raccolta, Campionamento | nulla: bastano campo, data e operatore |

   La **ricetta esiste solo** per trattamenti e fertilizzazioni: le altre lavorazioni non hanno una miscela da preimpostare, e i loro dati si inseriscono come nel Quaderno. Il **numero di patentino** si imposta una volta e resta memorizzato sul dispositivo per tutti i form.

3. Se qualcosa manca, un avviso ti dice **esattamente quali campi renderebbero il record non conforme**. Puoi salvare comunque: la pianificazione resta veloce, e le task incomplete restano segnalate.

> **Quello che scrivi qui non lo riscrivi in campo.** Il tipo di lavorazione, l'apporto irriguo, la semente e la dose finiscono da soli nella riga del Quaderno alla chiusura della sessione — l'apporto irriguo convertito in litri **sulla superficie che dichiari di aver lavorato**. Scegliendo una ricetta che dichiara la propria avversità bersaglio, anche quella si compila da sé.

> **Perché insiste sui campi obbligatori:** la registrazione a fine lavorazione è automatica, quindi non c'è un momento in cui qualcuno rilegge e completa. Ciò che manca ora mancherebbe nel registro. Per questo la sidebar mostra un contatore **⚠** su *Pianificazione Task* e *Quaderno di Campagna*, con l'elenco dei record da completare.

#### In campo: il rilevamento è automatico

Non c'è nessun pulsante da premere e nessuna impostazione da attivare. Tenendo l'app aperta, quando **rimani nell'appezzamento per 15 secondi** compare una **scheda** al centro dello schermo — grande, ma non a tutto schermo: la mappa resta visibile intorno, così vedi dove sei mentre decidi.

La scheda dice **"Sei nel campo: [nome]"** e mostra:

- le **task programmate** su quel campo come righe selezionabili, con la più urgente **già selezionata** (se ce n'è una sola, non devi toccare nulla);
- oppure, se non hai pianificato niente, un selettore a pulsanti — **Trattamento**, **Concimazione**, **Lavorazione**, **Altro** — e la scelta della ricetta.

In fondo, sempre nello stesso posto, **due sole azioni**: **INIZIO** avvia ciò che è selezionato, **DOPO** rimanda.

I 15 secondi non sono un ritardo inutile: evitano che passare su una capezzagna o su una strada di servizio venga interpretato come "sono entrato a lavorare". Allo stesso modo, un'oscillazione del segnale vicino al confine non fa credere all'app che tu sia uscito.

> ⚠️ **Tempo di rientro.** Se sul campo è stato fatto un trattamento e l'intervallo di rientro **non è ancora scaduto**, la scheda mostra un avviso con il prodotto e le ore residue, e **INIZIO** resta disabilitato finché non spunti la presa visione. Non è un blocco — chi ha eseguito il trattamento può rientrare con i DPI — ma è la garanzia che **un altro operatore non entri senza saperlo**.

**Se pianifichi una task mentre sei già nel campo**, la scheda ricompare da sola: non devi uscire e rientrare.

#### Durante: la Modalità Campo

Avviata la lavorazione, lo schermo diventa **nero con cifre giganti verde-lime**: è pensato per essere letto al sole diretto dal sedile, non per essere elegante. Ignora volutamente il tema dell'app.

- **Velocità** e **tempo trascorso** aggiornati in tempo reale, la **superficie totale dell'appezzamento** e — a colpo d'occhio — **cosa stai facendo**: ricetta, prodotti e dosi presi dalla task. Se la task era già stata iniziata un altro giorno, vedi anche il **«Già svolto: N%»**.
- **PAUSA / RIPRENDI** e **CONCLUDI**, con aree di tocco oltre gli 88 px: si premono coi guanti. In pausa il tempo si congela.

> **Non vedi più gli ettari lavorati che salgono.** Erano una stima (lunghezza del tracciato × larghezza di lavoro) che prometteva una precisione che il GPS non ha: dipendeva dalla larghezza registrata sull'attrezzo, gonfiava il dato sulle passate sovrapposte e crollava a zero col segnale scadente. Ora la superficie la dichiari tu alla fine, in un tocco.
- **Nota vocale**: un tocco avvia, un tocco ferma. La registrazione viene **geotaggata** col punto in cui ti trovi e resta sul dispositivo; la riascolti dall'elenco.
- Se hai avviato per errore, **Annulla sessione** (con conferma) annulla tutto e riporta la task fra quelle da fare.

Il tracciato viene salvato a piccoli blocchi mentre lavori: se il telefono si spegne o l'app si chiude, perdi al massimo l'ultimo tratto, non la giornata. Riaprendo l'app la sessione riprende da dove era.

#### Alla fine: una domanda sola, poi si registra da sola

Premuto **CONCLUDI** compare **una sola domanda: «Quanto hai lavorato?»** — la quota di appezzamento che hai completato, con gli scatti rapidi **25 / 50 / 75 / 100%** (il 100% è già preselezionato, perché il caso normale è "ho finito"). Su quella percentuale si calcolano le quantità di prodotto e lo scarico di magazzino, quindi vale la pena dichiararla onestamente. La schermata ti mostra già gli **ettari corrispondenti** mentre muovi il cursore, e — se avevi lasciato la task a metà un altro giorno — quanto risultava **già registrato**, così non conti due volte lo stesso lavoro.

- **Sotto il 100% la task resta programmata**, con l'avanzamento salvato: domani il geofencing te la ripropone e riprendi da dove eri. Il lavoro di oggi è comunque già registrato.
- **Al 100% la task si chiude** e sparisce dall'elenco delle cose da fare.

Confermato, la lavorazione **è nel Quaderno di Campagna**: non c'è altro da confermare. Il riepilogo ti dice cosa è stato salvato:

- la **superficie lavorata** che hai dichiarato (se non risulta utilizzabile, si usa quella catastale e te lo segnala);
- la **durata attiva**, al netto delle pause;
- per ogni prodotto della ricetta, la **quantità totale ricalcolata** su quella superficie (`dose × ettari lavorati`);
- le note vocali registrate;
- se hai seminato su un campo ancora libero per l'annata, la **coltura assegnata automaticamente** all'appezzamento — come farebbe una semina registrata a mano nel Quaderno. Una coltura già in corso non viene mai sovrascritta.

Se la ricetta usava prodotti presenti in Magazzino, le **giacenze vengono scaricate** dal lotto con la scadenza più vicina, col costo imputato al campo. Se qualcosa richiede la tua attenzione — un lotto scaduto, una giacenza insufficiente, un prodotto non collegato all'anagrafica, la superficie ricaduta su quella catastale, o campi obbligatori ancora mancanti — te lo dice, con una scorciatoia per aprire il Quaderno e sistemare. **La lavorazione viene registrata in ogni caso**: un magazzino da correggere è un problema minore di una lavorazione mai annotata.

#### Se il GPS non collabora, o hai chiuso per sbaglio

Il rilevamento automatico è una comodità, non l'unica strada. **Tocca l'appezzamento sulla mappa** e si apre la sua **scheda**: superficie, coltura, le task programmate su quel campo e le operazioni già registrate, tutto in un posto solo. Il pulsante **Inizia** parte da lì.

Non è una scorciatoia che salta i controlli: apre la stessa scheda del rilevamento automatico, quindi l'avviso sul tempo di rientro e la presa visione restano identici. Serve quando il GPS è assente o impreciso, quando hai premuto **DOPO** e ci hai ripensato, o semplicemente quando preferisci indicare il campo con un dito invece di aspettare.

> **Stato del rilevamento.** In alto a destra nel riquadro *Pianificazione Task* c'è sempre scritto cosa sta succedendo, e conviene guardarlo se il banner non arriva:
>
> | Cosa leggi | Cosa significa |
> |---|---|
> | *Rilevamento campo attivo* | tutto a posto, sta ascoltando |
> | *Sei dentro un appezzamento* | ti ha riconosciuto, la permanenza sta scorrendo |
> | *Segnale GPS debole (±N m)* | i fix arrivano ma sono troppo imprecisi: **nessun ingresso scatterà** finché non migliora |
> | *Permesso GPS negato* | da concedere nelle impostazioni del dispositivo; appena lo fai il rilevamento **riparte da solo** |
> | *Connessione non sicura* | la pagina non è su HTTPS e il browser blocca il GPS: nessuna impostazione può rimediare, apri l'app dal desktop |
> | *Nessun appezzamento da monitorare* | non ci sono campi disegnati |
>
> Se leggi **±800 m o più**, il dispositivo non sta usando il GPS ma la posizione di rete: su iOS controlla *Posizione esatta*, su Android *Usa posizione precisa* nei permessi del browser. Accanto al messaggio d'errore c'è un **Riprova** per riavviare il rilevamento a mano.

La mappa continua a mostrare la tua posizione col suo pulsante GPS abituale, in alto a destra: quello è indipendente dal rilevamento.

---

## 5. Scorciatoie e produttività

- **Command Palette** — dal menu **Aiuto (`?`)** apri la palette per saltare a qualsiasi azione o pannello digitandone il nome (compresi **Apri Calendario** e **Apri Command Center**).
- **Frecce ← / →** — scorrono le tre viste nell'ordine **Mappa → Calendario → Command Center**. Non fanno nulla mentre scrivi in un campo di testo o quando il focus è sulla mappa (lì le frecce spostano la vista).
- **Clic su un campo** — apre la sua **scheda**: task programmate (avviabili) e operazioni registrate su quell'appezzamento, con le scorciatoie per pianificare o aprire il Quaderno.
- **Menu Aiuto** — Command Palette, elenco scorciatoie, diagnostica, feedback, aggiornamenti e informazioni.
- **Aggiornamenti automatici** — all'avvio l'app verifica nuove versioni e mostra un banner con le note di rilascio; nessun download parte senza il tuo consenso.

---

## 6. Il flusso consigliato di una stagione

Una traccia pratica che mette in fila i moduli nell'ordine tipico di una campagna:

1. **Setup** (una tantum): Anagrafica azienda → disegno di tutti gli appezzamenti → composizione del suolo dove disponibile.
2. **Inizio campagna:** imposta l'**annata** e assegna la **coltura** a ogni appezzamento (Passo 3). Registra **semina/trapianto** nel Quaderno per le annuali.
3. **Durante la stagione:**
   - tieni il **Calendario** come punto di partenza della giornata: task da fare, operazioni registrate, meteo, rischio DSS e stress idrico sulla stessa griglia (§4.11);
   - registra nel **Quaderno** trattamenti, fertilizzazioni, irrigazioni e lavorazioni;
   - monitora il vigore con l'**Analisi indici** (NDVI…);
   - pianifica le irrigazioni con il **Bilancio idrico** e tieni d'occhio la **mappa DSS**;
   - genera **mappe VRA** per le operazioni a dose variabile.
4. **Raccolta:** registra i conferimenti nel modulo **Raccolta**; analizza rese e vigore in **Tabella attributi** e **Command Center**.
5. **Fine campagna / controlli:** esporta i registri ufficiali (**SIAN/PAN** o equivalente) e fai un **backup GeoJSON** completo dell'azienda.

---

> Per la spiegazione scientifica dei moduli (indici satellitari, VRA, bilancio idrico, DSS) vedi la [Documentazione tecnica dei moduli](../technical/moduli-agronomici.md); per gli aggiornamenti automatici il documento [Desktop Auto-Update](../technical/desktop-auto-update.md).
