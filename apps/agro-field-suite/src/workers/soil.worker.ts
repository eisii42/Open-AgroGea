/// <reference lib="webworker" />
import {
  applySasToken,
  computeIndex,
  clipRasterToPolygon,
  rasterToIndexCells,
  type IndexLayerRaster,
  type IndexCellProperties,
  type VegetationIndex,
  lonLatToUtm,
  type RasterWindow,
  type IndicesScene,
  SENTINEL2_COLLECTION,
  indexStatistics,
  type SasToken,
  planetaryComputerToken,
} from "@agrogea/tools";
import { fromUrl, type GeoTIFFImage } from "geotiff";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { rasterToGridCells } from "../modules/vra/raster-cells";

/**
 * Web Worker del module Suolo (refactor pipeline indici STAC + rendering
 * vettoriale). Fa il lavoro pesante fuori dal main thread: per ogni scena
 * della series temporale download SOLO le bande necessarie (finestra COG via
 * HTTP-Range), le riallinea su una griglia comune, compute gli indici scelti,
 * ritaglia sul poligono e ne fa la media. Per la scena più recente produce
 * anche le celle vettoriali (una per pixel, 10×10 m) dell'index primario —
 * con i value di TUTTI gli indici calcolati come properties, per il tooltip
 * hover — pronte per un layer `geojson` con color scale relativa alla run.
 *
 * Le bande Sentinel-2 hanno risoluzioni diverse (B05 a 20 m, B03/B04/B08 a
 * 10 m): tutte vengono ricampionate (nearest neighbor) sulla griglia di
 * riferimento — la banda letta a risoluzione più fine — così l'algebra fra
 * bande lavora su array allineati.
 */

export interface SoilJob {
  type: "suolo";
  /** Serie di scene, dalla più recente alla più vecchia (vedi searchSceneSeries). */
  scene: IndicesScene[];
  indices: VegetationIndex[];
  /** Indice renderizzato come celle vettoriali (sulla scena più recente). */
  primaryIndex: VegetationIndex;
  geometria: Polygon | MultiPolygon;
  bbox: [number, number, number, number];
  /** Id del plot in lavorazione: stampato sulle celle indice (proprietà `plotId`, per il tooltip hover). */
  plotId: string;
  /** Fattore L per SAVI (default lato libreria). */
  L?: number;
  /**
   * Quando presente, il worker vettorizza il raster dell'index primario
   * (scena più recente) in celle quadrate di `step` pixel per la zonazione
   * VRA, SALTANDO la costruzione delle celle indice (non servono al
   * generatore VRA e costerebbero lavoro inutile). Assente per la sola
   * analisi indici.
   */
  vra?: { step: number };
}

/** Cella della griglia VRA: poligono con value medio dell'index primario. */
export type VraCells = FeatureCollection<Polygon, { value: number }>;

export interface SeriesPoint {
  datetime: string;
  cloudCover: number | null;
  /** Media per index (chiave = index), NaN se nessun pixel valido. */
  medie: Partial<Record<VegetationIndex, number>>;
  validPixels: number;
}

/**
 * Celle vettoriali (10×10 m, una per pixel) dell'index primario sulla scena
 * più recente, con i value di tutti gli indici calcolati come properties
 * (tooltip hover multi-indice). `cellSizeM` = passo pixel della scena (10 per
 * Sentinel-2), utile alla UI per la didascalia della dimensione cella.
 */
export interface IndexCellsResult {
  index: VegetationIndex;
  datetime: string;
  cellSizeM: number;
  cells: FeatureCollection<Polygon, IndexCellProperties>;
}

export type SoilProgress =
  | {
      type: "progress";
      phase: "download" | "calcolo";
      scenaCorrente: number;
      sceneTotali: number;
    }
  | {
      type: "done";
      series: SeriesPoint[];
      /** Celle vettoriali dell'index primario, assenti quando `job.vra` è impostato. */
      cells: IndexCellsResult | null;
      /** Celle VRA dell'index primario, solo se `job.vra` è impostato. */
      vraCells: VraCells | null;
    }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Token SAS della collezione Sentinel-2, cachato per la vita del worker. Un solo
 * token firma tutti gli asset di tutte le scene → niente burst di richieste di
 * firma (causa dei 429). `tokenInFlight` deduplica le richieste concorrenti
 * (le bande di una scena sono lette in parallelo).
 */
let tokenCache: SasToken | null = null;
let tokenInFlight: Promise<string> | null = null;

