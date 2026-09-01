import {
  PARCEL_CANDIDATE_COLOR,
  parcelsToFeatureCollection,
  useAgroStore,
} from "@agrogea/core";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { getLayerBounds, type MapController } from "@geolibre/map";
import { type RefObject, useEffect } from "react";

/** Id del layer delle particelle candidate (fill/line nativi ne derivano). */
export const PARCEL_CANDIDATES_LAYER_ID = "agrogea-parcel-candidates";
const LAYER_SOURCE_PATH = "agrogea://parcel-candidates";

/**
 * Proietta sulla mappa le particelle proposte dall'ultima interrogazione.
 *
 * Sta SOPRA il layer degli appezzamenti, e non è un dettaglio estetico: mentre
 * si sceglie che cosa adottare, ciò che conta è la proposta, e il click deve
 * arrivare a lei anche dove si sovrappone a un campo già in portafoglio.
 *
 * Il layer si smonta appena le candidate spariscono, invece di restare vuoto:
 * un layer fantasma nel Gestore livelli è rumore, e a mappa sgombra l'utente
 * deve poter tornare a cliccare i propri appezzamenti senza ostacoli
 * invisibili.
 */
export function useParcelCandidatesLayer(
  mapControllerRef: RefObject<MapController | null>,
  // Cambia a ogni `style.load`: forza la re-iniezione dopo un cambio basemap,
  // che azzera lo stile MapLibre. Vedi useMapStyleEpoch.
  styleEpoch = 0,
): void {
  const candidates = useAgroStore((s) => s.parcelCandidates);
  const selectedParcelId = useAgroStore((s) => s.selectedParcelId);

  useEffect(() => {
    const store = useAppStore.getState();
    const existing = store.layers.find((l) => l.id === PARCEL_CANDIDATES_LAYER_ID);

    if (candidates.length === 0) {
      if (existing) store.removeLayer(PARCEL_CANDIDATES_LAYER_ID);
      return;
    }

    const geojson = parcelsToFeatureCollection(candidates, selectedParcelId);
    if (existing) {
      store.updateLayer(PARCEL_CANDIDATES_LAYER_ID, { geojson });
      return;
    }

    const layer: GeoLibreLayer = {
      id: PARCEL_CANDIDATES_LAYER_ID,
      name: "Particelle pubbliche",
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style: {
        ...DEFAULT_LAYER_STYLE,
        // La base va dichiarata comunque, anche se ogni feature porta i propri
        // colori: `simpleStyleEnabled` li sovrascrive per-feature, ma senza
        // valori di partenza il renderer compute opacità/spessore da null e il
        // layer resta invisibile (stesso motivo per cui usePlotsLayer li fissa).
        fillColor: PARCEL_CANDIDATE_COLOR,
        fillOpacity: 0.2,
        strokeColor: PARCEL_CANDIDATE_COLOR,
        strokeWidth: 1.5,
        simpleStyleEnabled: true,
      },
      metadata: { agrogea: true, parcelCandidates: true },
      geojson,
      sourcePath: LAYER_SOURCE_PATH,
    };
    store.addLayer(layer);

    // Alla prima comparsa si inquadra il risultato: dopo un'interrogazione
    // puntuale la particella trovata può cadere fuori dalla vista corrente, e
    // "nessun risultato" e "risultato altrove" si assomiglierebbero troppo.
    const bounds = getLayerBounds(layer);
    if (bounds) mapControllerRef.current?.fitBounds(bounds);
  }, [candidates, selectedParcelId, mapControllerRef, styleEpoch]);

  // Smontaggio: la mappa non deve conservare proposte di una sessione finita.
  useEffect(
    () => () => {
      const store = useAppStore.getState();
      if (store.layers.some((l) => l.id === PARCEL_CANDIDATES_LAYER_ID)) {
        store.removeLayer(PARCEL_CANDIDATES_LAYER_ID);
      }
    },
    [],
  );
}
