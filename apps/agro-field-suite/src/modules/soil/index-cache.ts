import { boundingBox } from "@agrogea/core";
import type {
  AgroDal,
  Plot,
  VegetationIndexRaster,
  VegetationIndexScene,
} from "@agrogea/core";
import {
  SENTINEL2_COLLECTION,
  type IndicesScene,
  type RasterWindow,
  type VegetationIndex,
} from "@agrogea/tools";
import type {
  EncodedSceneIndexRaster,
  IndexCellsResult,
  SceneRasterPayload,
  SeriesPoint,
  SoilJob,
  SoilProgress,
} from "../../workers/soil.worker";
import { submitCellsJob, submitSceneJob } from "./soil-worker-client";

/**
 * Cache locale delle scene indice: traduzione fra le righe del DAL
 * (`vegetation_index_scenes` / `vegetation_index_rasters`) e i payload del
 * worker, più le due operazioni composte che tutti i consumatori condividono —
 * elaborare le scene mancanti e vettorializzare la scena da mostrare.
 *
 * Vive qui e non dentro `useSoilPipeline` perché i consumatori sono tre:
 * l'analisi su richiesta del pannello Suolo, il time slider (che calcola al
 * volo la scena su cui l'utente si sposta) e il job di aggiornamento in
 * background. Una sola implementazione significa che una scena, comunque sia
 * arrivata in cache, produce sempre le stesse celle.
 */

/**
 * Finestra di ritenzione della cache: due annate agrarie, così restano
 * possibili i confronti anno-su-anno. Le scene più vecchie vengono potate a fine
 * run (i raster seguono per FK on delete cascade).
 */
export const CACHE_RETENTION_MONTHS = 24;

/**
 * Una scena in cache è riutilizzabile solo se copre TUTTI gli indici richiesti;
 * altrimenti si rielabora per intero (l'upsert del DAL fonde le medie e
 * sostituisce i raster, quindi la cache si arricchisce invece di duplicarsi).
 * Il test è sulla PRESENZA della chiave, non sulla finitezza del value: la
 * media di una scena senza pixel validi è legittimamente NaN (→ null in JSONB)
 * e non deve condannare quella scena a essere riscaricata per sempre.
 */
export function sceneCoversIndices(
  scene: VegetationIndexScene,
  indices: VegetationIndex[],
): boolean {
  return indices.every((index) => index in (scene.index_means ?? {}));
}

/** Punto di series dalla row di cache (null JSONB → NaN, come il percorso a freddo). */
export function seriesPointFromScene(scene: VegetationIndexScene): SeriesPoint {
  const medie: Partial<Record<VegetationIndex, number>> = {};
  for (const [key, value] of Object.entries(scene.index_means ?? {})) {
    medie[key as VegetationIndex] =
      typeof value === "number" ? value : Number.NaN;
  }
  return {
    datetime: scene.captured_at,
    cloudCover: scene.cloud_cover,
    medie,
    validPixels: scene.valid_pixels,
  };
}

/** Punto di series dal payload appena calcolato dal worker. */
export function seriesPointFromPayload(payload: SceneRasterPayload): SeriesPoint {
  return {
    datetime: payload.datetime,
    cloudCover: payload.cloudCover,
    medie: payload.medie,
    validPixels: payload.validPixels,
  };
}

/** Righe di cache dei raster a partire dal payload del worker. */
export function rasterRowsFromPayload(
  payload: SceneRasterPayload,
): Omit<VegetationIndexRaster, "scene_row_id">[] {
  return payload.indices.map((entry) => ({
    index_name: entry.index,
    epsg: payload.window.epsg,
    origin_easting: payload.window.originEasting,
    origin_northing: payload.window.originNorthing,
    pixel_width: payload.window.pixelWidth,
    pixel_height: payload.window.pixelHeight,
    width: payload.window.width,
    height: payload.window.height,
    value_scale: entry.encoded.valueScale,
    nodata_value: entry.encoded.nodataValue,
    values_base64: entry.encoded.valuesBase64,
  }));
}