async function tokenSentinel(): Promise<string> {
  if (tokenCache && tokenCache.expiryMs > Date.now() + 60_000) {
    return tokenCache.token;
  }
  tokenInFlight ??= planetaryComputerToken(SENTINEL2_COLLECTION)
    .then((t) => {
      tokenCache = t;
      tokenInFlight = null;
      return t.token;
    })
    .catch((error) => {
      tokenInFlight = null;
      throw error;
    });
  return tokenInFlight;
}

/** EPSG della scena da ProjectedCSTypeGeoKey (Sentinel-2 L2A è in UTM). */
function epsgFromImage(image: GeoTIFFImage): number {
  const keys = image.getGeoKeys?.() as
    | { ProjectedCSTypeGeoKey?: number }
    | null;
  const epsg = keys?.ProjectedCSTypeGeoKey;
  if (!epsg) {
    throw new Error(
      "CRS della scena non determinabile (ProjectedCSTypeGeoKey assente).",
    );
  }
  return epsg;
}

interface BandaLetta {
  values: Float32Array;
  window: RasterWindow;
}

/**
 * Legge dal COG la finestra di pixel che copre il bbox del poligono (riflettanza
 * 0..1) con la georeferenziazione UTM. geotiff fa richieste Range solo sulle
 * tile coperte, evitando di scaricare l'intera scena.
 */
async function readBand(
  href: string,
  bboxLonLat: [number, number, number, number],
): Promise<BandaLetta> {
  // Gli asset Planetary Computer vanno firmati (SAS token), altrimenti il blob
  // Azure risponde 409 PublicAccessNotPermitted. Si usa il token di collezione
  // cachato (una richiesta sola), evitando i 429 da firma per-href.
  const signed = applySasToken(href, await tokenSentinel());
  const tiff = await fromUrl(signed);
  const image = await tiff.getImage();
  const epsg = epsgFromImage(image);

  const [originX, originY] = image.getOrigin();
  const [resX, resYsigned] = image.getResolution();
  const resY = Math.abs(resYsigned);
  const imgBbox = image.getBoundingBox();

  const [minLon, minLat, maxLon, maxLat] = bboxLonLat;
  const corners = [
    lonLatToUtm(minLon, minLat, epsg),
    lonLatToUtm(maxLon, minLat, epsg),
    lonLatToUtm(maxLon, maxLat, epsg),
    lonLatToUtm(minLon, maxLat, epsg),
  ];
  const minE = Math.max(imgBbox[0], Math.min(...corners.map((c) => c.easting)));
  const maxE = Math.min(imgBbox[2], Math.max(...corners.map((c) => c.easting)));
  const minN = Math.max(imgBbox[1], Math.min(...corners.map((c) => c.northing)));
  const maxN = Math.min(imgBbox[3], Math.max(...corners.map((c) => c.northing)));
  if (minE >= maxE || minN >= maxN) {
    throw new Error("Il poligono non interseca la scena satellitare.");
  }

  const px0 = Math.max(0, Math.floor((minE - originX) / resX));
  const px1 = Math.ceil((maxE - originX) / resX);
  const py0 = Math.max(0, Math.floor((originY - maxN) / resY));
  const py1 = Math.ceil((originY - minN) / resY);

  const window = [px0, py0, px1, py1];
  const [banda] = (await image.readRasters({ window })) as unknown as [
    ArrayLike<number>,
  ];
  const out = new Float32Array(banda.length);
  for (let i = 0; i < banda.length; i++) out[i] = banda[i] / 10000;

  return {
    values: out,
    window: {
      epsg,
      originEasting: originX + px0 * resX,
      originNorthing: originY - py0 * resY,
      pixelWidth: resX,
      pixelHeight: resY,
      width: px1 - px0,
      height: py1 - py0,
    },
  };
}

/**
 * Ricampiona (nearest neighbor) una banda sulla griglia di riferimento, usando
 * le coordinate UTM dei centri pixel. Se la banda è già sulla griglia `ref`,
 * la restituisce invariata. I pixel fuori dalla banda diventano NaN.
 */
