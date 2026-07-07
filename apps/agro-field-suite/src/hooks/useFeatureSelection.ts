import { type SelectableKind, useAgroStore } from "@agrogea/core";
import {
  circleLayerId,
  fillLayerId,
  lineLayerId,
  type MapController,
} from "@geolibre/map";
import type maplibregl from "maplibre-gl";
import { type RefObject, useEffect } from "react";

/**
 * Click su un elemento esistente sui layer vettoriali agro. Il comportamento
 * dipende dal tipo:
 *   * appezzamento → apre il Quaderno di Campagna filtrato sulle SUE lavorazioni
 *     (l'editing geometria/metadati e l'eliminazione restano nel "Modifica /
 *     Elimina" → Registro geometrie);
 *   * infrastruttura / POI → apre la scheda di dettaglio/editing.
 *
 * Si usa UN listener globale `click` + `queryRenderedFeatures` filtrato sui
 * layer agro esistenti, anziché i listener per-layer di MapLibre: questi ultimi
 * sono fragili con gli id stringa (UUID) e con i layer creati dopo il bind, ed
 * erano la causa per cui il tap su un appezzamento non apriva nulla.
 *
 * Il click è inibito mentre si disegna o si modifica una geometria (in quei
 * casi serve all'engine per posare/spostare vertici).
 */

const APPEZZAMENTI_ID = "agrogea-plots";
const INFRASTRUTTURE_ID = "agrogea-infrastrutture";
const POI_ID = "agrogea-poi";
const SCOUTING_ID = "agrogea-scouting";

interface LayerKind {
  id: string;
  kind: SelectableKind;
}

// Ordine di priorità a parità di hit: prima i punti/linee (più piccoli e
// specifici), poi i poligoni di appezzamento (sfondo).
const LAYER_KINDS: LayerKind[] = [
  { id: circleLayerId(POI_ID), kind: "poi" },
  { id: circleLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
  { id: lineLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
  { id: fillLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
  { id: fillLayerId(APPEZZAMENTI_ID), kind: "appezzamento" },
];

function featureRecordId(
  feature: maplibregl.MapGeoJSONFeature,
): string | null {
  // Le source GeoJSON non promuovono gli id stringa a `feature.id`: la fonte
  // affidabile dell'id record è `properties.id` (vedi *ToFeatureCollection).
  const propId = feature.properties?.id;
  if (propId != null && propId !== "") return String(propId);
  if (feature.id != null) return String(feature.id);
  return null;
}

// Layer scouting (cerchio): gestito a parte perché non è un SelectableKind, apre
// la scheda della nota nel pannello Scouting invece della scheda dettaglio.
const SCOUTING_LAYER = circleLayerId(SCOUTING_ID);

export function useFeatureSelection(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): void {
  const selectFeatureOnMap = useAgroStore((s) => s.selectFeatureOnMap);
  const openLogbookForPlot = useAgroStore(
    (s) => s.openLogbookForPlot,
  );
  const openScoutingForObservation = useAgroStore(
    (s) => s.openScoutingForObservation,
  );

  useEffect(() => {
    if (!mapReady) return;
    const map = mapControllerRef.current?.getMap();
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const s = useAgroStore.getState();
      // Durante disegno/editing geometrico il click appartiene all'engine.
      if (s.drawIntent || s.geomEdit || s.pendingGeometry) return;
      // Durante il posizionamento di una nota scouting il click serve a posarla:
      // non deve aprire Quaderno/dettaglio dell'appezzamento sottostante.
      if (s.scoutingPlacing) return;

      const present = LAYER_KINDS.filter((l) => map.getLayer(l.id));
      const scoutingPresent = map.getLayer(SCOUTING_LAYER);
      if (present.length === 0 && !scoutingPresent) return;

      // I punti scouting (piccoli, specifici) hanno priorità di hit sui poligoni.
      const queryLayers = [
        ...(scoutingPresent ? [SCOUTING_LAYER] : []),
        ...present.map((l) => l.id),
      ];
      const hits = map.queryRenderedFeatures(e.point, { layers: queryLayers });
      if (hits.length === 0) return;

      // `queryRenderedFeatures` restituisce i match dall'alto verso il basso
      // nell'ordine dei layer renderizzati; il primo è quello "sopra".
      const top = hits[0];

      const id = featureRecordId(top);
      if (!id) return;

      // Punto scouting → scheda della nota nel pannello Scouting.
      if (top.layer.id === SCOUTING_LAYER) {
        openScoutingForObservation(id);
        return;
      }

      const layerKind = LAYER_KINDS.find((l) => l.id === top.layer.id);
      if (!layerKind) return;
      // Plot → Quaderno filtrato sulle sue lavorazioni; altri → dettaglio.
      if (layerKind.kind === "appezzamento") {
        openLogbookForPlot(id);
      } else {
        void selectFeatureOnMap({ kind: layerKind.kind, id });
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [
    mapControllerRef,
    mapReady,
    selectFeatureOnMap,
    openLogbookForPlot,
    openScoutingForObservation,
  ]);
}
