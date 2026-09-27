import { useSettingsStore } from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import {
  closeMeasurePanel,
  isMeasurePanelVisible,
  maplibreEsriWaybackPlugin,
  openMeasurePanel,
  subscribeMeasurePanel,
} from "@geolibre/plugins";
import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";
import { createFieldAppApi } from "../lib/fieldAppApi";

export interface MapTools {
  showMeasure: boolean;
  measureOn: boolean;
  toggleMeasure: () => void;
  showWayback: boolean;
  waybackOn: boolean;
  toggleWayback: () => void;
}

/**
 * Strumenti di mappa NATIVI di GeoLibre pilotati dalla colonna AgroGea: il
 * righello (pannello Misura) e l'imagery storica Esri Wayback. Condiviso dalla
 * colonna desktop (`MapControls`) e da quella mobile (`MobileMapTools`): va
 * montato in UN solo punto alla volta, perché lo stato di Wayback è locale.
 */
export function useMapTools(
  mapControllerRef: RefObject<MapController | null>,
): MapTools {
  const measureOn = useSyncExternalStore(
    subscribeMeasurePanel,
    isMeasurePanelVisible,
    isMeasurePanelVisible,
  );
  const showMeasure = useSettingsStore((s) => s.dashboardLayout.mapMeasure);
  // Esri Wayback: il flag rende available il TOOL; la scheda storica e il suo
  // layer compaiono solo al click sul tool (e spariscono al click di chiusura).
  const showWayback = useSettingsStore(
    (s) => s.dashboardLayout.mapBasemapWayback,
  );
  const [waybackOn, setWaybackOn] = useState(false);

  const toggleMeasure = () => {
    const app = createFieldAppApi(mapControllerRef);
    if (isMeasurePanelVisible()) closeMeasurePanel(app);
    else openMeasurePanel(app);
  };

  const toggleWayback = () => {
    const app = createFieldAppApi(mapControllerRef);
    if (waybackOn) {
      try {
        maplibreEsriWaybackPlugin.deactivate(app);
      } catch (e) {
        console.error("Disattivazione Esri Wayback fallita.", e);
      }
      setWaybackOn(false);
      return;
    }
    try {
      if (maplibreEsriWaybackPlugin.activate(app) === false) return;
      // Bottom-right: posizione stabile della scheda Wayback (il top-left dava
      // bug di layout). Il toggle nativo è nascosto via CSS: comanda solo questo
      // bottone.
      maplibreEsriWaybackPlugin.setMapControlPosition?.(app, "bottom-right");
      setWaybackOn(true);
    } catch (e) {
      console.error("Attivazione Esri Wayback fallita.", e);
    }
  };

  // Se il flag viene spento mentre Wayback è active, smonta scheda + layer.
  useEffect(() => {
    if (showWayback || !waybackOn) return;
    try {
      maplibreEsriWaybackPlugin.deactivate(createFieldAppApi(mapControllerRef));
    } catch (e) {
      console.error("Disattivazione Esri Wayback fallita.", e);
    }
    setWaybackOn(false);
  }, [showWayback, waybackOn, mapControllerRef]);

  return {
    showMeasure,
    measureOn,
    toggleMeasure,
    showWayback,
    waybackOn,
    toggleWayback,
  };
}
