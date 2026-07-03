/// <reference lib="webworker" />
import {
  applicaTokenSas,
  calcolaIndice,
  clipRasterAlPoligono,
  finestraToCoordinates,
  indiceToRgba,
  type IndiceVegetazionale,
  lonLatToUtm,
  type OverlayCoordinates,
  type RasterWindow,
  rampaPerIndice,
  type ScenaIndici,
  SENTINEL2_COLLECTION,
  statisticheIndice,
  type TokenSas,
  tokenPlanetaryComputer,
} from "@agrogea/tools";
import { fromUrl, type GeoTIFFImage } from "geotiff";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { rasterToGridCells } from "../modules/vra/raster-cells";

/**
 * Web Worker del modulo Suolo (refactor pipeline indici STAC). Fa il lavoro
 * pesante fuori dal main thread: per ogni scena della serie temporale scarica
 * SOLO le bande necessarie (finestra COG via HTTP-Range), le riallinea su una
 * griglia comune, calcola gli indici scelti, ritaglia sul poligono e ne fa la
 * media. Per la scena più recente produce anche il buffer RGBA dell'indice
 * primario (overlay raster sulla mappa) e i quattro angoli geografici.
 *
 * Le bande Sentinel-2 hanno risoluzioni diverse (B05 a 20 m, B03/B04/B08 a
 * 10 m): tutte vengono ricampionate (nearest neighbor) sulla griglia di
 * riferimento — la banda letta a risoluzione più fine — così l'algebra fra
 * bande lavora su array allineati.
 */

export interface SuoloJob {
  tipo: "suolo";
  /** Serie di scene, dalla più recente alla più vecchia (vedi cercaSerieScene). */
  scene: ScenaIndici[];
  indici: IndiceVegetazionale[];
  /** Indice da renderizzare come overlay raster (sulla scena più recente). */
  indicePrimario: IndiceVegetazionale;
  geometria: Polygon | MultiPolygon;
  bbox: [number, number, number, number];
  /** Fattore L per SAVI (default lato libreria). */
  L?: number;
  /**
   * Quando presente, oltre all'overlay il worker vettorizza il raster
   * dell'indice primario (scena più recente) in celle quadrate di `step` pixel,
   * input della zonazione VRA. Assente per la sola analisi indici.
   */
  vra?: { step: number };
}

/** Cella della griglia VRA: poligono con valore medio dell'indice primario. */
export type VraCells = FeatureCollection<Polygon, { valore: number }>;

export interface PuntoSerie {
  datetime: string;
  cloudCover: number | null;
  /** Media per indice (chiave = indice), NaN se nessun pixel valido. */
  medie: Partial<Record<IndiceVegetazionale, number>>;
  pixelValidi: number;
}

export interface OverlayRaster {
  indice: IndiceVegetazionale;
  datetime: string;
  /** RGBA row-major (width·height·4); i pixel fuori dal poligono sono trasparenti. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Angoli [lng,lat] per la sorgente image MapLibre (TL, TR, BR, BL). */
  coordinates: OverlayCoordinates;
}

