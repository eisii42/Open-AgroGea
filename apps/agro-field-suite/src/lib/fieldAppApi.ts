import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import type { GeoLibreAppAPI } from "@geolibre/plugins";
import type { RefObject } from "react";

/**
 * Costruisce la `GeoLibreAppAPI` di field: la stessa interfaccia usata dal
 * desktop GeoLibre, così i plugin nativi (layer-control, components/measure,
 * geo-editor) girano invariati. I metodi delegano al `MapController` current
 * via ref, quindi l'istanza dell'API resta stabile per tutta la vita della
 * mappa (nessun re-render distruttivo al cambio dei pannelli).
 *
 * Condivisa tra `useFieldPlugins` (attivazione plugin) e i controlli mappa
 * (terrain/measure), che la ricostruiscono sullo stesso ref senza stato proprio.
 */
export function createFieldAppApi(
  mapControllerRef: RefObject<MapController | null>,
): GeoLibreAppAPI {
  const store = useAppStore.getState();
  return {
    setBasemap: (url) => store.setBasemapStyleUrl(url),
    addGeoJsonLayer: (name, data, sourcePath) => {
      store.addGeoJsonLayer(name, data, sourcePath);
    },
    getActiveBasemap: () => useAppStore.getState().basemapStyleUrl,
    onBasemapChange: (callback) =>
      useAppStore.subscribe((state, prev) => {
        if (state.basemapStyleUrl !== prev.basemapStyleUrl) {
          callback(state.basemapStyleUrl);
        }
      }),
    fitBounds: (bounds) => mapControllerRef.current?.fitBounds(bounds),
    getMap: () => mapControllerRef.current?.getMap() ?? null,
    addMapControl: (control, position) =>
      mapControllerRef.current?.addControl(control, position) ?? false,
    removeMapControl: (control) =>
      mapControllerRef.current?.removeControl(control),
    setBuiltInMapControlVisible: (control, visible) =>
      mapControllerRef.current?.setBuiltInControlVisible(control, visible) ??
      false,
    getBuiltInMapControlPosition: (control) =>
      mapControllerRef.current?.getBuiltInControlPosition(control) ??
      "top-right",
    setBuiltInMapControlPosition: (control, position) =>
      mapControllerRef.current?.setBuiltInControlPosition(control, position) ??
      false,
  };
}
