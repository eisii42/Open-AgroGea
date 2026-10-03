import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import type { GeoLibreAppAPI } from "@geolibre/plugins";
import type { IControl } from "maplibre-gl";
import type { RefObject } from "react";

/** Contenitore a griglia di controlli (la `ControlGrid` di maplibre-gl-components). */
interface ControlHost extends IControl {
  getControls(): IControl[];
  removeControl(control: IControl): void;
}

function isControlHost(control: IControl): control is ControlHost {
  const host = control as Partial<ControlHost>;
  return (
    typeof host.getControls === "function" &&
    typeof host.removeControl === "function"
  );
}

/** Il controllo "Spin globe": l'unico con start/stop della rotazione. */
function isSpinGlobeControl(control: IControl): boolean {
  const c = control as { startSpin?: unknown; stopSpin?: unknown };
  return typeof c.startSpin === "function" && typeof c.stopSpin === "function";
}

/**
 * Toglie lo "Spin globe" dalla griglia dei components PRIMA che venga montato.
 *
 * Quel controllo avvia la rotazione del globo a OGNI doppio click sulla mappa
 * (scelta upstream: `_startSpinAfterDoubleClick`). La rotazione è un `jumpTo`
 * a ogni frame che sposta la longitudine verso ovest: interrompe lo zoom del
 * doppio click e trascina la vista fuori dall'azienda, senza fermarsi finché
 * non si tocca di nuovo la mappa. Nella mappa di campo (Mercatore fisso, niente
 * globo) non serve a nulla, quindi non lo si monta affatto: così non registra
 * nemmeno il listener `dblclick`.
 */
function withoutSpinGlobe(control: IControl): IControl {
  if (!isControlHost(control)) return control;
  for (const child of control.getControls()) {
    if (isSpinGlobeControl(child)) control.removeControl(child);
  }
  return control;
}

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
      mapControllerRef.current?.addControl(withoutSpinGlobe(control), position) ??
      false,
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
