import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import type maplibregl from "maplibre-gl";
import { proxiedWmsTileUrl } from "./mapTileProxy";

/**
 * Basemap e overlay di sfondo aggiuntivi per la Modalità Campo, modellati come
 * LAYER raster dello store GeoLibre (stesso pattern del satellite originale):
 * vivono in fondo allo stack, sotto i vettori agronomici, e la loro
 * visibilità/opacità resta gestita dal Layer Manager nativo. Qui scriviamo solo
 * nello store (flusso unidirezionale), mai su MapLibre direttamente.
 *
 * Nota: l'imagery storica Esri Wayback NON è qui — è un controllo NATIVO di
 * GeoLibre (`maplibreEsriWaybackPlugin`, con selettore di release) attivato
 * on-demand in `useFieldPlugins`; questo file copre solo satellite e catasto.
 */

export const SATELLITE_LAYER_ID = "agrogea-basemap-satellite";
export const CADASTRE_LAYER_ID = "agrogea-basemap-cadastre";

/** Tutti gli id di basemap/overlay gestiti da AgroGea (per lo stacking). */
export const AGRO_BASEMAP_IDS = [SATELLITE_LAYER_ID, CADASTRE_LAYER_ID];

// Esri World Imagery: ortofoto ad alta risoluzione, senza chiave API per la sola
// visualizzazione come basemap.
const ESRI_WORLD_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/**
 * Ultimo livello di dettaglio con copertura globale garantita su Esri World
 * Imagery. Oltre a questo il servizio risponde con tile vuote/errore su buona
 * parte del territorio, e la vista satellitare "si buca": finché il satellite è
 * active la mappa viene quindi limitata a questo zoom (vedi l'effetto di
 * clamp in `BasemapSwitcher`). Al valore massimo della mappa (24) il limite è
 * di fatto disattivato.
 */
export const SATELLITE_MAX_ZOOM = 18;

// Catasto: WMS pubblico dell'Agenzia delle Entrate (INSPIRE Cadastral Parcels).
// Il template è in EPSG:3857 col token {bbox-epsg-3857} di MapLibre, MA il server
// NON supporta 3857 (solo ETRS89): il proxy `agrogeawms://` riproietta il bbox in
// EPSG:4258 prima di interrogarlo (vedi lib/mapTileProxy.ts). PNG trasparente,
// così funge da overlay sopra il satellite ma sotto i vettori agronomici.
const CADASTRE_WMS =
  "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php" +
  "?service=WMS&request=GetMap&version=1.3.0&layers=CP.CadastralParcel" +
  "&styles=&format=image/png&transparent=true&width=256&height=256" +
  "&crs=EPSG:3857&bbox={bbox-epsg-3857}";

export function satelliteLayer(): GeoLibreLayer {
  return {
    id: SATELLITE_LAYER_ID,
    name: "Satellite",
    type: "raster",
    source: {
      type: "raster",
      tiles: [ESRI_WORLD_IMAGERY],
      tileSize: 256,
      maxzoom: SATELLITE_MAX_ZOOM,
      attribution:
        "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { agrogea: true, basemap: true },
    sourcePath: `agrogea://${SATELLITE_LAYER_ID}`,
  };
}

export function cadastreLayer(): GeoLibreLayer {
  // Il tile passa sempre dal protocollo custom `agrogeawms://` (riproiezione
  // 3857→4258 + proxy CORS, vedi lib/mapTileProxy.ts), identico su web e Tauri.
  // type "raster" (non "wms"): così il layer-sync di GeoLibre lo lascia stare e
  // non lo ri-instrada al proxy del dev server (doppio proxy).
  return {
    id: CADASTRE_LAYER_ID,
    name: "Catasto (WMS)",
    type: "raster",
    source: {
      type: "raster",
      tiles: [proxiedWmsTileUrl(CADASTRE_WMS)],
      tileSize: 256,
      attribution: "Catasto © Agenzia delle Entrate",
    },
    visible: true,
    opacity: 0.75,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { agrogea: true, basemap: true },
    sourcePath: `agrogea://${CADASTRE_LAYER_ID}`,
  };
}

/** Rimuove dallo store tutti i basemap/overlay AgroGea attualmente montati. */
export function clearAgroBasemaps(): void {
  const store = useAppStore.getState();
  for (const id of AGRO_BASEMAP_IDS) {
    if (store.layers.some((l) => l.id === id)) store.removeLayer(id);
  }
}

/**
 * Prefissi degli id dei layer di stile APPLICATIVI: layer dello store GeoLibre
 * (`layer-<id>-*`), editor Geoman del GeoEditor (`gm_`/`gm-`), evidenziazione
 * della selezione e righello nativi (`geolibre-*`, `measure-*`). Tutto ciò che
 * non li matcha appartiene allo stile della basemap di base (stradario OSM).
 */
const APP_STYLE_LAYER_PREFIXES = [
  "layer-",
  "gm_",
  "gm-",
  "geolibre-",
  "measure-",
];

/** Id del layer di stile raster generato dal layer-sync per un basemap AgroGea. */
function basemapStyleLayerId(basemapId: string): string {
  return `layer-${basemapId}-raster`;
}

/**
 * Primo layer di stile applicativo presente sulla mappa: è la soglia sotto cui
 * devono restare i basemap. `exclude` toglie dal conteggio i basemap AgroGea già
 * montati, così il catasto si posiziona SOPRA il satellite e non sotto.
 */
function firstAppStyleLayerId(
  map: maplibregl.Map,
  exclude: readonly string[],
): string | null {
  for (const styleLayer of map.getStyle()?.layers ?? []) {
    if (exclude.includes(styleLayer.id)) continue;
    if (APP_STYLE_LAYER_PREFIXES.some((p) => styleLayer.id.startsWith(p))) {
      return styleLayer.id;
    }
  }
  return null;
}

/**
 * Inserisce un layer di sfondo nello store. Il satellite va in fondo (sopra lo
 * stradario, sotto tutto il resto); il catasto è un overlay e va sopra i basemap
 * ma sotto i vettori agronomici.
 *
 * Oltre alla posizione nello store si passa un'ANCORA DI STILE (`beforeId`): il
 * layer-sync ricava il `beforeId` MapLibre dai layer dello store successivi, ma
 * se nessuno di questi ha ancora un layer di stile — es. azienda senza
 * appezzamenti, mentre si disegna il primo — ripiega su `undefined` e MapLibre
 * appende il raster IN CIMA, coprendo i disegni di Geoman (la geometria in
 * costruzione sparisce sotto l'ortofoto). L'ancora è il primo layer di stile
 * applicativo e viene usata proprio in quel caso di ripiego.
 */
export function addBasemap(
  layer: GeoLibreLayer,
  {
    map,
    asOverlay = false,
  }: { map?: maplibregl.Map | null; asOverlay?: boolean } = {},
): void {
  const store = useAppStore.getState();
  if (store.layers.some((l) => l.id === layer.id)) return;
  const beforeId = asOverlay
    ? store.layers.find((l) => !AGRO_BASEMAP_IDS.includes(l.id))?.id ?? null
    : store.layers[0]?.id ?? null;
  const styleAnchor = map
    ? firstAppStyleLayerId(
        map,
        asOverlay ? AGRO_BASEMAP_IDS.map(basemapStyleLayerId) : [],
      )
    : null;
  store.addLayer({ ...layer, beforeId: styleAnchor ?? undefined }, beforeId);
}
