/**
 * Motore di (de)serializzazione "GeoJSON Esteso" per il trasferimento dei dati
 * di un'azienda (backup / restore / migrazione).
 *
 * Modulo PURO: nessuna dipendenza da DB, store o rete. Trasforma uno
 * snapshot in-memory dei dati aziendali in un documento GeoJSON valido e
 * viceversa. L'I/O su PGlite (lettura righe, upsert transazionale dato+outbox)
 * resta responsabilità del DAL; il salvataggio/lettura del file fisico resta
 * dell'orchestratore app-side.
 *
 * Formato: un `FeatureCollection` dove
 *   - i dati STATICI dell'azienda stanno alla radice del documento, nel membro
 *     esteso `agrogea` (RFC 7946 consente membri aggiuntivi a livello root);
 *   - ogni `Feature` porta `properties.kind` che la discrimina:
 *       · "plot"     → appezzamento (`plots_registry`) con i log del Quaderno di
 *                      Campagna (trattamenti, suolo, raccolte) annidati;
 *       · "asset"    → infrastruttura (`infrastructure_assets`: pozzi, trappole,
 *                      sensori, fabbricati…) — i POI puntuali e le geometrie CAD;
 *       · "scouting" → rilievo GPS di campo (`scouting_observations`).
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
  Appezzamento,
  AssetInfrastruttura,
  Azienda,
  CampionamentoSuolo,
  CampoCampagna,
  Crop,
  Raccolta,
  RegistroTrattamento,
  ScoutingObservation,
} from "../types";

/** Discriminante del formato (per riconoscere i file in import). */
export const COMPANY_TRANSFER_FORMAT = "agrogea.company-transfer" as const;
/** Versione dello schema del documento (bump → migrazione in parse). */
export const COMPANY_TRANSFER_VERSION = 1 as const;

/** Log agronomici associati a un perimetro (appezzamento o azienda). */
export interface AgronomicLogs {
  treatments: RegistroTrattamento[];
  soilSamples: CampionamentoSuolo[];
  harvests: Raccolta[];
}

/**
 * Un appezzamento con i suoi log e le campagne agrarie (unità di una Feature
 * "plot"). `campaigns` (`plots_campaign`) lega l'appezzamento alle COLTURE per
 * annata: senza queste righe l'associazione appezzamento↔coltura andrebbe persa.
 */
export interface PlotBundle extends AgronomicLogs {
  plot: Appezzamento;
  campaigns: CampoCampagna[];
}

/**
 * Istantanea completa dei dati di un'azienda: input dell'export, output del
 * parse. `crops` è il catalogo (a livello tenant) delle colture referenziate
 * dalle campagne dell'azienda. `unassigned` raccoglie i log non legati ad alcun
 * appezzamento (`plot_id` null), per non perderli nel backup.
 */
export interface CompanySnapshot {
  company: Azienda;
  crops: Crop[];
  plots: PlotBundle[];
  assets: AssetInfrastruttura[];
  scouting: ScoutingObservation[];
  unassigned: AgronomicLogs;
}

/** Metadati AgroGea alla radice del documento. */
export interface CompanyTransferMeta {
  format: typeof COMPANY_TRANSFER_FORMAT;
  version: number;
  exportedAt: string;
  /** Anagrafica statica dell'azienda (dati alla radice). */
  company: Azienda;
  /** Catalogo colture referenziate (livello tenant). */
  crops: Crop[];
  /** Log non associati ad alcun appezzamento. */
  unassigned: AgronomicLogs;
}

/** Properties di una Feature appezzamento: anagrafica + campagne + log annidati. */
export interface PlotFeatureProperties extends AgronomicLogs {
  kind: "plot";
  plot: Omit<Appezzamento, "geometry">;
  /** Campagne agrarie (associazione coltura↔appezzamento per annata). */
  campaigns: CampoCampagna[];
}

/** Properties di una Feature infrastruttura/POI puntuale. */
export interface AssetFeatureProperties {
  kind: "asset";
  asset: Omit<AssetInfrastruttura, "geometry">;
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

/** Documento GeoJSON Esteso prodotto/consumato dal motore. */
export interface CompanyTransferDocument
  extends FeatureCollection<Geometry, TransferFeatureProperties> {
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
    treatments: asArray<RegistroTrattamento>(source?.treatments),
    soilSamples: asArray<CampionamentoSuolo>(source?.soilSamples),
    harvests: asArray<Raccolta>(source?.harvests),
  };
}

/** Serializza uno snapshot aziendale nel documento GeoJSON Esteso. */
export function serializeCompanySnapshot(
  snapshot: CompanySnapshot,
): CompanyTransferDocument {
  const features: Feature<Geometry, TransferFeatureProperties>[] = [];

  for (const {
    plot,
    campaigns,
    treatments,
    soilSamples,
    harvests,
  } of snapshot.plots) {
    const { geometry, ...plot_no_geom } = plot;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        kind: "plot",
        plot: plot_no_geom,
        campaigns,
        treatments,
        soilSamples,
        harvests,
      },
    });
  }

  for (const asset of snapshot.assets) {
    const { geometry, ...asset_no_geom } = asset;
    features.push({
      type: "Feature",
      geometry,
      properties: { kind: "asset", asset: asset_no_geom },
    });
  }

  for (const obs of snapshot.scouting) {
    features.push({
      type: "Feature",
      // Geometria sintetizzata dalle coordinate del rilievo (lat/lng colonne).
      geometry: { type: "Point", coordinates: [obs.lng, obs.lat] },
      properties: { kind: "scouting", scouting: obs },
    });
  }

  return {
    type: "FeatureCollection",
    agrogea: {
      format: COMPANY_TRANSFER_FORMAT,
      version: COMPANY_TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      company: snapshot.company,
      crops: snapshot.crops,
      unassigned: snapshot.unassigned,
    },
    features,
  };
}

/**
 * Esegue il parsing/validazione di un documento (oggetto già `JSON.parse`-ato)
 * e ne ricostruisce lo snapshot. Solleva {@link CompanyTransferError} se il
 * formato non è riconosciuto o mancano i dati essenziali.
 */
export function parseCompanyTransfer(raw: unknown): CompanySnapshot {
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
  const assets: AssetInfrastruttura[] = [];
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
          `Feature #${i + 1} (infrastruttura) incompleta.`,
        );
      }
      assets.push({
        ...(assetProps as Omit<AssetInfrastruttura, "geometry">),
        geometry: feature.geometry,
      } as AssetInfrastruttura);
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
      ...(plotProps as Omit<Appezzamento, "geometry">),
      geometry: feature.geometry as Polygon | MultiPolygon,
    } as Appezzamento;
    plots.push({
      plot,
      campaigns: asArray<CampoCampagna>(
        (props as Partial<PlotFeatureProperties> | null)?.campaigns,
      ),
      ...readLogs((props ?? undefined) as Partial<AgronomicLogs> | undefined),
    });
  });

  return {
    company: meta.company as Azienda,
    crops: asArray<Crop>(meta.crops),
    plots,
    assets,
    scouting,
    unassigned: readLogs(meta.unassigned),
  };
}
