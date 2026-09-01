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
 */

import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";
import type {
  Plot,
  InfrastructureAsset,
  Company,
  SoilSample,
  PlotCampaign,
  Crop,
  Harvest,
  TreatmentLog,
  ScoutingObservation,
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
export const TRANSFER_SCHEMA_VERSION = "2.0.0";

/**
 * Mirror intero dentro `agrogea.version`, mantenuto per i file già in
 * circolazione: la v1 non aveva `schemaVersion`, e i lettori scritti allora
 * guardano qui. Si aggiorna insieme al major di
 * {@link TRANSFER_SCHEMA_VERSION}; non è una seconda fonte di verità.
 */
export const COMPANY_TRANSFER_VERSION = 2 as const;

/** Major supportato in lettura: oltre questo il file viene dal futuro. */
const SUPPORTED_MAJOR = 2;

/** Log agronomici associati a un perimetro (plot o company). */
export interface AgronomicLogs {
  treatments: TreatmentLog[];
  soilSamples: SoilSample[];
  harvests: Harvest[];
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
}

/** Metadati AgroGea alla radice del documento. */
export interface CompanyTransferMeta {
  format: typeof COMPANY_TRANSFER_FORMAT;
  version: number;
  exportedAt: string;
  /** Anagrafica statica dell'azienda (dati alla radice). */
  company: Company;
  /** Catalogo crops referenziate (livello tenant). */
  crops: Crop[];
  /** Log non associati ad alcun plot. */
  unassigned: AgronomicLogs;
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

/** Unione discriminata delle properties di Feature del documento. */
export type TransferFeatureProperties =
  | PlotFeatureProperties
  | AssetFeatureProperties
  | ScoutingFeatureProperties;

/** Documento GeoJSON Esteso product/consumato dal motore. */
export interface CompanyTransferDocument
  extends FeatureCollection<Geometry, TransferFeatureProperties> {
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
  const features: Feature<Geometry, TransferFeatureProperties>[] = [];

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

  return {
    type: "FeatureCollection",
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    agrogea: {
      format: COMPANY_TRANSFER_FORMAT,
      version: COMPANY_TRANSFER_VERSION,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      company: snapshot.company,
      crops: snapshot.crops,
      unassigned: snapshot.unassigned,
    },
    features,
  };
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

  const doc = raw as Record<string, unknown>;
  const features = Array.isArray(doc.features) ? doc.features : [];
  return {
    ...doc,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    agrogea: {
      ...(doc.agrogea as Record<string, unknown> | undefined),
      version: COMPANY_TRANSFER_VERSION,
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

  const features = asArray<Feature<Geometry, TransferFeatureProperties>>(
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

  return {
    company: meta.company as Company,
    crops: asArray<Crop>(meta.crops),
    plots,
    assets,
    scouting,
    unassigned: readLogs(meta.unassigned),
  };
}
