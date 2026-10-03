import { useSettingsStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect } from "react";
import {
  CADASTRE_LAYER_ID,
  SATELLITE_LAYER_ID,
  addBasemap,
  cadastreLayer,
  isWmsBasemapLayer,
  satelliteLayer,
} from "../lib/basemaps";
import {
  selectWmsBasemap,
  useSavedWmsBasemaps,
} from "../modules/add-data/wms-basemap-store";
import type { SavedWmsBasemap } from "../modules/add-data/wms-basemaps";

export type BaseChoice = "stradario" | "satellite";

export interface BasemapControls {
  /** Basemap di base disponibili (lo stradario c'è sempre). */
  baseOptions: { id: BaseChoice; labelKey: string }[];
  /** Base attiva, o null se lo sfondo è un WMS salvato. */
  current: BaseChoice | null;
  savedWms: SavedWmsBasemap[];
  activeWmsId: string | null;
  satelliteOn: boolean;
  cadastreOn: boolean;
  showCadastre: boolean;
  selectBase: (choice: BaseChoice) => void;
  selectWms: (id: string) => void;
  toggleCadastre: () => void;
}

/**
 * Stato e comandi dello sfondo della mappa: basemap mutuamente esclusivi
 * (stradario · satellite · WMS salvati) e overlay catastale. Condiviso dal
 * popover Livelli del desktop (`DesktopMapTools`) e dal foglio Livelli del telefono
 * (`MapLayersSheet`): stessa logica, due vesti.
 *
 * La disponibilità di satellite / catasto è governata dai flag del layout
 * dell'utente: se un flag è spento l'opzione sparisce e l'eventuale layer
 * attivo viene rimosso. Va montato in UN punto per vista (l'effetto di pulizia
 * vive qui).
 */
export function useBasemapControls(
  mapControllerRef: RefObject<MapController | null>,
): BasemapControls {
  const layers = useAppStore((s) => s.layers);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const flags = useSettingsStore((s) => s.dashboardLayout);
  const saved = useSavedWmsBasemaps();

  const satelliteOn = layers.some((l) => l.id === SATELLITE_LAYER_ID);
  const cadastreOn = layers.some((l) => l.id === CADASTRE_LAYER_ID);
  const activeWmsId = layers.some(isWmsBasemapLayer) ? saved.activeId : null;
  const current: BaseChoice | null = activeWmsId
    ? null
    : satelliteOn
      ? "satellite"
      : "stradario";

  // Il tetto di zoom dell'ortofoto (oltre SATELLITE_MAX_ZOOM Esri non ha
  // copertura e la vista si "buca") NON si applica da qui: è composto con la
  // preferenza di zoom dell'utente in `useMapZoomLimits`, unico punto che
  // scrive `preferences.map`.

  // Se un flag viene disattivato mentre il relativo layer è active, lo si toglie
  // (la UI non avrebbe più il controllo per rimuoverlo).
  useEffect(() => {
    if (!flags.mapBasemapSatellite && satelliteOn) removeLayer(SATELLITE_LAYER_ID);
    if (!flags.mapBasemapCadastre && cadastreOn) removeLayer(CADASTRE_LAYER_ID);
  }, [flags, satelliteOn, cadastreOn, removeLayer]);

  const selectBase = (choice: BaseChoice) => {
    // Basemap mutuamente esclusivi: rimuovi gli altri raster di sfondo (anche
    // un WMS salvato, che resta in elenco ma smette di essere lo sfondo).
    selectWmsBasemap(null);
    if (satelliteOn) removeLayer(SATELLITE_LAYER_ID);
    if (choice === "satellite") {
      addBasemap(satelliteLayer(), { map: mapControllerRef.current?.getMap() });
    }
  };

  // Un WMS salvato prende il posto del satellite come sfondo.
  const selectWms = (id: string) =>
    selectWmsBasemap(id, { map: mapControllerRef.current?.getMap() });

  const toggleCadastre = () => {
    if (cadastreOn) removeLayer(CADASTRE_LAYER_ID);
    else {
      addBasemap(cadastreLayer(), {
        map: mapControllerRef.current?.getMap(),
        asOverlay: true,
      });
    }
  };

  const baseOptions: BasemapControls["baseOptions"] = [
    { id: "stradario", labelKey: "basemapSwitcher.streetMap" },
    ...(flags.mapBasemapSatellite
      ? [{ id: "satellite" as const, labelKey: "basemapSwitcher.satellite" }]
      : []),
  ];

  return {
    baseOptions,
    current,
    savedWms: saved.items,
    activeWmsId,
    satelliteOn,
    cadastreOn,
    showCadastre: flags.mapBasemapCadastre,
    selectBase,
    selectWms,
    toggleCadastre,
  };
}
