/**
 * Motore di (de)serializzazione "GeoJSON Esteso" per il trasferimento dei dati
 * di un'azienda (backup / restore / migrazione).
 *
 * Modulo PURO: nessuna dipendenza da DB, store o rete. Trasforma uno
 * snapshot in-memory dei dati aziendali in un documento GeoJSON valido e
 * viceversa. L'I/O su PGlite (reading rows, upsert transazionale dato+outbox)
 * resta responsabilità del DAL; il salvataggio/reading del file fisico resta
 * dell'orchestratore app-side.
 *
 * Formato: un `FeatureCollection` dove
 *   - i dati STATICI dell'azienda stanno alla radice del documento, nel membro
 *     esteso `agrogea` (RFC 7946 consente membri aggiuntivi a livello root);
 *   - ogni `Feature` porta `properties.kind` che la discrimina:
 *       · "plot"     → plot (`plots_registry`) con i log del Quaderno di
 *                      Campagna (treatments, soil, harvests) annidati;
 *       · "asset"    → infrastructure (`infrastructure_assets`: pozzi, trappole,
 *                      sensori, fabbricati…) — i POI puntuali e le geometrie CAD;
 *       · "scouting" → rilievo GPS di field (`scouting_observations`).
 *   La geometria di ogni Feature è già GeoJSON in PGlite (niente PostGIS): viene
 *   letta e riscritta così com'è.
 *
 * Conformità RFC 7946 (il GeoJSON che QGIS e i portali INSPIRE si aspettano):
 * coordinate in CRS84 (lon, lat in gradi WGS 84 — l'unico CRS ammesso
 * dall'RFC, ed è già quello in cui PGlite tiene le geometrie), `bbox` di primo
 * livello, membri foreign (`agrogea`, `schemaVersion`) consentiti alla radice,
 * `geometry: null` ammesso per una Feature priva di posizione. Ciò che NON è
 * geografico (products, lots, machines, ricette…) NON diventa una Feature
 * senza geometria: sta nei membri foreign della radice, dove un lettore GIS lo
 * ignora senza inciamparci.
 */

