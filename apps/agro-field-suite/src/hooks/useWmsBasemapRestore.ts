import { useAgroStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect } from "react";
import {
  getWmsBasemapState,
  markWmsBasemapInactive,
  restoreWmsBasemaps,
} from "../modules/add-data/wms-basemap-store";
import { wmsBasemapLayerId } from "../modules/add-data/wms-basemaps";

/**
 * Riporta sulla mappa lo sfondo WMS salvato dell'azienda attiva: all'apertura
 * dell'app e a ogni cambio di azienda. Tiene inoltre allineato lo stato salvato
 * quando l'utente toglie lo sfondo dal Gestore livelli.
 */
export function useWmsBasemapRestore(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): void {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);

  useEffect(() => {
    if (!mapReady) return;
    restoreWmsBasemaps(activeCompanyId, {
      map: mapControllerRef.current?.getMap(),
    });
  }, [activeCompanyId, mapReady, mapControllerRef]);

  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        const { activeId } = getWmsBasemapState();
        if (!activeId) return;
        const layerId = wmsBasemapLayerId(activeId);
        const removed =
          prev.layers.some((l) => l.id === layerId) &&
          !s.layers.some((l) => l.id === layerId);
        if (!removed) return;
        // Si decide a fine turno: cambiare sfondo o modificare quello attivo
        // toglie e rimette il layer nella stessa chiamata, e non è una rimozione.
        queueMicrotask(() => {
          const stillActive = getWmsBasemapState().activeId === activeId;
          const present = useAppStore
            .getState()
            .layers.some((l) => l.id === layerId);
          if (stillActive && !present) markWmsBasemapInactive();
        });
      }),
    [],
  );
}
