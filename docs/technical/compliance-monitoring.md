# Modulo Compliance — monitoraggio normativo (schema v25)

> Motori puri: [`plugins/agro-tools/src/compliance/`](../../plugins/agro-tools/src/compliance/).
> Modulo applicativo: [`apps/agro-field-suite/src/modules/compliance/`](../../apps/agro-field-suite/src/modules/compliance/).

## Che cosa è, e che cosa non è

Il modulo produce **autovalutazione**. Il controllo ufficiale è l'AMS (Area
Monitoring System, Reg. (UE) 2021/2116 art. 66) e appartiene all'Organismo
Pagatore; la verifica del biologico appartiene all'organismo di controllo.

Questo non è scritto in un tooltip. Sta:

- nella testa del pannello, prima di ogni esito;
- accanto all'esito di ogni singola scheda;
- nel campo `assessment: "self_assessment"` di **ogni** `CheckResult`, che il
  runner scrive e nessuna scheda può omettere;
- nel campo `disclaimer` del report esportato e nel nome del file.

## I cinque vincoli, e dove sono resi obbligatori dal codice

| Vincolo | Come è imposto |
|---|---|
| Nessun numero senza provenienza | `CheckResult.scenes` è costruito da `runCheck`, non dalle schede: una scheda non ha modo di produrre un esito senza le scene che lo sostengono |
| Soglie visibili e modificabili | Ogni soglia è un `CheckParameter` con default, estremi, unità e riferimento normativo. Il codice delle schede legge i parametri con `parameterValue`, mai una costante |
| Incertezza di prima classe | `Confidence` non è uno scalare ma la lista dei fattori, con `limitedBy` che nomina quelli che la stanno limitando |
| Quattro esiti, mai tre | `CheckOutcome` include `undecidable`, e il pannello lo conta accanto agli altri tre con un colore neutro — non quello d'errore |
| Serie grezza ispezionabile | `CheckResult.series` porta i punti usati; la scheda li mostra in tabella e in sparkline |

Un sesto vincolo è imposto centralmente dal runner: **una scheda non può
dichiarare `compliant` mentre elenca dati mancanti**. Elencare un dato mancante
accanto a un esito deciso è legittimo e utile; dichiarare la conformità mentre
manca qualcosa sarebbe una conformità per omissione, e l'esito scende ad
`attention`.

## Il modello di incertezza

Sette fattori, ognuno con uno score 0–1, un peso e una frase leggibile:

`scene_count` · `temporal_gap` · `cloud_cover` · `pure_pixels` ·
`resolution_fit` · `declared_data` · `archive_depth`

La confidenza è la **media pesata**, non il minimo: due schede a 0,4 possono
essere una "quasi buona tranne le nuvole" e l'altra "scarsa su tutto", e vanno
distinte. L'anello debole non annega comunque nella media, perché `limitedBy`
lo espone esplicitamente — è ciò che permette alla UI di dire *«confidenza 55%,
limitata da nuvolosità e numero di scene»* invece di mostrare un numero nudo.

L'osservabilità dichiarata dalla scheda mette un **tetto** alla confidenza
(`OBSERVABILITY_CEILING`): una scheda che osserva un oggetto più piccolo del
pixel non può risultare molto confidente solo perché quel giorno il cielo era
sereno.

### «Non decidibile» è una porta, non un punteggio basso

I presupposti bloccanti si verificano **prima** che il metodo giri, e
producono `undecidable` invece di un verdetto a bassa confidenza:

1. **scene** — meno di `minUsableScenes` utili nella finestra;
2. **pixel puri** — sotto `MIN_PURE_PIXELS` (10). La stima
   (`purePixelEstimate`) toglie una corona di un pixel dal bordo assumendo la
   forma quadrata: 0,3 ha è un quadrato di ~55 m che, tolti 10 m per lato, ne
   lascia ~35, cioè una dozzina di pixel. È il conto che spiega perché sotto
   quella taglia Sentinel-2 non basta, e non basterà aspettando;
3. **archivio** — meno annate di quante `archiveYears` ne chieda;
4. **dati dichiarati** — il Quaderno o la campagna non bastano.

La confidenza si calcola **anche** per gli `undecidable`: i suoi fattori sono la
spiegazione di perché non si è deciso.

Le schede non satellitari (`requires.indices` vuoto — il biologico, la BCAA 4)
saltano i presupposti satellitari e i relativi fattori, che nella loro
confidenza sarebbero rumore.

## Come si naviga

**"Normativa" è un modulo di primo livello della sidebar**, non una voce delle
Impostazioni Azienda. La conformità PAC è lavoro agronomico ricorrente — si
consulta durante la campagna, non quando si configura l'applicazione. Sotto il
modulo stanno le **famiglie di schede**, una voce ciascuna:

Ammissibilità · Condizionalità (BCAA) · Eco-schemi · Trasversali · Biologico ·
Layer vincolanti

