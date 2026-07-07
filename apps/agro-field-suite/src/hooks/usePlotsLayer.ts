import {
  plotsToFeatureCollection,
  NO_CROP_COLOR,
  useAgroStore,
} from "@agrogea/core";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { getLayerBounds, type MapController } from "@geolibre/map";
import { type RefObject, useEffect, useRef } from "react";

const LAYER_ID = "agrogea-plots";
const LAYER_SOURCE_PATH = "agrogea://plots";

/**
 * Proietta gli plots dell'azienda attiva (dominio agronomico, PGlite)
 * nello store layer di GeoLibre: MapController.syncLayers fa il resto.
 * Flusso unidirezionale rispettato — qui non si tocca mai MapLibre.
 */
export function useAppezzamentiLayer(
  mapControllerRef: RefObject<MapController | null>,
  // Cambiando ad ogni `style.load`, forza la re-iniezione del layer dopo un
  // cambio basemap (lo stile MapLibre riparte da zero). Vedi useMapStyleEpoch.
  styleEpoch = 0,
): void {
  const plots = useAgroStore((s) => s.plots);
  // CropType associata (Campagna attiva) e catalogo crops: alimentano la
  // property `crop` del tooltip hover. Cambiano con annata/registro campagna.
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const crops = useAgroStore((s) => s.crops);
  const fittedOnce = useRef(false);

  useEffect(() => {
    const store = useAppStore.getState();
    const geojson = plotsToFeatureCollection(
      plots,
      campaignFields,
      crops,
    );
    const existing = store.layers.find((l) => l.id === LAYER_ID);

    let layer: GeoLibreLayer;
    if (existing) {
      // Solo i dati: visibilità/opacità sono gestite dal Layer Manager nativo.
      store.updateLayer(LAYER_ID, { geojson });
      layer = { ...existing, geojson };
    } else {
      layer = {
        id: LAYER_ID,
        name: "Appezzamenti",
        type: "geojson",
        source: { type: "geojson" },
        visible: true,
        opacity: 1,
        style: {
          ...DEFAULT_LAYER_STYLE,
          // Base neutra (grigio): vale per gli plots senza coltura. Le
          // feature con coltura portano `fill`/`stroke` per-feature (colore ad
          // hoc della specie), onorati grazie a `simpleStyleEnabled`.
          fillColor: NO_CROP_COLOR,
          fillOpacity: 0.3,
          strokeColor: NO_CROP_COLOR,
          strokeWidth: 1.5,
          simpleStyleEnabled: true,
        },
        metadata: { agrogea: true },
        geojson,
        sourcePath: LAYER_SOURCE_PATH,
      };
      store.addLayer(layer);
    }

    // Primo caricamento con dati: inquadra l'azienda (fitBounds del Design.md).
    if (!fittedOnce.current && plots.length > 0) {
      fittedOnce.current = true;
      const bounds = getLayerBounds(layer);
      if (bounds) mapControllerRef.current?.fitBounds(bounds);
    }
  }, [plots, campaignFields, crops, mapControllerRef, styleEpoch]);
}
