import type { TerrainSummary } from "@agrogea/tools";
import { STAC_API_URL, applySasToken, planetaryComputerToken } from "@agrogea/tools";
import { fromUrl } from "geotiff";
import type { Geometry } from "geojson";
import { geometryBbox } from "./geo-compliance";

/**
 * Pendenza dell'appezzamento dal **Copernicus DEM GLO-30**, per la BCAA 5.
 *
 * ## Perché un DEM e non il satellite ottico
 *
 * La pendenza è morfologia, non copertura: non cambia con la stagione, non la
 * nascondono le nuvole e non si ricava da una riflettanza. Serve un modello
 * digitale del terreno, e il Copernicus DEM GLO-30 è quello giusto per questo
 * uso: copertura globale, 30 m di passo, gratuito, e già nel catalogo STAC che
 * la pipeline degli indici interroga (`cop-dem-glo-30`, asset `data`). Nessuna
 * fonte nuova da configurare, nessun upload chiesto all'utente.
 *
 * ## Come si calcola la pendenza
 *
 * Con l'algoritmo di **Horn (1981)**, lo stesso di `gdaldem slope` e di QGIS:
 * su ogni cella si stima il gradiente con una finestra 3×3 pesata, e la
 * pendenza è l'arcotangente del modulo del gradiente. È preferito alle
 * differenze finite semplici perché media su otto vicini invece che su due, ed
 * è quindi molto meno sensibile al rumore del DEM — che su un modello a 30 m
 * derivato da radar non è trascurabile.
 *
 * ## Il limite da dire
 *
 * 30 metri di passo **lisciano** la morfologia: un terrazzamento, una scarpata
 * o un impluvio stretto spariscono nella media della cella. La pendenza che si
 * ottiene è quella del versante, non quella del punto — ed è comunque la scala
 * a cui la BCAA 5 ragiona, perché l'obbligo riguarda l'appezzamento e non il
 * singolo metro quadro.
 */

/** Collezione STAC del modello digitale del terreno. */
export const DEM_COLLECTION = "cop-dem-glo-30";

/** Passo nominale del DEM, in metri. */
export const DEM_GSD_M = 30;

interface DemWindow {
  values: Float32Array;
  width: number;
  height: number;
  /** Passo della cella in metri, lungo x e y. */
  cellX: number;
  cellY: number;
}

/**
 * Pendenza in gradi per cella, con l'algoritmo di Horn. Le celle di bordo non
 * hanno gli otto vicini e restano `NaN`: meglio un buco dichiarato che una
 * pendenza calcolata su una finestra incompleta.
 */
export function hornSlopeDegrees(dem: DemWindow): Float32Array {
  const { values, width, height, cellX, cellY } = dem;
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const at = (r: number, c: number) => values[r * width + c];
      const a = at(row - 1, col - 1);
      const b = at(row - 1, col);
      const c = at(row - 1, col + 1);
      const d = at(row, col - 1);
      const f = at(row, col + 1);
      const g = at(row + 1, col - 1);
      const h = at(row + 1, col);
      const i = at(row + 1, col + 1);
      if ([a, b, c, d, f, g, h, i].some((v) => !Number.isFinite(v))) continue;
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellX);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellY);
      out[row * width + col] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  return out;
}

/** Media e massimo delle pendenze valide. `null` se non ce n'è nessuna. */
export function slopeStatistics(
  slopes: Float32Array,
): { mean: number; max: number } | null {
  let sum = 0;
  let count = 0;
  let max = 0;
  for (const value of slopes) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
    if (value > max) max = value;
  }
  return count === 0 ? null : { mean: sum / count, max };
}

/**
 * Scarica la finestra di DEM che copre l'appezzamento e ne ricava la pendenza.
 *
 * Il bbox viene allargato di una cella per lato: l'algoritmo di Horn consuma un
 * anello di bordo, e senza margine un appezzamento piccolo resterebbe senza
 * nemmeno una cella valida.
 */
export async function fetchTerrainSummary(
  geometry: Geometry,
  options: { fetchImpl?: typeof fetch; apiUrl?: string } = {},
): Promise<TerrainSummary | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? STAC_API_URL;
  const [minLon, minLat, maxLon, maxLat] = geometryBbox(geometry);
  // Un margine di ~2 celle in gradi (30 m ≈ 0.00027°).
  const pad = 0.0006;

  const res = await fetchImpl(`${apiUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: [DEM_COLLECTION],
      bbox: [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad],
      limit: 1,
    }),
  });
  if (!res.ok) throw new Error(`Ricerca DEM fallita: HTTP ${res.status}`);
  const collection = (await res.json()) as {
    features?: { id: string; assets: Record<string, { href: string }> }[];
  };
  const item = collection.features?.[0];
  const href = item?.assets?.["data"]?.href;
  if (!href) return null;

  const token = await planetaryComputerToken(DEM_COLLECTION, { fetchImpl });
  const tiff = await fromUrl(applySasToken(href, token.token));
  const image = await tiff.getImage();
  const [originX, originY] = image.getOrigin();
  const [resX, resYsigned] = image.getResolution();
  const resY = Math.abs(resYsigned);

  // Il DEM Copernicus è in coordinate geografiche (EPSG:4326): la finestra si
  // ricava direttamente dai gradi, senza passare per UTM.
  const px0 = Math.max(0, Math.floor((minLon - pad - originX) / resX));
  const px1 = Math.min(
    image.getWidth(),
    Math.ceil((maxLon + pad - originX) / resX),
  );
  const py0 = Math.max(0, Math.floor((originY - (maxLat + pad)) / resY));
  const py1 = Math.min(
    image.getHeight(),
    Math.ceil((originY - (minLat - pad)) / resY),
  );
  if (px1 <= px0 || py1 <= py0) return null;

  const [band] = (await image.readRasters({
    window: [px0, py0, px1, py1],
  })) as unknown as [ArrayLike<number>];
  const width = px1 - px0;
  const height = py1 - py0;
  const values = new Float32Array(band.length);
  for (let i = 0; i < band.length; i++) values[i] = band[i];

  // Passo della cella in METRI: la longitudine si accorcia con il coseno della
  // latitudine, e ignorarlo gonfierebbe la pendenza est-ovest.
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const cellY = resY * 111_320;
  const cellX = resX * 111_320 * Math.cos(midLat);

  const stats = slopeStatistics(
    hornSlopeDegrees({ values, width, height, cellX, cellY }),
  );
  if (!stats) return null;

  return {
    meanSlopeDeg: stats.mean,
    maxSlopeDeg: stats.max,
    source: `Copernicus DEM GLO-30 · ${item.id}`,
  };
}
