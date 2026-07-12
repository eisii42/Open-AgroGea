/**
 * Offline Tile Cache — pre-download tile cartografiche per un'area geografica
 * definita da un bounding box e le memorizza nella Cache API del browser
 * (condivisa con il Service Worker `sw.js`).
 *
 * Architettura:
 *   - Calcola le coordinate XYZ per ogni zoom level nell'area.
 *   - Usa un semaforo (maxConcurrent) per non saturare la rete.
 *   - Scrive nella stessa cache "agrogea-tiles-v1" del Service Worker.
 *   - Il chiamante riceve aggiornamenti di progresso via callback.
 */

const TILE_CACHE_NAME = "agrogea-tiles-v1";
const MAX_CONCURRENT = 6;
const MAX_TILES_GUARD = 8000;

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DownloadProgress {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
}

export type ProgressCallback = (p: DownloadProgress) => void;

/** Converte longitudine in X tile. */
function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

/** Converte latitudine in Y tile (convenzione TMS top-left). */
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Genera tutte le coordinate tile nell'area per i livelli di zoom dati. */
export function tileCoords(bbox: BBox, minZ: number, maxZ: number): TileCoord[] {
  const coords: TileCoord[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lon2tile(bbox.west, z);
    const xMax = lon2tile(bbox.east, z);
    const yMin = lat2tile(bbox.north, z);
    const yMax = lat2tile(bbox.south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        coords.push({ z, x, y });
      }
    }
  }
  return coords;
}

/** Stima tile count senza allocare l'array completo (per UI preview). */
export function estimateTileCount(bbox: BBox, minZ: number, maxZ: number): number {
  let total = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lon2tile(bbox.west, z);
    const xMax = lon2tile(bbox.east, z);
    const yMin = lat2tile(bbox.north, z);
    const yMax = lat2tile(bbox.south, z);
    total += (xMax - xMin + 1) * (yMax - yMin + 1);
  }
  return total;
}

/**
 * Scarica e mette in cache tutte le tile per il bbox / zoom dati.
 *
 * @param tileTemplate URL template con `{z}`, `{x}`, `{y}` placeholder.
 * @param bbox         Area geografica (EPSG:4326).
 * @param minZ         Zoom minimo (es. 8 per visione regionale).
 * @param maxZ         Zoom massimo (es. 16 per dettaglio field).
 * @param onProgress   Callback aggiornata ad ogni tile scaricata.
 * @param signal       AbortSignal per annullare il download.
 */
export async function downloadAreaTiles(
  tileTemplate: string,
  bbox: BBox,
  minZ: number,
  maxZ: number,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<void> {
  if (!("caches" in window)) {
    throw new Error(
      "Cache API non available. Usa la build nativa Tauri per il caching offline.",
    );
  }

  const coords = tileCoords(bbox, minZ, maxZ);
  if (coords.length > MAX_TILES_GUARD) {
    throw new Error(
      `Area troppo grande: ${coords.length} tile (max ${MAX_TILES_GUARD}). Riduci l'area o i livelli di zoom.`,
    );
  }

  const cache = await caches.open(TILE_CACHE_NAME);
  const progress: DownloadProgress = {
    total: coords.length,
    done: 0,
    failed: 0,
    cancelled: false,
  };
  onProgress({ ...progress });

  // Coda con semaforo a MAX_CONCURRENT slot paralleli.
  let idx = 0;
  async function worker() {
    while (idx < coords.length) {
      if (signal.aborted) {
        progress.cancelled = true;
        onProgress({ ...progress });
        return;
      }
      const { z, x, y } = coords[idx++];
      const url = tileTemplate
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      try {
        const cached = await cache.match(url);
        if (!cached) {
          const resp = await fetch(url, { signal });
          if (resp.ok) await cache.put(url, resp);
        }
        progress.done++;
      } catch {
        if (signal.aborted) {
          progress.cancelled = true;
          onProgress({ ...progress });
          return;
        }
        progress.failed++;
      }
      onProgress({ ...progress });
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
}

/** Ritorna le URL di tile attualmente in cache (per debug / statistiche). */
export async function cachedTileCount(): Promise<number> {
  if (!("caches" in window)) return 0;
  const cache = await caches.open(TILE_CACHE_NAME);
  return (await cache.keys()).length;
}

/** Svuota l'intera cache tile offline. */
export async function clearTileCache(): Promise<void> {
  if (!("caches" in window)) return;
  await caches.delete(TILE_CACHE_NAME);
}