Ogni voce apre il pannello già puntato su quella famiglia, con lo stesso
meccanismo del Magazzino (`openComplianceGroup`, gemello di `openWarehouseTab`).
La famiglia la dichiara la scheda (`CheckSpec.group`): non si indovina dall'id,
così una scheda di plugin finisce dove ha detto di voler stare.

### L'appezzamento si sceglie nel modulo, non sulla mappa

`compliancePlotId` è **distinto** da `selectedPlotId`, ed è la scelta centrale
di questa UI: il click su un poligono apre il **Quaderno di Campagna** e deve
continuare a farlo — è il gesto più frequente della giornata di lavoro, e
dirottarlo sarebbe un peggioramento pagato da tutti per il beneficio di pochi.

Il pannello ha quindi il proprio selettore, che mostra **appezzamento + coltura
dichiarata** per l'annata attiva: senza la coltura la scelta sarebbe una lista di
nomi propri, e metà delle schede (coerenza colturale, rotazione, eco-schemi) non
avrebbe senso. Un test verifica che `openComplianceGroup` e `setCompliancePlotId`
non tocchino `selectedPlotId`.

### La valutazione si attiva

Le schede **non partono all'apertura del pannello**. Aprire una schermata non è
chiedere un giudizio: un esito comparso da solo invita a leggerlo come un fatto
invece che come un'analisi, e sulle schede pluriennali comporterebbe uno scarico
di scene mai autorizzato. Cambiare appezzamento o annata azzera i risultati, che
non si riferiscono più a ciò che si sta guardando; ritoccare una soglia rilancia
l'analisi, perché il risultato a schermo è stato calcolato con il valore
precedente.

## Il catalogo

Diciannove schede, `data-driven` per paese: `reference.countries` è `"*"` per
gli obblighi unionali e un elenco ISO per quelli nazionali. `CheckRegistry.list({
country })` filtra — gli eco-schemi italiani e i periodi sensibili della BCAA 6
spariscono da un'installazione francese invece di dare un esito sbagliato con
l'aria di essere giusto.

**A — Ammissibilità**: A1 attività agricola · A2 coerenza colturale ·
A3 superficie dichiarata.
**B — Condizionalità**: B1 GAEC 4 fasce tampone · B2 GAEC 5 pendenza ·
B3 GAEC 6 copertura del suolo · B4 GAEC 7 rotazione · B5 GAEC 8 elementi non
produttivi · B6 GAEC 9 prati permanenti · B7 GAEC 2 zone umide · B8 GAEC 3
bruciatura stoppie.
**C — Eco-schemi (IT)**: C1 inerbimento arboree · C2 foraggeri estensivi ·
C3 colture intercalari.
**D — Trasversali**: D1 sfalci · D2 date di semina e raccolta · D3 EUDR ·
D4 irrigazione.
**Biologico**: `organic_inputs` (non satellitare).