import type {
  BBox,
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import type {
  ActivityMachine,
  ActivityProduct,
  Company,
  CounterAdjustment,
  Crop,
  Equipment,
  FieldOperationSession,
  FuelRefill,
  Harvest,
  InfrastructureAsset,
  Machine,
  MachineDocument,
  MaintenanceLog,
  MaintenanceSchedule,
  PlannedTask,
  Plot,
  PlotCampaign,
  Product,
  ProductLot,
  Recipe,
  ScoutingObservation,
  SoilSample,
  TreatmentLog,
  Warehouse,
} from "../types";

/** Discriminante del formato (per riconoscere i file in import). */
export const COMPANY_TRANSFER_FORMAT = "agrogea.company-transfer" as const;

/**
 * Versione dello schema, semver, come membro di primo livello del documento.
 * È la versione AUTOREVOLE.
 *
 * Semantica: MAJOR = un lettore esistente non può più leggere il file; MINOR =
 * campi additivi che un lettore vecchio può ignorare; PATCH = nulla che cambi
 * la lettura.
 */
export const TRANSFER_SCHEMA_VERSION = "3.0.0";

/**
 * Mirror intero dentro `agrogea.version`, mantenuto per i file già in
 * circolazione: la v1 non aveva `schemaVersion`, e i lettori scritti allora
 * guardano qui. Si aggiorna insieme al major di
 * {@link TRANSFER_SCHEMA_VERSION}; non è una seconda fonte di verità.
 */
export const COMPANY_TRANSFER_VERSION = 3 as const;

/** Major supportato in lettura: oltre questo il file viene dal futuro. */
const SUPPORTED_MAJOR = 3;

/** Log agronomici associati a un perimetro (plot o company). */
export interface AgronomicLogs {
  treatments: TreatmentLog[];
  soilSamples: SoilSample[];
  harvests: Harvest[];
}

/**
 * Blocco di dati selezionabile in fase di backup. Sono VALORI persistiti nel
 * documento (`agrogea.scope.sections`): chi rilegge il file deve poter
 * distinguere "magazzino vuoto" da "magazzino non incluso nel backup".
 *
 * L'anagrafica dell'azienda non è una sezione: è l'intestazione del documento
 * e c'è sempre, altrimenti il file non identificherebbe più nulla.
 */
export type TransferSection =
  | "plots"
  | "treatments"
  | "harvests"
  | "soilSamples"
  | "scouting"
  | "assets"
  | "warehouse"
  | "machinery"
  | "planning";

/** Tutte le sezioni, nell'ordine in cui la UI le presenta. */
export const TRANSFER_SECTIONS: readonly TransferSection[] = [
  "plots",
  "treatments",
  "harvests",
  "soilSamples",
  "scouting",
  "assets",
  "warehouse",
  "machinery",
  "planning",
];

/** Sezioni che un file v2 poteva contenere (usata dalla migrazione v2 → v3). */
const V2_SECTIONS: readonly TransferSection[] = [
  "plots",
  "treatments",
  "harvests",
  "soilSamples",
  "scouting",
  "assets",
];

/**
 * Finestra temporale del backup, estremi INCLUSI, in date ISO `YYYY-MM-DD`.
 * `null` su un estremo = aperto da quel lato.
 */
export interface TransferPeriod {
  from: string | null;
  to: string | null;
}

/**
 * Perimetro dichiarato del documento: cosa contiene e a quale periodo si
 * riferisce. Va nel file perché un backup parziale, riletto tra un anno, deve
 * poter dire di esserlo — senza, un ripristino sembrerebbe una perdita di dati.
 */
export interface TransferScope {
  sections: TransferSection[];
  /** `null` = tutto lo storico (nessun filtro temporale). */
  period: TransferPeriod | null;
}

/** Perimetro completo: tutte le sezioni, nessun limite temporale. */
export function fullTransferScope(): TransferScope {
  return { sections: [...TRANSFER_SECTIONS], period: null };
}

/**
 * Vero se un record datato `iso` rientra nel periodo (estremi inclusi, a
 * granularità di giorno: il confronto è fra le prime 10 cifre ISO, quindi
 * `to` comprende l'intera giornata).
 *
 * Un record SENZA data passa sempre: escluderlo significherebbe perdere in
 * silenzio, per esempio, una task pianificata senza data o un documento senza
 * emissione — e un backup non è il posto dove buttare via ciò che non si sa
 * collocare nel tempo.
 */
export function withinPeriod(
  iso: string | null | undefined,
  period: TransferPeriod | null,
): boolean {
  if (!period || (!period.from && !period.to)) return true;
  if (!iso) return true;
  const day = iso.slice(0, 10);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

/**
 * Magazzino: anagrafiche (depositi e products), giacenze per lot e movimenti
 * di scarico verso le attività del Quaderno (`activity_products`, i CUMP
 * congelati). I depositi georeferenziati diventano Feature; il resto no.
 */
export interface WarehouseBundle {
  warehouses: Warehouse[];
  products: Product[];
  lots: ProductLot[];
  /** Scarichi lot → attività: la riga di costo del Quaderno. */
  movements: ActivityProduct[];
}

/** Parco macchine: anagrafiche, impieghi, manutenzione, documenti, carburante. */
export interface MachineryBundle {
  machines: Machine[];
  equipment: Equipment[];
  activityMachines: ActivityMachine[];
  maintenanceSchedules: MaintenanceSchedule[];
  maintenanceLogs: MaintenanceLog[];
  documents: MachineDocument[];
  counterAdjustments: CounterAdjustment[];
  fuelRefills: FuelRefill[];
}

/**
 * Pianificazione e Modalità Campo: ricette, task programmate e sessioni
 * eseguite. Le sessioni portano il tracciato GPS e diventano Feature
 * LineString; ricette e task no.
 */
export interface PlanningBundle {
  recipes: Recipe[];
  plannedTasks: PlannedTask[];
  sessions: FieldOperationSession[];
}

export function emptyWarehouseBundle(): WarehouseBundle {
  return { warehouses: [], products: [], lots: [], movements: [] };
}

export function emptyMachineryBundle(): MachineryBundle {
  return {
    machines: [],
    equipment: [],
    activityMachines: [],
    maintenanceSchedules: [],
    maintenanceLogs: [],
    documents: [],
    counterAdjustments: [],
    fuelRefills: [],
  };
}

export function emptyPlanningBundle(): PlanningBundle {
  return { recipes: [], plannedTasks: [], sessions: [] };
}

/**
 * Un plot con i suoi log e le campagne agrarie (unità di una Feature
 * "plot"). `campaigns` (`plots_campaign`) lega l'appezzamento alle COLTURE per
 * annata: senza queste rows l'associazione plot↔crop andrebbe persa.
 */
export interface PlotBundle extends AgronomicLogs {
  plot: Plot;
  campaigns: PlotCampaign[];
}

/**
 * Istantanea completa dei dati di un'azienda: input dell'export, output del
 * parse. `crops` è il catalog (a livello tenant) delle crops referenziate
 * dalle campagne dell'azienda. `unassigned` raccoglie i log non legati ad alcun
 * plot (`plot_id` null), per non perderli nel backup.
 */
export interface CompanySnapshot {
  company: Company;
  crops: Crop[];
  plots: PlotBundle[];
  assets: InfrastructureAsset[];
  scouting: ScoutingObservation[];
  unassigned: AgronomicLogs;
  warehouse: WarehouseBundle;
  machinery: MachineryBundle;
  planning: PlanningBundle;
  /** Cosa contiene questo snapshot: sezioni scelte e periodo di riferimento. */
  scope: TransferScope;
}

/** Snapshot vuoto di un'azienda: base su cui l'export riempie le sezioni scelte. */
export function emptyCompanySnapshot(company: Company): CompanySnapshot {
  return {
    company,
    crops: [],
    plots: [],
    assets: [],
    scouting: [],
    unassigned: { treatments: [], soilSamples: [], harvests: [] },
    warehouse: emptyWarehouseBundle(),
    machinery: emptyMachineryBundle(),
    planning: emptyPlanningBundle(),
    scope: fullTransferScope(),
  };
}

/** Metadati AgroGea alla radice del documento. */
export interface CompanyTransferMeta {
  format: typeof COMPANY_TRANSFER_FORMAT;
  version: number;
  exportedAt: string;
  /** Perimetro del backup: sezioni incluse e periodo di riferimento. */
  scope: TransferScope;
  /** Anagrafica statica dell'azienda (dati alla radice). */
  company: Company;
  /** Catalogo crops referenziate (livello tenant). */
  crops: Crop[];
  /** Log non associati ad alcun plot. */
  unassigned: AgronomicLogs;
  /** Magazzino, meno i depositi georeferenziati (che sono Feature). */
  warehouse: WarehouseBundle;
  /** Parco macchine (nessuna entità geografica). */
  machinery: MachineryBundle;
  /** Pianificazione, meno le sessioni con tracciato (che sono Feature). */
  planning: PlanningBundle;
}

/** Properties di una Feature plot: anagrafica + campagne + log annidati. */
export interface PlotFeatureProperties extends AgronomicLogs {
  kind: "plot";
  plot: Omit<Plot, "geometry">;
  /** Campagne agrarie (associazione crop↔plot per annata). */
  campaigns: PlotCampaign[];
}

/** Properties di una Feature infrastructure/POI puntuale. */
export interface AssetFeatureProperties {
  kind: "asset";
  asset: Omit<InfrastructureAsset, "geometry">;
}

/** Properties di una Feature rilievo scouting. */
export interface ScoutingFeatureProperties {
  kind: "scouting";
  scouting: ScoutingObservation;
}

/**
 * Properties di una Feature magazzino. La geometria è il Point del deposito,
 * `null` per i magazzini logici (senza collocazione sulla mappa): RFC 7946
 * ammette `geometry: null`, e un deposito senza coordinate resta un dato da
 * salvare.
 */
export interface WarehouseFeatureProperties {
  kind: "warehouse";
  warehouse: Omit<Warehouse, "geometry">;
}

/**
 * Properties di una Feature sessione di campo. La geometria è il tracciato GPS
 * (`path`), `null` quando la sessione non ha registrato almeno due punti — una
 * LineString con meno di due posizioni non sarebbe GeoJSON valido.
 */
export interface SessionFeatureProperties {
  kind: "session";
  session: Omit<FieldOperationSession, "path">;
}

/** Unione discriminata delle properties di Feature del documento. */
export type TransferFeatureProperties =
  | PlotFeatureProperties
  | AssetFeatureProperties
  | ScoutingFeatureProperties
  | WarehouseFeatureProperties
  | SessionFeatureProperties;

/** Documento GeoJSON Esteso product/consumato dal motore. */
export interface CompanyTransferDocument
  extends FeatureCollection<Geometry | null, TransferFeatureProperties> {
  /**
   * Versione semver dello schema, membro foreign del top level (RFC 7946
   * consente membri aggiuntivi alla radice). Sta QUI e non dentro `agrogea`
   * perché è una proprietà del FILE, non del suo contenuto AgroGea: chi legge
   * deve poter decidere se sa leggerlo prima di interpretarne una sola riga.
   */
  schemaVersion: string;
  agrogea: CompanyTransferMeta;
}

/** Errore di formato/validazione del documento di trasferimento. */
export class CompanyTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyTransferError";
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readLogs(source: Partial<AgronomicLogs> | undefined): AgronomicLogs {
  return {
    treatments: asArray<TreatmentLog>(source?.treatments),
    soilSamples: asArray<SoilSample>(source?.soilSamples),
    harvests: asArray<Harvest>(source?.harvests),
  };
}

/** Esito della pianificazione di un import, prima di scrivere qualsiasi cosa. */
export interface PlotImportPlan {
  /** Appezzamenti nuovi: nessun corrispondente nel portafoglio. */
  toCreate: PlotBundle[];
  /**
   * Stesso `id`: è il MEDESIMO record, tipicamente il ripristino dello stesso
   * backup. Riscriverlo è idempotente e non perde nulla, quindi non è un
   * conflitto.
   */
  toUpdate: PlotBundle[];
  /**
   * Stessa particella pubblica (`source_id` + `nuts_code`) ma record diverso.
   * QUESTO è un conflitto: sovrascrivere significherebbe buttare via il
   * quaderno di campagna di un appezzamento che l'utente ha già lavorato.
   * Si presenta e si chiede; non si decide qui.
   */
  conflicts: { incoming: PlotBundle; existing: Plot }[];
}

/** Chiave della particella pubblica, o `null` se l'appezzamento non ne ha. */
function parcelKey(plot: Pick<Plot, "source_id" | "nuts_code">): string | null {
  return plot.source_id != null && plot.nuts_code != null
    ? `${plot.source_id} ${plot.nuts_code}`
    : null;
}

/**
 * Classifica gli appezzamenti in arrivo rispetto a quelli già presenti, SENZA
 * scrivere niente: l'import deve essere idempotente e non distruttivo, e chi
 * chiama deve poter chiedere all'utente prima di toccare dati esistenti.
 *
 * Due criteri, in quest'ordine: stesso `id` (stesso record) e stessa particella
 * pubblica (record diverso che descrive lo stesso pezzo di terra). Gli
 * appezzamenti disegnati a mano non hanno provenienza e quindi non entrano mai
 * in conflitto fra loro — due disegni sullo stesso campo restano due
 * appezzamenti, e nessuno può dire che fossero lo stesso.
 */
export function planPlotImport(
  incoming: readonly PlotBundle[],
  existing: readonly Plot[],
): PlotImportPlan {
  const byId = new Map(existing.map((plot) => [plot.id, plot]));
  const byParcel = new Map<string, Plot>();
  for (const plot of existing) {
    const key = parcelKey(plot);
    if (key && plot.deleted_at == null) byParcel.set(key, plot);
  }

  const plan: PlotImportPlan = { toCreate: [], toUpdate: [], conflicts: [] };
  for (const bundle of incoming) {
    if (byId.has(bundle.plot.id)) {
      plan.toUpdate.push(bundle);
      continue;
    }
    const key = parcelKey(bundle.plot);
    const clash = key ? byParcel.get(key) : undefined;
    if (clash) plan.conflicts.push({ incoming: bundle, existing: clash });
    else plan.toCreate.push(bundle);
  }
  return plan;
}

/**
 * Serializza uno snapshot aziendale nel documento GeoJSON Esteso.
 *
 * `exportedAt` è iniettabile: senza, due export dello stesso snapshot
 * differirebbero per l'istante e il round-trip non sarebbe verificabile. In
 * esercizio non si passa e vale l'ora corrente.
 */
export function serializeCompanySnapshot(
  snapshot: CompanySnapshot,
  options: { exportedAt?: string } = {},
): CompanyTransferDocument {
  const features: Feature<Geometry | null, TransferFeatureProperties>[] = [];

  for (const {
    plot,
    campaigns,
    treatments,
    soilSamples,
    harvests,
  } of snapshot.plots) {
    const { geometry, ...plotNoGeom } = plot;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        kind: "plot",
        plot: plotNoGeom,
        campaigns,
        treatments,
        soilSamples,
        harvests,
      },
    });
  }

  for (const asset of snapshot.assets) {
    const { geometry, ...assetNoGeom } = asset;
    features.push({
      type: "Feature",
      geometry,
      properties: { kind: "asset", asset: assetNoGeom },
    });
  }

  for (const obs of snapshot.scouting) {
    features.push({
      type: "Feature",
      // Geometria sintetizzata dalle coordinate del rilievo (lat/lng columns).
      geometry: { type: "Point", coordinates: [obs.lng, obs.lat] },
      properties: { kind: "scouting", scouting: obs },
    });
  }

  for (const warehouse of snapshot.warehouse.warehouses) {
    const { geometry, ...warehouseNoGeom } = warehouse;
    features.push({
      type: "Feature",
      geometry: geometry ?? null,
      properties: { kind: "warehouse", warehouse: warehouseNoGeom },
    });
  }

  for (const session of snapshot.planning.sessions) {
    const { path, ...sessionNoPath } = session;
    features.push({
      type: "Feature",
      // Meno di due posizioni non è una LineString valida (RFC 7946 §3.1.4):
      // la sessione resta, il tracciato inesistente diventa `null`.
      geometry: (path?.coordinates?.length ?? 0) >= 2 ? path : null,
      properties: { kind: "session", session: sessionNoPath },
    });
  }

  const bbox = featuresBBox(features);
  return {
    type: "FeatureCollection",
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    ...(bbox ? { bbox } : {}),
    agrogea: {
      format: COMPANY_TRANSFER_FORMAT,
      version: COMPANY_TRANSFER_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      scope: snapshot.scope,
      company: snapshot.company,
      crops: snapshot.crops,
      unassigned: snapshot.unassigned,
      // I depositi georeferenziati sono già fra le Feature: nel membro root
      // resta il magazzino non geografico (products, lots, movimenti).
      warehouse: { ...snapshot.warehouse, warehouses: [] },
      machinery: snapshot.machinery,
      // Idem per le sessioni, che portano il tracciato.
      planning: { ...snapshot.planning, sessions: [] },
    },
    features,
  };
}