/** Finestra raster dalla row di cache (i campi ricalcano `RasterWindow`). */
export function rasterWindowFromRow(row: VegetationIndexRaster): RasterWindow {
  return {
    epsg: row.epsg,
    originEasting: row.origin_easting,
    originNorthing: row.origin_northing,
    pixelWidth: row.pixel_width,
    pixelHeight: row.pixel_height,
    width: row.width,
    height: row.height,
  };
}

/** Raster di cache nel formato che il worker si aspetta per vettorializzarli. */
export function encodedRastersFromRows(
  rows: VegetationIndexRaster[],
): EncodedSceneIndexRaster[] {
  return rows.map((row) => ({
    index: row.index_name as VegetationIndex,
    encoded: {
      valueScale: row.value_scale,
      nodataValue: row.nodata_value,
      valuesBase64: row.values_base64,
    },
  }));
}

/** Persiste una scena appena elaborata e ne ritorna la row (medie già fuse). */
export function persistScene(
  dal: AgroDal,
  plotId: string,
  payload: SceneRasterPayload,
): Promise<VegetationIndexScene> {
  return dal.saveVegetationIndexScene(
    {
      plot_id: plotId,
      scene_id: payload.itemId,
      collection: SENTINEL2_COLLECTION,
      captured_at: payload.datetime,
      cloud_cover: payload.cloudCover,
      valid_pixels: payload.validPixels,
      index_means: payload.medie as Record<string, number>,
    },
    rasterRowsFromPayload(payload),
  );
}

/**
 * Elabora le scene indicate e le mette in cache. Ritorna i payload indicizzati
 * per id di scena: il chiamante li usa sia per la series sia per disegnare
 * subito, senza rileggere dal DB ciò che ha appena scritto.
 */
export async function processScenes(input: {
  dal: AgroDal | null;
  plot: Plot;
  scenes: IndicesScene[];
  indices: VegetationIndex[];
  primaryIndex: VegetationIndex;
  onProgress?: (progress: SoilProgress) => void;
  onScenePersisted?: (scene: VegetationIndexScene) => void;
}): Promise<Map<string, SceneRasterPayload>> {
  const out = new Map<string, SceneRasterPayload>();
  if (input.scenes.length === 0) return out;

  const job: SoilJob = {
    type: "suolo",
    scene: input.scenes,
    indices: input.indices,
    primaryIndex: input.primaryIndex,
    geometria: input.plot.geometry,
    bbox: boundingBox(input.plot.geometry),
    plotId: input.plot.id,
  };
  const payloads = await submitSceneJob(job, input.onProgress);

  for (const payload of payloads) {
    out.set(payload.itemId, payload);
    if (!input.dal) continue;
    const saved = await persistScene(input.dal, input.plot.id, payload);
    input.onScenePersisted?.(saved);
  }
  return out;
}

/**
 * Celle vettoriali di una scena. I raster arrivano dal calcolo appena fatto
 * oppure dalla cache: da lì in poi il percorso è lo stesso (job `index-cells`
 * nel worker), quindi una scena riletta produce esattamente le celle che
 * produceva appena calcolata. Ritorna null se i raster non sono disponibili.
 */
export async function cellsForScene(input: {
  dal: AgroDal | null;
  plotId: string;
  datetime: string;
  primaryIndex: VegetationIndex;
  indices: VegetationIndex[];
  fresh: SceneRasterPayload | null;
  cachedScene: VegetationIndexScene | null;
}): Promise<IndexCellsResult | null> {
  const base = {
    type: "index-cells" as const,
    plotId: input.plotId,
    primaryIndex: input.primaryIndex,
    datetime: input.datetime,
  };

  if (input.fresh) {
    return submitCellsJob({
      ...base,
      window: input.fresh.window,
      indices: input.fresh.indices,
    });
  }

  if (!input.dal || !input.cachedScene) return null;
  const rows = await input.dal.listVegetationIndexRasters(
    input.cachedScene.id,
    input.indices,
  );
  if (rows.length === 0) return null;
  // Tutti i raster di una scena condividono la stessa griglia (nascono dallo
  // stesso `ref` del worker): la finestra si legge dalla prima riga.
  return submitCellsJob({
    ...base,
    window: rasterWindowFromRow(rows[0]),
    indices: encodedRastersFromRows(rows),
  });
}
