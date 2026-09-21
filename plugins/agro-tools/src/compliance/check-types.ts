import type { VegetationIndex } from "../indices";
import type { ComplianceMessageId } from "./check-messages";

export type { ComplianceMessageId } from "./check-messages";

/**
 * Tipi comuni delle schede di monitoraggio normativo (modulo Compliance).
 *
 * ## Che cosa produce questo modulo, e che cosa non produce
 *
 * **Autovalutazione, mai un verdetto.** Il controllo ufficiale è l'AMS (Area
 * Monitoring System, Reg. (UE) 2021/2116 art. 66) ed è dell'Organismo Pagatore:
 * qui si osserva un archivio satellitare pubblico con metodi dichiarati, per
 * dare all'agricoltore un'idea di dove guardare prima che lo faccia qualcun
 * altro. Ogni {@link CheckResult} porta con sé `assessment: "self_assessment"`
 * proprio perché non possa essere presentato per ciò che non è.
 *
 * ## I cinque vincoli che questi tipi rendono obbligatori
 *
 * 1. **Nessun numero senza provenienza** — {@link CheckResult.scenes} elenca le
 *    scene realmente usate (id STAC, data, nuvolosità, pixel validi).
 * 2. **Soglie sempre visibili e modificabili** — {@link CheckParameter} porta
 *    valore, default, unità, origine (default/override) e il riferimento
 *    normativo accanto. Nel codice non esistono costanti magiche: se un numero
 *    decide un esito, è un parametro.
 * 3. **L'incertezza è un dato di prima classe** — {@link Confidence} non è uno
 *    scalare ma la lista dei fattori che la determinano, con l'indicazione di
 *    QUALI la stanno limitando.
 * 4. **Quattro esiti, mai tre** — `undecidable` è un esito legittimo e
 *    frequente, non un errore: vedi {@link CheckOutcome}.
 * 5. **Serie grezza sempre ispezionabile** — {@link CheckResult.series} punta
 *    ai punti su cui la conclusione poggia, così il metodo si può contestare
 *    invece di indovinare.
 *
 * Il pacchetto è framework-free e non importa `@agrogea/core`: i tipi di
 * ingresso ricalcano STRUTTURALMENTE quelli di dominio (stessa convenzione di
 * `geofencing.ts`, `machinery.ts`, `reentry.ts`).
 */

// ---------------------------------------------------------------------------
// Esito e riferimenti
// ---------------------------------------------------------------------------

/**
 * Esito di una scheda. Quattro, mai tre:
 *   * `compliant` — l'osservazione è coerente con l'obbligo;
 *   * `attention` — coerente ma vicina al limite, o con un segnale che merita
 *     una verifica a terra;
 *   * `non_compliant` — l'osservazione contraddice l'obbligo;
 *   * `undecidable` — **non ci sono i presupposti per decidere**. È l'esito
 *     onesto quando mancano scene, pixel puri, archivio o dati dichiarati: si
 *     mostra come tale, non come errore né come "conforme per default".
 */
export type CheckOutcome =
  | "compliant"
  | "attention"
  | "non_compliant"
  | "undecidable";

/** Riferimento all'atto normativo che genera l'obbligo osservato. */
export interface RegulatoryReference {
  /** Atto (es. "Reg. (UE) 2021/2115"). */
  act: string;
  /** Disposizione puntuale (es. "All. III — BCAA 6"), se pertinente. */
  provision: string | null;
  /**
   * Paesi in cui la scheda si applica (ISO 3166-1 alpha-2), o `"*"` per gli
   * obblighi unionali uniformi. La BCAA italiana non è quella francese: il
   * catalogo è data-driven e filtrato sul paese dell'azienda.
   */
  countries: readonly string[] | "*";
  /** Link alla fonte, quando esiste in forma stabile. */
  url: string | null;
}

// ---------------------------------------------------------------------------
// Messaggi
// ---------------------------------------------------------------------------

/**
 * Messaggio destinato alla UI: id di catalogo + valori d'interpolazione. Il
 * motore è puro e non conosce la lingua; le stringhe vivono in `i18n`
 * (`compliance.messages.<id>`), come impone la convenzione del repository.
 *
 * L'id è un'UNIONE FINITA ({@link ComplianceMessageId}) e non una stringa
 * libera: così `t(\`compliance.messages.${id}\`)` resta type-checkato contro
 * `en.json` e una scheda non può inventare un testo che nessuno ha tradotto.
 */