/** Percorre le posizioni di una geometria, ricorsivamente sulle collection. */
function eachPosition(
  geometry: Geometry | null,
  visit: (position: Position) => void,
): void {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) eachPosition(g, visit);
    return;
  }
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number") {
      visit(node as Position);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geometry.coordinates);
}

/**
 * `bbox` 2D [west, south, east, north] dell'intero documento (RFC 7946 §5):
 * è ciò che permette a un lettore GIS di inquadrare il file senza aprirlo
 * tutto. `null` se non c'è alcuna geometria da inquadrare.
 */
function featuresBBox(
  features: readonly Feature<Geometry | null, unknown>[],
): BBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of features) {
    eachPosition(feature.geometry, ([lon, lat]) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    });
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/**
 * Versione dichiarata da un documento. I file della v1 non avevano
 * `schemaVersion`: si riconoscono dall'intero in `agrogea.version`, e se manca
 * pure quello si assume la v1 — è l'unica cosa che potevano essere.
 */
export function documentSchemaVersion(raw: unknown): string {
  const doc = raw as { schemaVersion?: unknown; agrogea?: { version?: unknown } };
  if (typeof doc?.schemaVersion === "string" && doc.schemaVersion.trim() !== "") {
    return doc.schemaVersion;
  }
  const legacy = doc?.agrogea?.version;
  return typeof legacy === "number" ? `${legacy}.0.0` : "1.0.0";
}

