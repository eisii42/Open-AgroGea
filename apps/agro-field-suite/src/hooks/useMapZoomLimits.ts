import { useSettingsStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import { useEffect } from "react";
import { SATELLITE_LAYER_ID, SATELLITE_MAX_ZOOM } from "../lib/basemaps";

/**
 * UNICO proprietario dei limiti di zoom della mappa di campo. Compone due
 * vincoli che prima vivevano in punti diversi (e si sovrascrivevano a vicenda):
 *
 *   1. la PREFERENZA dell'utente (`useSettingsStore.mapZoomLimits`, default
 *      13–17): l'intervallo in cui il lavoro agronomico si svolge davvero,
 *      modificabile in Impostazioni del profilo;
 *   2. il TETTO TECNICO della basemap attiva: oltre {@link SATELLITE_MAX_ZOOM}
 *      Esri non ha copertura e l'ortofoto si "buca" (tile vuote), quindi
 *      finché il satellite è acceso il massimo effettivo è abbassato.
 *
 * Il tetto satellitare stava in `BasemapSwitcher` con un ref di ripristino:
 * funzionava finché nessun altro toccava `maxZoom`, ma con una preferenza
 * d'utente scrivibile i due effetti si sarebbero rincorsi (l'uno ripristinava
 * il valore che l'altro aveva appena abbassato). Qui il massimo effettivo è
 * DERIVATO a ogni render da entrambe le fonti: non c'è nessuno stato da
 * ripristinare, quindi non c'è nessuna corsa.
 *
 * Si scrive solo nello store GeoLibre (`preferences.map`), mai su MapLibre: è
 * il MapController a propagare min/max alla mappa.
 */
export function useMapZoomLimits(): void {
  const limits = useSettingsStore((s) => s.mapZoomLimits);
  const satelliteOn = useAppStore((s) =>
    s.layers.some((l) => l.id === SATELLITE_LAYER_ID),
  );

  useEffect(() => {
    const state = useAppStore.getState();
    const minZoom = limits.min;
    // Il tetto della basemap non può scendere sotto il minimo scelto: sarebbe
    // un intervallo vuoto e la vista resterebbe incastrata.
    const maxZoom = Math.max(
      minZoom,
      satelliteOn ? Math.min(limits.max, SATELLITE_MAX_ZOOM) : limits.max,
    );
    const current = state.preferences.map;
    if (current.minZoom === minZoom && current.maxZoom === maxZoom) return;
    state.setPreferences({
      ...state.preferences,
      map: { ...current, minZoom, maxZoom },
    });
  }, [limits, satelliteOn]);
}
