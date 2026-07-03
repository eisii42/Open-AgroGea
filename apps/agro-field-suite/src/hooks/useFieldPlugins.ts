import {
  bindGeoEditorCapture,
  type SelectableKind,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { agroIndiciPlugin } from "@agrogea/tools";
import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import type { GeoLibreAppAPI, GeoLibrePlugin } from "@geolibre/plugins";
import {
  disableGeoEditorModes,
  enableGeoEditorDrawMode,
  endLayerGeometryEdit,
  maplibreComponentsPlugin,
  maplibreGeoEditorPlugin,
  maplibreLayerControlPlugin,
  osmBasemapPlugin,
  startLayerGeometryEdit,
} from "@geolibre/plugins";
import type { Geometry } from "geojson";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { createFieldAppApi } from "../lib/fieldAppApi";

/** Mappa l'intento di disegno agronomico alla modalità geometrica dell'engine. */
const DRAW_MODE_BY_INTENT = {
  polygon: "polygon",
  line: "line",
  point: "marker",
} as const;

/** Layer semantico GeoLibre per ciascun tipo selezionabile. */
const AGRO_LAYER_BY_KIND: Record<SelectableKind, string> = {
  appezzamento: "agrogea-appezzamenti",
  infrastruttura: "agrogea-infrastrutture",
  poi: "agrogea-poi",
};

/** Bounding box [minLon,minLat,maxLon,maxLat] dalle coordinate GeoJSON. */
function geometryBounds(
  geometry: Geometry,
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      minX = Math.min(minX, c[0]);
      minY = Math.min(minY, c[1]);
      maxX = Math.max(maxX, c[0]);
      maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) {
      for (const x of c) visit(x);
    }
  };
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) visit((g as { coordinates?: unknown }).coordinates);
  } else {
    visit(geometry.coordinates);
  }
  return [minX, minY, maxX, maxY].every(Number.isFinite)
    ? [minX, minY, maxX, maxY]
    : null;
}

/**
 * Geometria della feature `id` nel layer dello store, o null. Usata per
 * inquadrare la feature all'avvio dell'editing e per rileggere la geometria
 * modificata dal layer dopo il salvataggio atomico nativo.
 */
function featureGeometryInLayer(
  layerId: string,
  id: string,
): Geometry | null {
  const layer = useAppStore.getState().layers.find((l) => l.id === layerId);
  const feature = layer?.geojson?.features.find(
    (f) => String(f.properties?.id ?? f.id ?? "") === id,
  );
  return feature?.geometry ?? null;
}

/**
 * Versione "di campo" dell'usePlugins del desktop GeoLibre: stessa
 * GeoLibreAppAPI (così i plugin nativi girano invariati), con due insiemi:
 *
 *   * base — sempre attivi (basemap OSM, Layer Manager NATIVO, components host
 *     per il measure, indici AgroGea);
 *   * on-demand — il geo-editor segue il pannello "Disegna".
 *
 * Il Layer Manager e i controlli Terrain/Measure sono quelli nativi di
 * GeoLibre: qui li attiviamo, non li riscriviamo.
 */

const BASE_PLUGINS: GeoLibrePlugin[] = [
  osmBasemapPlugin,
  maplibreLayerControlPlugin, // Layer Manager nativo (built-in "layer-control")
  maplibreComponentsPlugin, // host del Measure Control nativo
  agroIndiciPlugin,
];

function activateSafely(plugin: GeoLibrePlugin, app: GeoLibreAppAPI): boolean {
  try {
    return plugin.activate(app) !== false;
  } catch (error) {
    console.error(`Attivazione plugin ${plugin.id} fallita.`, error);
    return false;
  }
}

function deactivateSafely(plugin: GeoLibrePlugin, app: GeoLibreAppAPI): void {
  try {
    plugin.deactivate(app);
  } catch (error) {
    console.error(`Disattivazione plugin ${plugin.id} fallita.`, error);
  }
}