export interface ComplianceMessage {
  id: ComplianceMessageId;
  values?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Parametri
// ---------------------------------------------------------------------------

/**
 * Dichiarazione di un parametro di una scheda: il default con cui nasce e la
 * norma da cui quel default viene. Nessuna soglia è sepolta nel codice.
 */
export interface CheckParameterSpec {
  id: string;
  defaultValue: number;
  /** Unità leggibile (`"NDVI"`, `"giorni"`, `"%"`, `"kg/ha"`, `"°"`). */
  unit: string | null;
  /** Estremi ammessi per l'override dell'utente. */
  min: number;
  max: number;
  /** Da dove viene il default: la norma, o la letteratura agronomica. */
  reference: RegulatoryReference | null;
  /** Spiegazione di che cosa cambia muovendo la soglia. */
  description: ComplianceMessage;
}

/** Parametro risolto per un calcolo: valore effettivo + provenienza. */
export interface CheckParameter extends CheckParameterSpec {
  value: number;
  source: "default" | "override";
}

/** Override dell'utente, per scheda e parametro. */
export type ParameterOverrides = Readonly<
  Record<string, Readonly<Record<string, number>> | undefined>
>;

// ---------------------------------------------------------------------------
// Provenienza dell'osservazione
// ---------------------------------------------------------------------------

/**
 * Una scena satellitare realmente usata. È la risposta alla domanda "da dove
 * viene questo numero": senza queste righe l'esito non sarebbe verificabile da
 * nessuno, nemmeno da chi lo ha calcolato.
 */
export interface SceneProvenance {
  /** Id dell'item STAC. */
  sceneId: string;
  /** Istante di ripresa (ISO). */
  sensedAt: string;
  /** Collection STAC (es. `"sentinel-2-l2a"`). */
  collection: string;
  /** Risoluzione al suolo in metri della banda principale usata. */
  gsdM: number;
  cloudCoverPct: number | null;
  /** Pixel con dato valido dentro il poligono. */
  validPixels: number;
}

/** Un punto della serie temporale degli indici, sul poligono dell'appezzamento. */
export interface IndexSeriesPoint {
  date: string;
  sceneId: string;
  collection: string;
  gsdM: number;
  cloudCoverPct: number | null;
  validPixels: number;
  /** Medie zonali per indice (`ndvi`, `ndmi`, `nbr`, …). */
  values: Partial<Record<VegetationIndex, number>>;
}

/**
 * Serie temporale ispezionabile: è ciò che la UI apre quando l'utente vuole
 * vedere con i propri occhi su che cosa poggia la conclusione.
 */
export interface IndexSeries {
  plotId: string;
  /** Punti ordinati per data CRESCENTE. */
  points: readonly IndexSeriesPoint[];
}

/** Riferimento alla porzione di serie usata da una scheda. */
export interface IndexSeriesRef {
  plotId: string;
  index: VegetationIndex;
  from: string;
  to: string;
  /** Punti effettivamente considerati (già filtrati per nuvolosità e finestra). */
  points: readonly IndexSeriesPoint[];
}

// ---------------------------------------------------------------------------
// Incertezza
// ---------------------------------------------------------------------------

/**
 * Fattore di incertezza. Ogni scheda ne espone la lista: l'utente deve poter
 * capire **perché** la confidenza è quella, non solo quanto vale.
 */
export type ConfidenceFactorId =
  /** Numero di scene utili rispetto a quelle attese nella finestra. */
  | "scene_count"
  /** Massimo intervallo scoperto fra due scene utili consecutive. */
  | "temporal_gap"
  /** Nuvolosità media delle scene usate. */
  | "cloud_cover"
  /** Pixel puri stimati dopo il buffer negativo sui bordi. */
  | "pure_pixels"
  /** Rapporto fra la dimensione dell'oggetto osservato e la risoluzione. */
  | "resolution_fit"
  /** Completezza dei dati dichiarati (Quaderno, campagna, magazzino). */
  | "declared_data"
  /** Profondità dell'archivio rispetto agli anni richiesti dal metodo. */
  | "archive_depth";

export interface ConfidenceFactor {
  id: ConfidenceFactorId;
  /** Quanto questo fattore sostiene la conclusione (0 = per nulla, 1 = pieno). */
  score: number;
  /** Peso nella media. Le schede possono pesarli diversamente, motivandolo. */
  weight: number;
  /** Che cosa si è osservato, in forma leggibile ("4 scene utili su 9 attese"). */
  observed: ComplianceMessage;
  /** True se sta tirando giù la confidenza (sotto {@link LIMITING_SCORE}). */
  limiting: boolean;
}

export interface Confidence {
  /** Media pesata degli score, 0..1. */
  value: number;
  factors: readonly ConfidenceFactor[];
  /** I fattori che la stanno limitando: è la parte che la UI deve mostrare. */
  limitedBy: readonly ConfidenceFactorId[];
}

// ---------------------------------------------------------------------------
// Dati mancanti
// ---------------------------------------------------------------------------

/**
 * Un dato che manca e senza il quale non si decide. Non è un errore: è
 * l'indicazione operativa di che cosa completare perché la scheda possa
 * pronunciarsi.
 */
export interface MissingInput {
  /** Che cosa manca. */
  what: ComplianceMessage;
  /** Dove si completa. */
  where:
    | "logbook"
    | "registry"
    | "campaign"
    | "products"
    | "archive"
    | "layers"
    | "pipeline";
  /** Come si completa. */
  howToFix: ComplianceMessage;
}

// ---------------------------------------------------------------------------
// Ingresso di una scheda
// ---------------------------------------------------------------------------

/** Appezzamento osservato (compatibile con `Plot` di `@agrogea/core`). */
export interface CheckPlot {
  id: string;
  name: string;
  /** Superficie geodetica in ettari: governa la stima dei pixel puri. */
  areaHa: number;
}

/** Campagna dichiarata (compatibile con `PlotCampaign`). */
export interface DeclaredCampaign {
  plotId: string;
  campaignYear: number;
  declaredAreaHa: number;
  /** Nome comune della coltura dichiarata, se risolvibile. */
  cropName: string | null;
  /** Categoria colturale (`seminativo`, `viticoltura`, …). */
  cropCategory: string | null;
  /** Codice ministeriale della coltura. */
  cropExternalCode: string | null;
  productionRegime: string | null;
  regimeSince: string | null;
  closedAt: string | null;
}

/** Lotto realmente scaricato su un'operazione (compatibile con `ActivityProduct`). */
export interface DeclaredIssue {
  productId: string;
  productName: string;
  category: string;
  /** Quantità realmente scaricata, nell'unità del prodotto. */
  quantity: number;
  unit: string;
  activeSubstance: string | null;
  registrationNumber: string | null;
  /** Titolo di rame metallo in % (chiave `copper_content_pct` dei metadata). */
  copperContentPct: number | null;
  /** Titolo di azoto in % (dai titoli N-P-K del concime). */
  nitrogenContentPct: number | null;
  /** Origine del fertilizzante, se dichiarata (`organic` | `mineral`). */
  fertilizerOrigin: string | null;
}

/** Operazione del Quaderno (compatibile con `TreatmentLog` + i lotti scaricati). */
export interface DeclaredOperation {
  id: string;
  plotId: string | null;
  operationType: string;
  executedAt: string;
  productName: string | null;
  registrationNumber: string | null;
  activeSubstance: string | null;
  doseValue: number | null;
  doseUnit: string | null;
  totalQuantity: number | null;
  fertilizerType: string | null;
  npkRatio: string | null;
  /** Lotti realmente scaricati: le quantità VERE, non quelle pianificate. */
  issues: readonly DeclaredIssue[];
}

/** Esito dei layer vincolanti già valutati a monte (riuso di `geo-compliance`). */
export interface LayerFindings {
  /** Layer effettivamente caricati: senza il layer non si decide. */
  available: readonly string[];
  /** Layer intersecati dall'appezzamento. */
  intersects: readonly string[];
  /**
   * Distanza minima dal reticolo idrografico in metri, quando il layer c'è.
   * `null` = layer assente o distanza non calcolabile.
   */
  minDistanceToWaterM: number | null;
}

/**
 * Ortofoto caricata dall'utente e ritagliata sull'appezzamento.
 *
 * Esiste per un motivo solo: Sentinel-2 a 10 m **non risolve** siepi, filari e
 * margini di campo (BCAA 8). Un'ortofoto a 20–50 cm sì, ed è ciò che usa
 * l'Organismo Pagatore. Caricandola, l'utente porta nel modulo la stessa
 * risoluzione su cui verrà controllato.
 */
export interface OrthophotoSummary {
  /** Nome del file, per la provenienza dell'esito. */
  fileName: string;
  /** Risoluzione al suolo in metri (es. 0.2 per 20 cm). */
  gsdM: number;
  /** Numero di bande disponibili: da 3 in su si può stimare il verde. */
  bandCount: number;
  /** Data di ripresa dichiarata dal file, se presente. */
  capturedAt: string | null;
  /** Pixel dell'ortofoto interni al poligono. */
  pixelsInPlot: number;
  /**
   * Quota di pixel classificati come vegetazione da Excess Green, o `null` se
   * le bande non bastano. È una stima RGB **indicativa**, non una
   * classificazione: lo dichiara la scheda che la usa.
   */
  vegetatedShare: number | null;
}

/** Sintesi morfologica dell'appezzamento (da DEM), quando disponibile. */
export interface TerrainSummary {
  /** Pendenza media in gradi. */
  meanSlopeDeg: number;
  /** Pendenza massima in gradi. */
  maxSlopeDeg: number;
  /** Quota della fonte del DEM, per la provenienza. */
  source: string;
}

/**
 * Tutto ciò che una scheda riceve. Nessuna scheda legge l'orologio, la rete o
 * il database: se un dato non è qui, la scheda non lo conosce — ed è ciò che
 * rende ogni esito riproducibile a partire dal suo ingresso.
 */
export interface CheckInput {
  plot: CheckPlot;
  campaignYear: number;
  /** Paese dell'azienda (ISO 3166-1 alpha-2): seleziona il catalogo. */
  country: string;
  series: IndexSeries;
  /** Tutte le campagne note dell'appezzamento, ordine indifferente. */
  campaigns: readonly DeclaredCampaign[];
  /** Operazioni del Quaderno sull'appezzamento, ordine indifferente. */
  operations: readonly DeclaredOperation[];
  layers: LayerFindings;
  terrain: TerrainSummary | null;
  /** Ortofoto caricata per questo appezzamento, se presente. */
  orthophoto: OrthophotoSummary | null;
  /** Parametri risolti (default + override), per id. */
  parameters: Readonly<Record<string, CheckParameter>>;
  /** Istante del calcolo, iniettato: le funzioni pure non leggono l'orologio. */
  now: string;
}

// ---------------------------------------------------------------------------
// Uscita di una scheda
// ---------------------------------------------------------------------------

/**
 * Ciò che una scheda restituisce. NON è il risultato finale: la busta di
 * trasparenza (provenienza, parametri, confidenza, disclaimer) la costruisce
 * {@link runCheck}, così venti schede non possono implementarla in venti modi
 * diversi — che è esattamente il punto.
 */
export interface CheckVerdict {
  outcome: CheckOutcome;
  explanation: ComplianceMessage;
  /** Fattori specifici della scheda, fusi con quelli comuni. */
  factors?: readonly ConfidenceFactor[];
  /** Popolato quando la scheda stessa non può decidere. */
  missing?: readonly MissingInput[];
  /** Serie effettivamente guardata, per l'ispezione. */
  series?: IndexSeriesRef | null;
  /** Scene realmente usate; se assente valgono quelle della finestra. */
  usedSceneIds?: readonly string[];
}

/** Risultato completo di una scheda su un appezzamento e un'annata. */
export interface CheckResult {
  checkId: string;
  plotId: string;
  campaignYear: number;
  reference: RegulatoryReference;
  /** Che cosa si osserva davvero. */
  subject: ComplianceMessage;
  /** Con quale metodo, e perché è difendibile. */
  method: ComplianceMessage;
  /** Finestra temporale osservata. */
  window: { from: string; to: string };
  /** Osservabilità dichiarata dalla scheda: onestà preventiva. */
  observability: Observability;
  parameters: readonly CheckParameter[];
  scenes: readonly SceneProvenance[];
  outcome: CheckOutcome;
  confidence: Confidence;
  explanation: ComplianceMessage;
  /** Che cosa manca e come completarlo (vuoto se non serve nulla). */
  missing: readonly MissingInput[];
  series: IndexSeriesRef | null;
  computedAt: string;
  /**
   * Il modulo produce AUTOVALUTAZIONE. Il campo è un valore letterale e non un
   * booleano perché finisce anche negli export, dove deve restare leggibile da
   * chi apre il file senza conoscere il codice.
   */
  assessment: "self_assessment";
}

/**
 * Quanto l'oggetto dell'obbligo è realmente osservabile con il sensore
 * disponibile. È dichiarata dalla scheda e mostrata PRIMA dell'esito: una
 * scheda a osservabilità `low` che dice "non decidibile" sta funzionando
 * correttamente, non fallendo.
 */
export type Observability = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Dichiarazione di una scheda
// ---------------------------------------------------------------------------

/** Bande Sentinel-2 usate dalla pipeline (chiavi asset STAC). */
export type BandId = "B03" | "B04" | "B05" | "B08" | "B11" | "B12";

/** Dati dichiarati che una scheda può richiedere per potersi pronunciare. */
export type DeclaredRequirement =
  | "campaign"
  | "crop"
  | "declaredArea"
  | "operations"
  | "productionRegime"
  | "issues"
  | "terrain"
  | "waterNetworkLayer"
  | "protectedAreaLayer"
  | "wetlandLayer"
  | "deforestationLayer";

/** Presupposti di una scheda: se non ci sono, l'esito è `undecidable`. */
export interface CheckRequirements {
  /** Indici (e quindi bande) necessari alla scheda. */
  indices: readonly VegetationIndex[];
  /**
   * Anni di archivio necessari. `1` = la sola annata osservata; `>1` implica il
   * recupero storico oltre la cache locale, con il costo da dire all'utente
   * PRIMA di lanciare l'analisi.
   */
  archiveYears: number;
  /** Numero minimo di scene utili sotto il quale non si decide. */
  minUsableScenes: number;
  /** Dati dichiarati indispensabili. */
  declared: readonly DeclaredRequirement[];
}

/**
 * Famiglia di appartenenza della scheda. È il livello con cui il modulo si
 * naviga: l'utente sceglie "Condizionalità" e vede le BCAA, non un elenco
 * indistinto di venti schede.
 *
 * È un campo della scheda e non un prefisso dell'id da interpretare: una
 * scheda di plugin deve DICHIARARE dove va, altrimenti finirebbe in un gruppo
 * indovinato dal nome.
 */
export type CheckGroup =
  /** A — ammissibilità di base della superficie. */
  | "eligibility"
  /** B — condizionalità (BCAA / GAEC). */
  | "conditionality"
  /** C — eco-schemi, per definizione nazionali. */
  | "ecoSchemes"
  /** D — trasversali (sfalci, date, EUDR, irrigazione). */
  | "transversal"
  /** Biologico: non satellitare, si calcola dalle operazioni. */
  | "organic";

/** I gruppi nell'ordine in cui la UI li presenta. */
export const CHECK_GROUPS: readonly CheckGroup[] = [
  "eligibility",
  "conditionality",
  "ecoSchemes",
  "transversal",
  "organic",
];

/**
 * Una scheda del catalogo. `run` è PURA: stesso ingresso, stesso esito, senza
 * rete, orologio o database.
 */
export interface CheckSpec {
  id: string;
  group: CheckGroup;
  reference: RegulatoryReference;
  subject: ComplianceMessage;
  method: ComplianceMessage;
  observability: Observability;
  requires: CheckRequirements;
  parameters: readonly CheckParameterSpec[];
  /** Finestra osservata per l'annata (funzione pura dell'annata). */
  window(campaignYear: number, parameters: Readonly<Record<string, CheckParameter>>): {
    from: string;
    to: string;
  };
  run(input: CheckInput): CheckVerdict;
}

/** Soglia sotto la quale un fattore è considerato limitante. */
export const LIMITING_SCORE = 0.6;