/** Numero di major da una stringa semver; `0` se illeggibile. */
function majorOf(version: string): number {
  const parsed = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Porta un documento alla versione corrente dello schema.
 *
 * Esiste dalla v1 perché un backup che finisce in mano a un utente reale non si
 * può più cambiare: senza un migratore, ogni evoluzione del formato
 * significherebbe abbandonare i file già esportati. Migra in avanti, mai
 * indietro — un documento più recente di quanto sappiamo leggere viene
 * RIFIUTATO invece di essere interpretato a metà.
 *
 * **v1 → v2:** aggiunge `schemaVersion` alla radice e completa gli
 * appezzamenti con i campi di provenienza introdotti dallo schema locale v22
 * (`source_id`, `nuts_code`, `reference_unit_type`, `validity_year`). Nei file
 * v1 non esistevano: valgono `null`, cioè "appezzamento senza provenienza
 * pubblica", che è esattamente ciò che erano.
 *
 * **v2 → v3:** aggiunge il perimetro dichiarato (`agrogea.scope`) e le sezioni
 * Magazzino / Parco macchine / Pianificazione. Le sezioni nuove restano VUOTE
 * e fuori dallo `scope`: un file v2 non le conteneva, e dichiararle vuote
 * invece che assenti farebbe credere a un ripristino che il magazzino
 * dell'azienda fosse stato svuotato.
 */
export function migrateTransferDocument(raw: unknown): unknown {
  // Ciò che non è un oggetto passa intatto: gli errori di forma (file vuoto,
  // JSON che non è un FeatureCollection) li segnala il parse con i suoi
  // messaggi, non la migrazione con un TypeError.
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const version = documentSchemaVersion(raw);
  const major = majorOf(version);

  if (major > SUPPORTED_MAJOR) {
    throw new CompanyTransferError(
      `Il file usa la versione ${version} del formato, più recente di quella supportata ` +
        `(${TRANSFER_SCHEMA_VERSION}). Aggiorna AgroGea per aprirlo.`,
    );
  }
  if (major === SUPPORTED_MAJOR) return raw;

  let doc = raw as Record<string, unknown>;
  if (majorOf(documentSchemaVersion(doc)) < 2) doc = migrateV1ToV2(doc);
  if (majorOf(documentSchemaVersion(doc)) < 3) doc = migrateV2ToV3(doc);
  return doc;
}

function migrateV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  const features = Array.isArray(doc.features) ? doc.features : [];
  return {
    ...doc,
    schemaVersion: "2.0.0",
    agrogea: {
      ...(doc.agrogea as Record<string, unknown> | undefined),
      version: 2,
    },
    features: features.map((feature) => {
      const f = feature as { properties?: Record<string, unknown> | null };
      const plot = f.properties?.plot as Record<string, unknown> | undefined;
      if (!plot) return feature;
      return {
        ...f,
        properties: {
          ...f.properties,
          plot: {
            source_id: null,
            nuts_code: null,
            reference_unit_type: null,
            validity_year: null,
            // Ciò che il file già portava vince sui valori di riempimento.
            ...plot,
          },
        },
      };
    }),
  };
}