export function useFieldPlugins(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): void {
  const openPanels = useAgroStore((s) => s.openPanels);
  const geoEditorOpen = openPanels.includes("geoeditor");
  const drawIntent = useAgroStore((s) => s.drawIntent);
  const pendingGeometry = useAgroStore((s) => s.pendingGeometry);
  const setDrawIntent = useAgroStore((s) => s.setDrawIntent);
  const geomEdit = useAgroStore((s) => s.geomEdit);
  const geomEditRequest = useAgroStore((s) => s.geomEditRequest);
  const loadedEditId = useRef<string | null>(null);
  // Evita esecuzioni concorrenti del save/cancel (StrictMode, doppio click).
  const processingRequestRef = useRef(false);

  // L'API è stabile per tutta la vita della mappa: i metodi delegano al ref.
  const app = useMemo(
    () => createFieldAppApi(mapControllerRef),
    [mapControllerRef],
  );

  useEffect(() => {
    if (!mapReady) return;
    const active = BASE_PLUGINS.filter((plugin) =>
      activateSafely(plugin, app),
    );
    return () => {
      for (const plugin of [...active].reverse()) {
        deactivateSafely(plugin, app);
      }
    };
  }, [app, mapReady]);

  // Visibilità dei controlli built-in nativi pilotata dai flag del layout
  // dell'utente (Modulo Profilo §2): terrain/scala/geolocate/gestore-livelli si
  // mostrano o nascondono in modo reattivo al cambio delle preferenze.
  const mapTerrain = useSettingsStore((s) => s.dashboardLayout.mapTerrain);
  const mapScale = useSettingsStore((s) => s.dashboardLayout.mapScale);
  const mapGeolocate = useSettingsStore((s) => s.dashboardLayout.mapGeolocate);
  const mapLayerControl = useSettingsStore(
    (s) => s.dashboardLayout.mapLayerControl,
  );
  useEffect(() => {
    if (!mapReady) return;
    const controller = mapControllerRef.current;
    if (!controller) return;
    controller.setBuiltInControlVisible("terrain", mapTerrain);
    controller.setBuiltInControlVisible("scale", mapScale);
    controller.setBuiltInControlVisible("geolocate", mapGeolocate);
    controller.setBuiltInControlVisible("layer-control", mapLayerControl);
  }, [
    mapReady,
    mapControllerRef,
    mapTerrain,
    mapScale,
    mapGeolocate,
    mapLayerControl,
  ]);

  // Esri Wayback NATIVO (Modulo Profilo §2): il flag rende DISPONIBILE lo
  // strumento, ma il controllo nativo (e il relativo layer storico) è montato
  // on-demand al click sul tool — vedi MapControls. Così abilitarlo dalle
  // impostazioni non apre più la scheda sopra a tutto all'avvio.

  // GeoEditor: vive solo finché il pannello "Disegna" è aperto. La cattura
  // delle geometrie disegnate (→ scheda dati → DAL) è legata alla sessione.
  useEffect(() => {
    if (!mapReady || !geoEditorOpen) return;
    if (!activateSafely(maplibreGeoEditorPlugin, app)) return;
    // La toolbar nativa del GeoEditor di default è in alto a sinistra, dove la
    // ModuleSidebar e i controlli fluttuanti la coprono: la spostiamo in basso
    // a sinistra così resta visibile (e usabile come fallback per l'editing).
    maplibreGeoEditorPlugin.setMapControlPosition?.(app, "bottom-left");
    const unbindCapture = bindGeoEditorCapture();
    return () => {
      unbindCapture();
      deactivateSafely(maplibreGeoEditorPlugin, app);
    };
  }, [app, geoEditorOpen, mapReady]);

  // Menu rapido di disegno (Modulo 1 §workflow): quando l'utente sceglie cosa
  // tracciare, attiva la modalità geometrica corrispondente nell'engine non
  // appena il GeoEditor è pronto (la funzione attende l'init asincrono di Geoman).
  useEffect(() => {
    if (!mapReady || !geoEditorOpen || !drawIntent) return;
    let cancelled = false;
    void enableGeoEditorDrawMode(DRAW_MODE_BY_INTENT[drawIntent]).then((ok) => {
      // Se l'intento è cambiato mentre attendevamo Geoman, annulla la modalità.
      if (cancelled && ok) disableGeoEditorModes();
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, geoEditorOpen, drawIntent]);

  // A geometria catturata, esci dalla modalità di disegno e azzera l'intento:
  // un elemento alla volta passa dalla scheda dati prima del successivo.
  useEffect(() => {
    if (pendingGeometry && drawIntent) {
      disableGeoEditorModes();
      setDrawIntent(null);
    }
  }, [pendingGeometry, drawIntent, setDrawIntent]);

  // Chiusura della suite di disegno → azzera l'intento (il menu torna inattivo).
  useEffect(() => {
    if (!geoEditorOpen) setDrawIntent(null);
  }, [geoEditorOpen, setDrawIntent]);

  // Editing spaziale (Modulo 4) col motore NATIVO di GeoLibre: all'avvio di una
  // sessione si edita IN-PLACE il layer semantico (startLayerGeometryEdit), che
  // nasconde da sé il rendering statico, mostra la copia editabile di Geoman e a
  // fine sessione riscrive le feature in modo ATOMICO. Niente più sketches-bridge
  // né geometria "live" nello store. Caricamento una volta per sessione (guard id).
  useEffect(() => {
    if (!mapReady || !geoEditorOpen || !geomEdit) {
      loadedEditId.current = null;
      return;
    }
    if (loadedEditId.current === geomEdit.id) return;
    loadedEditId.current = geomEdit.id;

    const layerId = AGRO_LAYER_BY_KIND[geomEdit.kind];
    // Inquadra la feature così i suoi vertici sono in vista (utile quando la
    // sessione parte dal registro, non da un tap già centrato).
    const geometry = featureGeometryInLayer(layerId, geomEdit.id);
    if (geometry) {
      const bounds = geometryBounds(geometry);
      if (bounds) mapControllerRef.current?.fitBounds(bounds);
    }
    void startLayerGeometryEdit(app, layerId);
  }, [mapReady, geoEditorOpen, geomEdit, mapControllerRef, app]);

  // Salvataggio / annullamento della sessione (richiesti dalla scheda dettaglio).
  // Il salvataggio chiude l'editing nativo (riscrittura atomica nel layer) e
  // rilegge la geometria editata per persisterla sul DAL (con undo DAL-aware).
  useEffect(() => {
    if (!geomEditRequest || !geomEdit) return;
    if (processingRequestRef.current) return;
    processingRequestRef.current = true;
    const { kind, id } = geomEdit;
    const request = geomEditRequest;
    void (async () => {
      try {
        if (request === "save") {
          await endLayerGeometryEdit(app, { save: true });
          const geometry = featureGeometryInLayer(AGRO_LAYER_BY_KIND[kind], id);
          if (geometry) {
            await useAgroStore.getState().applyEditedGeometry(geometry);
          } else {
            useAgroStore.getState().finishGeometryEdit();
          }
        } else {
          await endLayerGeometryEdit(app, { save: false });
          useAgroStore.getState().finishGeometryEdit();
        }
      } finally {
        processingRequestRef.current = false;
      }
    })();
  }, [geomEditRequest, geomEdit, app]);
}
