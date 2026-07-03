import { isTauriRuntime } from "@agrogea/core";
import maplibregl from "maplibre-gl";

/**
 * Proxy dei tile WMS per la mappa di campo. Risolve DUE problemi insieme:
 *
 *  1. CRS — alcuni WMS (es. il Catasto dell'Agenzia delle Entrate) NON parlano
 *     EPSG:3857, l'unico CRS con cui MapLibre interroga i raster. Qui si
 *     riproietta il bbox del tile mercatore in EPSG:4258 (ETRS89 geografico,
 *     praticamente WGS84) prima di chiamare il server. La lieve distorsione
 *     mercatore→equirettangolare è trascurabile alle scale di campo.
 *  2. CORS — quei server non espongono header CORS, quindi il fetch del tile
 *     deve passare da un proxy: il comando nativo Rust `agro_fetch_map_tile`
 *     sotto Tauri, il middleware del dev server Vite (`/__geolibre_wms_proxy`)
 *     sul web.
 *
 * Si registra un protocollo MapLibre custom (`agrogeawms://`) cross-platform: il
 * client interroga lo scheme, l'handler riproietta + instrada al proxy giusto.
 */

export const MAP_PROXY_SCHEME = "agrogeawms";

// Deve combaciare con WMS_PROXY_PATH di @geolibre/map e con il middleware in
// vite.config.ts: è il proxy CORS del dev server (no-op fuori da Vite).
const DEV_WMS_PROXY = "/__geolibre_wms_proxy";

// Semiperimetro del mondo in Web Mercator (R·π), per l'inversione 3857→geo.
const MERC_MAX = Math.PI * 6378137;

/** Inversione Web Mercator (EPSG:3857, metri) → [lon, lat] in gradi. */
function mercToLngLat(x: number, y: number): [number, number] {
  const lon = (x / MERC_MAX) * 180;
  const latRad = 2 * Math.atan(Math.exp((y / MERC_MAX) * Math.PI)) - Math.PI / 2;
  return [lon, (latRad * 180) / Math.PI];
}

/**
 * Se la richiesta GetMap è in EPSG:3857, la riscrive in EPSG:4258 con il bbox
 * riproiettato e l'ordine assi lat,lon richiesto da WMS 1.3.0 per i CRS
 * geografici. Altrimenti la lascia invariata. Ricostruisce la query a mano per
 * non ri-codificare le virgole del bbox (alcuni server WMS le rifiutano).
 */
export function reprojectWmsTo4258(target: string): string {
  const qIdx = target.indexOf("?");
  if (qIdx < 0) return target;
  const base = target.slice(0, qIdx);
  const params = new URLSearchParams(target.slice(qIdx + 1));
  const crs = params.get("crs") ?? params.get("CRS");
  const bbox = params.get("bbox") ?? params.get("BBOX");
  if (!bbox || crs?.toUpperCase() !== "EPSG:3857") return target;
  const nums = bbox.split(",").map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return target;
  const [minx, miny, maxx, maxy] = nums;
  const [minLon, minLat] = mercToLngLat(minx, miny);
  const [maxLon, maxLat] = mercToLngLat(maxx, maxy);

  params.delete("crs");
  params.delete("CRS");
  params.delete("bbox");
  params.delete("BBOX");
  const kept: string[] = [];
  for (const [k, v] of params) kept.push(`${k}=${v}`);
  kept.push("crs=EPSG:4258");
  kept.push(`bbox=${minLat},${minLon},${maxLat},${maxLon}`);
  return `${base}?${kept.join("&")}`;
}

let registered = false;

/**
 * Registra una sola volta il protocollo custom. Da chiamare all'avvio, PRIMA che
 * la mappa monti le sorgenti. Attivo sia su web (proxy del dev server) sia su
 * Tauri (comando nativo): l'handler distingue il runtime.
 */
export function registerMapTileProxy(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(MAP_PROXY_SCHEME, async (params) => {
    // params.url = "agrogeawms://t/?url=<WMS url, bbox 3857 già sostituito>"
    const inner = new URL(params.url).searchParams.get("url");
    if (!inner) throw new Error("URL tile mancante nel protocollo WMS.");
    const target = reprojectWmsTo4258(inner);
    let data: ArrayBuffer;
    if (isTauriRuntime()) {
      const { invoke } = await import("@tauri-apps/api/core");
      data = await invoke<ArrayBuffer>("agro_fetch_map_tile", { url: target });
    } else {
      const res = await fetch(`${DEV_WMS_PROXY}?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error(`Proxy WMS ha risposto ${res.status}`);
      data = await res.arrayBuffer();
    }
    return { data };
  });
}

/**
 * Riscrive un template WMS come URL del protocollo custom, lasciando LETTERALE il
 * token {bbox-epsg-3857} così MapLibre possa sostituirlo per ogni tile.
 */
export function proxiedWmsTileUrl(wmsTemplate: string): string {
  const encoded = encodeURIComponent(wmsTemplate).replaceAll(
    "%7Bbbox-epsg-3857%7D",
    "{bbox-epsg-3857}",
  );
  return `${MAP_PROXY_SCHEME}://t/?url=${encoded}`;
}