export type SuoloProgress =
  | {
      tipo: "progress";
      fase: "download" | "calcolo";
      scenaCorrente: number;
      sceneTotali: number;
    }
  | {
      tipo: "done";
      serie: PuntoSerie[];
      overlay: OverlayRaster | null;
      /** Celle VRA dell'indice primario, solo se `job.vra` è impostato. */
      vraCells: VraCells | null;
    }
  | { tipo: "error"; messaggio: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Token SAS della collezione Sentinel-2, cachato per la vita del worker. Un solo
 * token firma tutti gli asset di tutte le scene → niente burst di richieste di
 * firma (causa dei 429). `tokenInFlight` deduplica le richieste concorrenti
 * (le bande di una scena sono lette in parallelo).
 */
let tokenCache: TokenSas | null = null;
let tokenInFlight: Promise<string> | null = null;

async function tokenSentinel(): Promise<string> {
  if (tokenCache && tokenCache.scadenzaMs > Date.now() + 60_000) {
    return tokenCache.token;
  }
  tokenInFlight ??= tokenPlanetaryComputer(SENTINEL2_COLLECTION)
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
async function leggiBanda(
  href: string,
  bboxLonLat: [number, number, number, number],
): Promise<BandaLetta> {
  // Gli asset Planetary Computer vanno firmati (SAS token), altrimenti il blob
  // Azure risponde 409 PublicAccessNotPermitted. Si usa il token di collezione
  // cachato (una richiesta sola), evitando i 429 da firma per-href.
  const signed = applicaTokenSas(href, await tokenSentinel());
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
function ricampionaSuRiferimento(
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
  scena: ScenaIndici,
  job: SuoloJob,
  conOverlay: boolean,
): Promise<{
  punto: PuntoSerie;
  overlay: OverlayRaster | null;
  vraCells: VraCells | null;
}> {
  const nomiBande = Object.keys(scena.bandHrefs);
  const lette = await Promise.all(
    nomiBande.map(async (nome) => ({
      nome,
      banda: await leggiBanda(scena.bandHrefs[nome], job.bbox),
    })),
  );
  const ref = scegliRiferimento(lette.map((l) => l.banda));
  const bande: Record<string, Float32Array> = {};
  for (const { nome, banda } of lette) {
    bande[nome] = ricampionaSuRiferimento(banda, ref);
  }

  const medie: Partial<Record<IndiceVegetazionale, number>> = {};
  let pixelValidi = 0;
  let overlay: OverlayRaster | null = null;
  let vraCells: VraCells | null = null;

  for (const indice of job.indici) {
    const valori = calcolaIndice(indice, bande, { L: job.L });
    const { masked } = clipRasterAlPoligono(valori, ref, job.geometria);
    const stats = statisticheIndice(masked);
    medie[indice] = stats.media;
    pixelValidi = Math.max(pixelValidi, stats.pixelValidi);

    if (conOverlay && indice === job.indicePrimario) {
      overlay = {
        indice,
        datetime: scena.datetime,
        rgba: indiceToRgba(masked, rampaPerIndice(indice)),
        width: ref.width,
        height: ref.height,
        coordinates: finestraToCoordinates(ref),
      };
      // Vettorizzazione VRA solo se richiesta (modulo Mappe VRA, non analisi).
      if (job.vra) {
        vraCells = rasterToGridCells(masked, ref, job.vra.step);
      }
    }
  }

  return {
    punto: {
      datetime: scena.datetime,
      cloudCover: scena.cloudCover,
      medie,
      pixelValidi,
    },
    overlay,
    vraCells,
  };
}

ctx.addEventListener("message", async (event: MessageEvent<SuoloJob>) => {
  const job = event.data;
  if (job?.tipo !== "suolo") return;
  try {
    if (job.scene.length === 0) {
      throw new Error("Nessuna scena disponibile per i filtri scelti.");
    }
    const serie: PuntoSerie[] = [];
    let overlay: OverlayRaster | null = null;
    let vraCells: VraCells | null = null;

    for (let i = 0; i < job.scene.length; i++) {
      ctx.postMessage({
        tipo: "progress",
        fase: "download",
        scenaCorrente: i + 1,
        sceneTotali: job.scene.length,
      } satisfies SuoloProgress);

      // La scena più recente (i === 0) produce l'overlay (e le celle VRA).
      const { punto, overlay: o, vraCells: c } = await elaboraScena(
        job.scene[i],
        job,
        i === 0,
      );
      serie.push(punto);
      if (o) overlay = o;
      if (c) vraCells = c;
    }

    // Serie cronologica crescente per il grafico di trend.
    serie.reverse();

    const transfer = overlay ? [overlay.rgba.buffer] : [];
    ctx.postMessage(
      { tipo: "done", serie, overlay, vraCells } satisfies SuoloProgress,
      transfer,
    );
  } catch (error) {
    ctx.postMessage({
      tipo: "error",
      messaggio: error instanceof Error ? error.message : String(error),
    } satisfies SuoloProgress);
  }
});
