import { boundingBox, type AgroDal, type Plot } from "@agrogea/core";
import {
  bestScenePerDay,
  searchSceneSeries,
  type CheckSpec,
  type IndicesScene,
  type VegetationIndex,
} from "@agrogea/tools";
import { processScenes, sceneCoversIndices } from "../soil/index-cache";

/**
 * Verifica e recupero delle scene che mancano a una scheda.
 *
 * ## Perché per scheda e non per appezzamento
 *
 * Ogni scheda dichiara la propria finestra e i propri indici: la copertura del
 * suolo guarda tre mesi d'inverno, la rotazione tre annate, gli sfalci la
 * stagione vegetativa. Scaricare "tutto lo storico dell'appezzamento"
 * significherebbe prendere l'archivio della scheda più esigente per far girare
 * quella che l'utente ha davanti. Qui si chiede al catalogo esattamente la
 * finestra della scheda, si sottrae ciò che la cache ha già, e si scarica il
 * resto.
 *
 * ## Il riuso è automatico, ed è il punto
 *
 * La cache è per `(plot_id, scene_id)` con le medie degli indici **fuse**:
 * quando una scheda scarica una scena, ogni altra scheda che quella scena la
 * tocca nella propria finestra se la ritrova già pronta. Dodici schede che
 * guardano l'NDVI della stessa annata pagano una volta sola: è la ragione per
 * cui il costo mostrato all'utente è sempre quello *residuo*, non quello
 * teorico della scheda.
 *
 * ## Il costo, misurato e non stimato
 *
 * I COG del Planetary Computer sono tiles da 512×512: a 10 m una tile copre
 * 2621 ha, quindi un appezzamento normale ne tocca una sola per banda. Misurato
 * su scene reali: **~0,45 MB per banda per scena**, indipendente dalla
 * superficie dell'appezzamento — un campo da mezzo ettaro costa quanto uno da
 * cinquecento.
 */

/** Byte per banda per scena, misurati sui COG Sentinel-2 del Planetary Computer. */
export const BYTES_PER_BAND_PER_SCENE = 0.45 * 1024 * 1024;

/** Bande distinte richieste da un insieme di indici (per il costo). */
function bandCount(indices: readonly VegetationIndex[]): number {
  const bands = new Set<string>();
  for (const index of indices) {
    // Ogni indice normalizzato usa due bande; le coppie si sovrappongono
    // (NDVI e NDRE condividono B08), quindi si contano le bande, non gli indici.
    if (index === "ndvi") ["B04", "B08"].forEach((b) => bands.add(b));
    else if (index === "ndre") ["B05", "B08"].forEach((b) => bands.add(b));
    else if (index === "ndwi") ["B03", "B08"].forEach((b) => bands.add(b));
    else if (index === "ndmi") ["B08", "B11"].forEach((b) => bands.add(b));
    else if (index === "nbr") ["B08", "B12"].forEach((b) => bands.add(b));
    else ["B04", "B08"].forEach((b) => bands.add(b));
  }
  return bands.size;
}

export interface SceneAvailability {
  checkId: string;
  /** Finestra della scheda, come la dichiara lei. */
  window: { from: string; to: string };
  indices: VegetationIndex[];
  /** Scene disponibili nel catalogo per quella finestra (una per giorno). */
  available: number;
  /** Di quelle, già in cache con gli indici richiesti. */
  cached: number;
  /** Da scaricare. */
  missing: number;
  /** Byte stimati, dal costo misurato per banda. */
  estimatedBytes: number;
  /** Le scene da elaborare, pronte per il recupero. */
  toFetch: IndicesScene[];
}

/**
 * Che cosa manca a una scheda per potersi pronunciare. Interroga il catalogo
 * (non scarica immagini) e confronta con la cache locale.
 *
 * `maxPages` risale la paginazione del catalogo: una finestra pluriennale ha
 * molte più scene del limite di pagina, e senza paginazione ne tornerebbero
 * solo le più recenti — in silenzio.
 */
export async function checkSceneAvailability(
  dal: AgroDal,
  plot: Plot,
  spec: CheckSpec,
  campaignYear: number,
  parameters: Parameters<CheckSpec["window"]>[1],
  options: { cloudCoverMax?: number } = {},
): Promise<SceneAvailability> {
  const window = spec.window(campaignYear, parameters);
  const indices = [...spec.requires.indices];
  if (indices.length === 0) {
    // Scheda non satellitare (biologico, fasce tampone, pendenza): non c'è
    // nulla da scaricare, e dirlo è più utile che mostrare uno zero ambiguo.
    return {
      checkId: spec.id,
      window,
      indices,
      available: 0,
      cached: 0,
      missing: 0,
      estimatedBytes: 0,
      toFetch: [],
    };
  }

  const series = await searchSceneSeries(boundingBox(plot.geometry), {
    indices,
    cloudCoverMax: options.cloudCoverMax,
    datetimeRange: { inizio: new Date(window.from), fine: new Date(window.to) },
    limit: 100,
    // Fino a sei pagine: copre abbondantemente le tre annate della scheda più
    // esigente del catalogo.
    maxPages: 6,
  });
  // Una scena per giorno, la meno nuvolosa: nello stesso giorno il catalogo
  // espone spesso più item (tile adiacenti, riprocessamenti).
  const daily = bestScenePerDay(series);

  const cached = await dal.listVegetationIndexScenes(plot.id, { limit: 5000 });
  const byId = new Map(cached.map((s) => [s.scene_id, s]));
  const toFetch = daily.filter((scene) => {
    const hit = byId.get(scene.itemId);
    return !hit || !sceneCoversIndices(hit, indices);
  });

  return {
    checkId: spec.id,
    window,
    indices,
    available: daily.length,
    cached: daily.length - toFetch.length,
    missing: toFetch.length,
    estimatedBytes: toFetch.length * bandCount(indices) * BYTES_PER_BAND_PER_SCENE,
    toFetch,
  };
}

export interface FetchProgress {
  done: number;
  total: number;
}

/**
 * Scarica ed elabora le scene mancanti, riusando la pipeline del modulo Suolo:
 * stesso Web Worker, stessa cache, stesso codec dei raster. Non c'è una seconda
 * implementazione del download — se ci fosse, le due cache divergerebbero.
 */
export async function fetchMissingScenes(
  dal: AgroDal,
  plot: Plot,
  availability: SceneAvailability,
  onProgress?: (progress: FetchProgress) => void,
): Promise<number> {
  if (availability.toFetch.length === 0) return 0;
  const processed = await processScenes({
    dal,
    plot,
    scenes: availability.toFetch,
    indices: availability.indices,
    primaryIndex: availability.indices[0],
    onProgress: (p) => {
      if (p.type !== "progress") return;
      onProgress?.({ done: p.scenaCorrente, total: p.sceneTotali });
    },
  });
  return processed.size;
}