Due schede dichiarano di **non poter decidere** quasi sempre, e restano nel
catalogo di proposito: **B5** (siepi e margini sono sotto il pixel da 10 m:
servono ortofoto o VHR) e **D4** (l'irrigazione richiederebbe SAR o termico).
Sapere quale controllo non si può anticipare vale quanto sapere gli altri, e
toglierle dall'elenco lascerebbe l'utente col dubbio che ce ne siamo
dimenticati.

Ogni scheda porta in testa al proprio file un commento che dice **che cosa dice
la norma, che cosa si osserva davvero e perché il metodo è difendibile**, più i
limiti dichiarati. Chi legge fra un anno deve poter contestare il metodo, non
indovinarlo.

## L'estensione della pipeline: NBR e B12

La pipeline scarica B03, B04, B05, B08 e B11. La sola **B8** (GAEC 3, bruciatura
delle stoppie) richiede il **NBR**, e quindi **B12 (SWIR2)**: l'indice è stato
aggiunto esplicitamente a `REQUIRED_BANDS` in
[`indices.ts`](../../plugins/agro-tools/src/indices.ts) con il suo commento,
perché attivarlo aggiunge una banda allo scarico di ogni scena. Se le scene in
cache non portano il NBR — perché elaborate prima — l'esito è `undecidable` con
l'indicazione che serve una rielaborazione: non un silenzio.

## Il costo dell'analisi si dice prima

La cache locale tiene **24 mesi** di scene (`CACHE_RETENTION_MONTHS`). Le schede
pluriennali chiedono di più: la D3 (EUDR) risale al cut-off del 2020, cioè sei
annate. `estimateAnalysisCost` calcola quante scene servirebbero e il pannello
lo mostra **prima** di lanciare il recupero: su una connessione a consumo,
scaricare centinaia di scene senza chiedere sarebbe far spendere soldi
all'utente a sua insaputa.

## Dove sta il calcolo pesante

Non nel modulo. Le schede sono funzioni pure che leggono una serie temporale
**già in cache** (`vegetation_index_scenes`): decine di punti, millisecondi. Il
lavoro pesante — scaricare i COG, ritagliarli sul poligono, calcolare gli
indici — è quello della pipeline del modulo Suolo, che gira già nel suo Web
Worker e alimenta quella cache. Non c'è un secondo worker da introdurre: c'è una
cache da riusare.

## Il biologico non è satellitare

Un campo biologico e uno convenzionale hanno lo stesso aspetto spettrale: la
quasi totalità delle non conformità biologiche non lascia firma osservabile a
10 m. Il motore
([`organic/`](../../plugins/agro-tools/src/compliance/organic/)) legge quindi il
Quaderno e i **lotti realmente scaricati** dal magazzino (`activity_products`),
non le dosi pianificate.

**Tre regole di onestà:**

1. **Una sostanza sconosciuta non è vietata.** L'elenco di riferimento
   ([`substances.ts`](../../plugins/agro-tools/src/compliance/organic/substances.ts))
   è *reference data versionato* — atto e data di versione viaggiano con
   l'esito — ed è dichiaratamente **parziale**. Per poter dire "non ammessa"
   senza dedurlo dal silenzio esiste un secondo elenco, quello delle sostanze di
   sintesi esplicitamente incompatibili: ciò che non sta né di qua né di là è
   **non decidibile**.
2. **Un dato mancante non produce un verdetto.** Senza il titolo di rame del
   prodotto (`products.metadata.copper_content_pct`) la dose di formulato non si
   converte in kg di rame — 5 kg al 20% e 5 kg al 50% sono 1 e 2,5 kg — e
   l'esito è `undecidable` con l'indicazione di quale dato aggiungere.
3. **Le operazioni incomplete si elencano come tali**, e non contano né come
   conformi né come non conformi.

Controlli: sostanze ammesse (Reg. (UE) 2018/848 e 2021/1165, All. I e II) ·
rame 28 kg/ha su finestra mobile di 7 anni · azoto organico 170 kg N/ha/anno
(la costante `NITROGEN_LIMIT_KG_HA` ha **una** definizione, in `@agrogea/tools`;
`geo-compliance.ts` la ri-esporta come `NITROGEN_MAX_ZVN_KG_HA`) · periodo di
conversione 24/36 mesi da `regime_since` (il campo introdotto dalla v24).

> Nota sui mesi di conversione: `@agrogea/core` espone `ORGANIC_CONVERSION_MONTHS`
> per gli usi di dominio (etichette, promemoria) e il motore li espone come
> **parametri** modificabili. I due punti sono allineati di proposito, e
> documentati come tali qui perché `@agrogea/core` non dipende da
> `@agrogea/tools`.

## Persistenza: che cosa si salva e che cosa no

| Dato | Dove | Perché |
|---|---|---|
| Override dei parametri | `compliance_parameter_overrides`, sincronizzata, **nel backup** (sezione `compliance`) | È una SCELTA dell'utente: perderla in un ripristino cambierebbe gli esiti in silenzio |
| Esiti delle schede | **nessuna tabella** | Interamente ricalcolabili da scene e Quaderno. Una cache ricalcolabile in un backup invecchia male: al ripristino sembrerebbe un giudizio dato oggi su dati di ieri |

Se un domani il ricalcolo diventasse costoso al punto da giustificare una
cache, quella cache nascerebbe **local-only** — come `dss_results` e
`vegetation_index_scenes` — non sincronizzata e fuori dal backup.

Il formato di scambio passa a **3.1.0** (minor additivo): la sezione
`compliance` si aggiunge, un file 3.0 la rilegge come vuota e il suo `scope` non
la dichiara — che è la differenza fra "nessun override" e "sezione non inclusa".

## Il punto di innesto dei plugin

**DOP, DOCG, IGP e disciplinari di consorzio restano fuori** da questo
repository: ognuno ha il proprio disciplinare, cambia con tempi suoi e riguarda
una manciata di aziende. Vivranno in plugin scaricabili, in repo separate.

La giuntura **esiste già** lato GeoLibre e non va reinventata:

- `GeoLibreExternalPluginManifest` ([`packages/plugins/src/types.ts`](../../packages/plugins/src/types.ts)) — id, nome, versione, entry point;
- `isAllowedPluginManifestUrl` ([`packages/core/src/project.ts`](../../packages/core/src/project.ts)) — **solo HTTPS**, o HTTP su loopback in sviluppo. È lo stesso vincolo del dialogo Impostazioni e del caricamento di un progetto, e vale perché da un manifest si arriva a codice scaricato ed eseguito.

Il modulo espone `registerComplianceCheck` in
[`compliance-registry.ts`](../../apps/agro-field-suite/src/modules/compliance/compliance-registry.ts).
In questa fase **non si carica alcun plugin**: c'è solo la funzione con cui un
plugin, una volta caricato da quel percorso, registra le proprie schede.
Fermarsi qui è deliberato — un sistema di plugin a metà è peggio di nessun
sistema di plugin.

Un id già registrato viene **rifiutato**, non sovrascritto: una scheda di plugin
che rimpiazzasse in silenzio una del core cambierebbe il significato di un esito
che l'utente mostra a terzi.