function migrateV2ToV3(doc: Record<string, unknown>): Record<string, unknown> {
  const meta = (doc.agrogea ?? {}) as Record<string, unknown>;
  return {
    ...doc,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    agrogea: {
      ...meta,
      version: COMPANY_TRANSFER_VERSION,
      scope: { sections: [...V2_SECTIONS], period: null } satisfies TransferScope,
      warehouse: emptyWarehouseBundle(),
      machinery: emptyMachineryBundle(),
      planning: emptyPlanningBundle(),
    },
  };
}

/**
 * Esegue il parsing/validazione di un documento (oggetto già `JSON.parse`-ato)
 * e ne ricostruisce lo snapshot, migrandolo prima se viene da una versione
 * precedente. Solleva {@link CompanyTransferError} se il formato non è
 * riconosciuto, se viene da una versione futura, o se mancano i dati
 * essenziali.
 */
export function parseCompanyTransfer(input: unknown): CompanySnapshot {
  const raw = migrateTransferDocument(input);
  if (!raw || typeof raw !== "object") {
    throw new CompanyTransferError("File vuoto o non in formato JSON.");
  }
  const doc = raw as Partial<CompanyTransferDocument>;
  if (doc.type !== "FeatureCollection") {
    throw new CompanyTransferError(
      "Il file non è un FeatureCollection GeoJSON valido.",
    );
  }
  const meta = doc.agrogea;
  if (!meta || meta.format !== COMPANY_TRANSFER_FORMAT) {
    throw new CompanyTransferError(
      "Formato non riconosciuto: atteso un export AgroGea (agrogea.company-transfer).",
    );
  }
  if (!meta.company || typeof meta.company !== "object") {
    throw new CompanyTransferError(
      "Dati dell'azienda mancanti alla radice del documento.",
    );
  }

  const plots: PlotBundle[] = [];
  const assets: InfrastructureAsset[] = [];
  const scouting: ScoutingObservation[] = [];
  const warehouses: Warehouse[] = [];
  const sessions: FieldOperationSession[] = [];

  const features = asArray<Feature<Geometry | null, TransferFeatureProperties>>(
    doc.features,
  );
  features.forEach((feature, i) => {
    const props = feature.properties as Partial<TransferFeatureProperties> | null;
    // Retro-compatibilità: una Feature senza `kind` ma con `plot` è un plot.
    const kind =
      props?.kind ??
      (props && "plot" in props ? ("plot" as const) : undefined);

    if (kind === "asset") {
      const assetProps = (props as AssetFeatureProperties).asset;
      if (!assetProps || !feature.geometry) {
        throw new CompanyTransferError(
          `Feature #${i + 1} (infrastructure) incompleta.`,
        );
      }
      assets.push({
        ...(assetProps as Omit<InfrastructureAsset, "geometry">),
        geometry: feature.geometry,
      } as InfrastructureAsset);
      return;
    }

    if (kind === "scouting") {
      const obs = (props as ScoutingFeatureProperties).scouting;
      if (!obs) {
        throw new CompanyTransferError(
          `Feature #${i + 1} (scouting) priva dei dati del rilievo.`,
        );
      }
      scouting.push(obs as ScoutingObservation);
      return;
    }

    if (kind === "warehouse") {
      const warehouseProps = (props as WarehouseFeatureProperties).warehouse;
      if (!warehouseProps) {
        throw new CompanyTransferError(
          `Feature #${i + 1} (magazzino) priva dei dati del deposito.`,
        );
      }
      warehouses.push({
        ...(warehouseProps as Omit<Warehouse, "geometry">),
        // Il magazzino logico non ha collocazione: `geometry: null` è un dato,
        // non un errore.
        geometry: (feature.geometry as Point | null) ?? null,
      });
      return;
    }

    if (kind === "session") {
      const sessionProps = (props as SessionFeatureProperties).session;
      if (!sessionProps) {
        throw new CompanyTransferError(
          `Feature #${i + 1} (sessione di campo) priva dei dati della sessione.`,
        );
      }
      sessions.push({
        ...(sessionProps as Omit<FieldOperationSession, "path">),
        path:
          (feature.geometry as LineString | null) ??
          ({ type: "LineString", coordinates: [] } as LineString),
      });
      return;
    }

    // default → plot
    const plotProps = (props as PlotFeatureProperties | null)?.plot;
    if (!plotProps || typeof plotProps !== "object") {
      throw new CompanyTransferError(
        `Feature #${i + 1} priva dei dati dell'appezzamento.`,
      );
    }
    if (!feature.geometry) {
      throw new CompanyTransferError(`Feature #${i + 1} priva di geometria.`);
    }
    const plot = {
      ...(plotProps as Omit<Plot, "geometry">),
      geometry: feature.geometry as Polygon | MultiPolygon,
    } as Plot;
    plots.push({
      plot,
      campaigns: asArray<PlotCampaign>(
        (props as Partial<PlotFeatureProperties> | null)?.campaigns,
      ),
      ...readLogs((props ?? undefined) as Partial<AgronomicLogs> | undefined),
    });
  });

  const warehouse = meta.warehouse as Partial<WarehouseBundle> | undefined;
  const machinery = meta.machinery as Partial<MachineryBundle> | undefined;
  const planning = meta.planning as Partial<PlanningBundle> | undefined;

  return {
    company: meta.company as Company,
    crops: asArray<Crop>(meta.crops),
    plots,
    assets,
    scouting,
    unassigned: readLogs(meta.unassigned),
    warehouse: {
      // I depositi viaggiano come Feature: qui si rimettono nel bundle.
      warehouses,
      products: asArray<Product>(warehouse?.products),
      lots: asArray<ProductLot>(warehouse?.lots),
      movements: asArray<ActivityProduct>(warehouse?.movements),
    },
    machinery: {
      machines: asArray<Machine>(machinery?.machines),
      equipment: asArray<Equipment>(machinery?.equipment),
      activityMachines: asArray<ActivityMachine>(machinery?.activityMachines),
      maintenanceSchedules: asArray<MaintenanceSchedule>(
        machinery?.maintenanceSchedules,
      ),
      maintenanceLogs: asArray<MaintenanceLog>(machinery?.maintenanceLogs),
      documents: asArray<MachineDocument>(machinery?.documents),
      counterAdjustments: asArray<CounterAdjustment>(
        machinery?.counterAdjustments,
      ),
      fuelRefills: asArray<FuelRefill>(machinery?.fuelRefills),
    },
    planning: {
      recipes: asArray<Recipe>(planning?.recipes),
      plannedTasks: asArray<PlannedTask>(planning?.plannedTasks),
      sessions,
    },
    scope: readScope(meta.scope),
  };
}

/**
 * Perimetro dichiarato dal documento. Un file senza `scope` leggibile viene
 * trattato come backup completo: è ciò che erano tutti i file prodotti prima
 * che il perimetro fosse selezionabile.
 */
function readScope(raw: unknown): TransferScope {
  const scope = raw as Partial<TransferScope> | undefined;
  const sections = asArray<unknown>(scope?.sections).filter(
    (s): s is TransferSection =>
      typeof s === "string" &&
      (TRANSFER_SECTIONS as readonly string[]).includes(s),
  );
  if (sections.length === 0) return fullTransferScope();
  const period = scope?.period;
  return {
    sections,
    period:
      period && typeof period === "object"
        ? {
            from: typeof period.from === "string" ? period.from : null,
            to: typeof period.to === "string" ? period.to : null,
          }
        : null,
  };
}