function resampleToReference(
  banda: BandaLetta,
  ref: RasterWindow,
): Float32Array {
  if (
    banda.window.width === ref.width &&
    banda.window.height === ref.height &&
    banda.window.pixelWidth === ref.pixelWidth &&
    banda.window.originEasting === ref.originEasting &&
    banda.window.originNorthing === ref.originNorthing
  ) {
    return banda.values;
  }
  const src = banda.window;
  const out = new Float32Array(ref.width * ref.height);
  for (let row = 0; row < ref.height; row++) {
    const north = ref.originNorthing - (row + 0.5) * ref.pixelHeight;
    const srcRow = Math.floor((src.originNorthing - north) / src.pixelHeight);
    for (let col = 0; col < ref.width; col++) {
      const east = ref.originEasting + (col + 0.5) * ref.pixelWidth;
      const srcCol = Math.floor((east - src.originEasting) / src.pixelWidth);
      out[row * ref.width + col] =
        srcRow >= 0 && srcRow < src.height && srcCol >= 0 && srcCol < src.width
          ? banda.values[srcRow * src.width + srcCol]
          : Number.NaN;
    }
  }
  return out;
}

/** Banda di riferimento = quella a griglia più fine (più pixel). */
function scegliRiferimento(bande: BandaLetta[]): RasterWindow {
  return bande.reduce((best, b) =>
    b.window.width * b.window.height > best.window.width * best.window.height
      ? b
      : best,
  ).window;
}

async function elaboraScena(
  scena: IndicesScene,
  job: SoilJob,
  conOverlay: boolean,
): Promise<{
  punto: SeriesPoint;
  cells: IndexCellsResult | null;
  vraCells: VraCells | null;
}> {
  const bandNames = Object.keys(scena.bandHrefs);
  const lette = await Promise.all(
    bandNames.map(async (name) => ({
      name,
      banda: await readBand(scena.bandHrefs[name], job.bbox),
    })),
  );
  const ref = scegliRiferimento(lette.map((l) => l.banda));
  const bande: Record<string, Float32Array> = {};
  for (const { name, banda } of lette) {
    bande[name] = resampleToReference(banda, ref);
  }

  const medie: Partial<Record<VegetationIndex, number>> = {};
  let validPixels = 0;
  let vraCells: VraCells | null = null;
  // Masked di TUTTI gli indici della scena corrente: input di rasterToIndexCells
  // (celle vettoriali multi-indice). Popolato solo quando serve davvero
  // (scena più recente, e non per il job VRA che non ne ha bisogno).
  const layers: IndexLayerRaster[] = [];

  for (const index of job.indices) {
    const valori = computeIndex(index, bande, { L: job.L });
    const { masked } = clipRasterToPolygon(valori, ref, job.geometria);
    const stats = indexStatistics(masked);
    medie[index] = stats.media;
    validPixels = Math.max(validPixels, stats.validPixels);

    if (conOverlay) {
      if (job.vra) {
        // Vettorizzazione VRA solo se richiesta (module Mappe VRA, non analisi).
        if (index === job.primaryIndex) {
          vraCells = rasterToGridCells(masked, ref, job.vra.step);
        }
      } else {
        layers.push({ index, values: masked });
      }
    }
  }

  let cells: IndexCellsResult | null = null;
  if (conOverlay && !job.vra && layers.length > 0) {
    cells = {
      index: job.primaryIndex,
      datetime: scena.datetime,
      cellSizeM: ref.pixelWidth,
      cells: rasterToIndexCells(layers, ref, {
        primaryIndex: job.primaryIndex,
        plotId: job.plotId,
      }),
    };
  }

  return {
    punto: {
      datetime: scena.datetime,
      cloudCover: scena.cloudCover,
      medie,
      validPixels,
    },
    cells,
    vraCells,
  };
}

ctx.addEventListener("message", async (event: MessageEvent<SoilJob>) => {
  const job = event.data;
  if (job?.type !== "suolo") return;
  try {
    if (job.scene.length === 0) {
      throw new Error("Nessuna scena available per i filters scelti.");
    }
    const series: SeriesPoint[] = [];
    let cells: IndexCellsResult | null = null;
    let vraCells: VraCells | null = null;

    for (let i = 0; i < job.scene.length; i++) {
      ctx.postMessage({
        type: "progress",
        phase: "download",
        scenaCorrente: i + 1,
        sceneTotali: job.scene.length,
      } satisfies SoilProgress);

      // La scena più recente (i === 0) produce le celle indice (e quelle VRA).
      const { punto, cells: cellsResult, vraCells: c } = await elaboraScena(
        job.scene[i],
        job,
        i === 0,
      );
      series.push(punto);
      if (cellsResult) cells = cellsResult;
      if (c) vraCells = c;
    }

    // Serie cronologica crescente per il grafico di trend.
    series.reverse();

    // GeoJSON è strutturato via structured clone: nessun buffer da trasferire
    // (a differenza del vecchio RGBA raster).
    ctx.postMessage({ type: "done", series, cells, vraCells } satisfies SoilProgress);
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies SoilProgress);
  }
});
