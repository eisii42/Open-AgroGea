import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import { EXTERNAL_LAYER_FLAG } from "./add-data";
import { buildWmsTileUrl, type WmsVersion } from "./wms";

/**
 * Servizi WMS salvati come **sfondo** della mappa, per azienda.
 *
 * Un WMS aggiunto da "Aggiungi dati" viveva solo nello store in memoria:
 * chiudendo l'app spariva e andava ricercato da capo (indirizzo, elenco dei
 * layer, scelta). Qui se ne conserva la configurazione — non le immagini, che
 * restano del server che le pubblica — così alla riapertura torna com'era e si
 * può modificare o eliminare.
 *
 * Un WMS salvato è un'alternativa al satellite, non un layer in più: quando è
 * attivo prende il posto della vista satellitare (un solo sfondo alla volta),
 * resta sotto i dati dell'azienda e sotto l'overlay catastale.
 *
 * Persistenza per dispositivo in localStorage, come le altre preferenze di
 * visualizzazione per azienda (grafici e schede KPI del Command Center): è
 * configurazione della vista, non un dato agronomico da sincronizzare.
 */

export interface SavedWmsBasemap {
  id: string;
  /** Nome mostrato nel selettore di sfondo (titolo del layer WMS). */
  name: string;
  /** Endpoint del servizio, come l'ha incollato l'utente. */
  baseUrl: string;
  /** Nome tecnico del layer (parametro `LAYERS`). */
  layerName: string;
  version: WmsVersion;
  /** Testo per la barra attribuzioni della mappa. */
  attribution: string;
}

export interface WmsBasemapState {
  items: SavedWmsBasemap[];
  /** WMS attualmente usato come sfondo, o null (stradario o satellite). */
  activeId: string | null;
}

export const EMPTY_WMS_BASEMAPS: WmsBasemapState = { items: [], activeId: null };

/** Prefisso degli id dei layer dello store che rappresentano un WMS salvato. */
export const WMS_BASEMAP_LAYER_PREFIX = "agrogea-wms-basemap-";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function storageKey(companyId: string): string {
  return `agrogea.wmsBasemaps.${companyId}`;
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function sanitizeItem(raw: unknown): SavedWmsBasemap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const id = str(o.id);
  const baseUrl = str(o.baseUrl);
  const layerName = str(o.layerName);
  if (!id || !baseUrl || !layerName) return null;
  return {
    id,
    name: str(o.name) || layerName,
    baseUrl,
    layerName,
    version: o.version === "1.1.1" ? "1.1.1" : "1.3.0",
    attribution: str(o.attribution),
  };
}

/** Legge i WMS salvati dell'azienda; un contenuto corrotto vale "nessuno". */
export function loadWmsBasemaps(
  companyId: string,
  storage: KeyValueStorage | undefined = defaultStorage(),
): WmsBasemapState {
  try {
    const raw = storage?.getItem(storageKey(companyId));
    if (!raw) return EMPTY_WMS_BASEMAPS;
    const parsed = JSON.parse(raw) as { items?: unknown; activeId?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map(sanitizeItem)
          .filter((i): i is SavedWmsBasemap => i != null)
      : [];
    const activeId =
      typeof parsed.activeId === "string" &&
      items.some((i) => i.id === parsed.activeId)
        ? parsed.activeId
        : null;
    return { items, activeId };
  } catch {
    return EMPTY_WMS_BASEMAPS;
  }
}

export function persistWmsBasemaps(
  companyId: string,
  state: WmsBasemapState,
  storage: KeyValueStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(storageKey(companyId), JSON.stringify(state));
  } catch {
    /* storage pieno o non disponibile: il WMS resta per questa sessione */
  }
}

/** Aggiunge o sostituisce (stesso id) un WMS salvato. */
export function upsertWmsBasemap(
  state: WmsBasemapState,
  item: SavedWmsBasemap,
): WmsBasemapState {
  const exists = state.items.some((i) => i.id === item.id);
  return {
    ...state,
    items: exists
      ? state.items.map((i) => (i.id === item.id ? item : i))
      : [...state.items, item],
  };
}

/** Elimina un WMS salvato; se era lo sfondo attivo, lo sfondo si azzera. */
export function removeWmsBasemap(
  state: WmsBasemapState,
  id: string,
): WmsBasemapState {
  return {
    items: state.items.filter((i) => i.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  };
}

export function wmsBasemapLayerId(id: string): string {
  return `${WMS_BASEMAP_LAYER_PREFIX}${id}`;
}

/** Id del WMS salvato a partire dall'id del layer dello store, o null. */
export function savedWmsIdFromLayerId(layerId: string): string | null {
  return layerId.startsWith(WMS_BASEMAP_LAYER_PREFIX)
    ? layerId.slice(WMS_BASEMAP_LAYER_PREFIX.length)
    : null;
}

/** Layer dello store GeoLibre che disegna il WMS salvato. */
export function wmsBasemapLayer(item: SavedWmsBasemap): GeoLibreLayer {
  return {
    id: wmsBasemapLayerId(item.id),
    name: item.name,
    type: "wms",
    source: {
      type: "raster",
      tiles: [
        buildWmsTileUrl({
          baseUrl: item.baseUrl,
          layerName: item.layerName,
          version: item.version,
        }),
      ],
      tileSize: 256,
      // Citata nella barra attribuzioni della mappa (useLayerAttributions).
      ...(item.attribution ? { attribution: item.attribution } : {}),
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {
      agrogea: true,
      [EXTERNAL_LAYER_FLAG]: true,
      formato: "wms",
      wmsBasemap: true,
      wmsEndpoint: item.baseUrl,
      wmsLayer: item.layerName,
      wmsVersion: item.version,
    },
    sourcePath: item.baseUrl,
  };
}
