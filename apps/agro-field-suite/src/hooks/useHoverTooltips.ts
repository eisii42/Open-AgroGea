import { useAppStore } from "@geolibre/core";
import {
  circleLayerId,
  fillLayerId,
  lineLayerId,
  type MapController,
} from "@geolibre/map";
import type { GeoJSONFeature, MapGeoJSONFeature } from "maplibre-gl";
import { type RefObject, useEffect, useMemo, useState } from "react";

/**
 * Tooltip al passaggio del mouse sui layer vettoriali (Modulo UI §2).
 *
 * Si aggancia ai layer nativi resi da GeoLibre (fill/line/circle derivati dagli
 * id dei layer agro) tramite le API MapLibre esposte da `getMap()`. Nessun
 * popup riscritto: si leggono le `properties` della feature sotto il cursore e
 * si compute la posizione schermo. Il tooltip sparisce su mouse-leave, con un
 * micro-debounce per evitare lo sfarfallio tra feature contigue.
 *
 * I layer delle celle indice (module Suolo, uno per plot, id dinamico) sono
 * letti dallo store GeoLibre e agganciati/sganciati dinamicamente quando
 * l'insieme dei plots calcolati cambia. Stando SOPRA il layer plots, le loro
 * celle hanno priorità sul tooltip: l'handler "appezzamento" si annulla
 * quando sotto il cursore c'è anche una cella indice.
 */

export type HoverKind = "appezzamento" | "infrastruttura" | "poi" | "indexCell";

export interface HoverState {
  kind: HoverKind;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

const PLOTS_ID = "agrogea-plots";
const INFRASTRUTTURE_ID = "agrogea-infrastrutture";
const POI_ID = "agrogea-poi";

interface Binding {
  layerId: string;
  kind: HoverKind;
  /** Extra props da unire a quelle della feature (es. cellSizeM del layer celle). */
  extraProps?: Record<string, unknown>;
}

export function useHoverTooltips(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): HoverState | null {
  const [hover, setHover] = useState<HoverState | null>(null);
  const layers = useAppStore((s) => s.layers);

  // Id + cellSizeM dei layer celle indice attualmente visibili, come chiave
  // stringa: il memo successivo resta stabile finché l'insieme non cambia
  // davvero (non ad ogni modifica di stile/opacità/dominio dei layer, che non
  // tocca né gli id né cellSizeM). cellSizeM è impostato alla creazione del
  // layer e mai più cambiato, quindi la chiave non "traballa" durante la run.
  const cellBindingsKey = useMemo(
    () =>
      JSON.stringify(
        layers
          .filter((l) => l.visible && l.metadata?.indexCells === true)
          .map((l) => [
            l.id,
            typeof l.metadata?.cellSizeM === "number"
              ? l.metadata.cellSizeM
              : null,
          ]),
      ),
    [layers],
  );
  const cellBindings = useMemo(
    () => JSON.parse(cellBindingsKey) as [string, number | null][],
    [cellBindingsKey],
  );

  useEffect(() => {
    if (!mapReady) return;
    const map = mapControllerRef.current?.getMap();
    if (!map) return;

    const cellFillIds = cellBindings.map(([id]) => fillLayerId(id));

    // Layer nativi (anche se i dati arrivano dopo: MapLibre lega per id).
    const bindings: Binding[] = [
      { layerId: fillLayerId(PLOTS_ID), kind: "appezzamento" },
      { layerId: lineLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: fillLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: circleLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: circleLayerId(POI_ID), kind: "poi" },
      ...cellBindings.map(([id, cellSizeM]) => ({
        layerId: fillLayerId(id),
        kind: "indexCell" as const,
        extraProps: cellSizeM != null ? { cellSizeM } : undefined,
      })),
    ];

    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelClear = () => {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
    };

    const onMove = (kind: HoverKind, extraProps?: Record<string, unknown>) => (
      e: { point: { x: number; y: number }; features?: GeoJSONFeature[] },
    ) => {
      cancelClear();
      // Le celle indice stanno sopra il layer plots: se sotto il cursore c'è
      // anche una cella, la priorità va al SUO tooltip (value di dettaglio),
      // ignorando l'hover sul poligono dell'appezzamento sottostante.
      if (
        kind === "appezzamento" &&
        cellFillIds.length > 0 &&
        map.queryRenderedFeatures([e.point.x, e.point.y], {
          layers: cellFillIds.filter((id) => map.getLayer(id)),
        }).length > 0
      ) {
        return;
      }
      const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";
      setHover({
        kind,
        x: e.point.x,
        y: e.point.y,
        props: { ...feature.properties, ...extraProps },
      });
    };

    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      // Micro-debounce: se il mouse passa a una feature adiacente, il move
      // successivo annulla la chiusura evitando il flicker.
      cancelClear();
      clearTimer = setTimeout(() => setHover(null), 40);
    };

    const handlers = bindings.map((b) => {
      const move = onMove(b.kind, b.extraProps);
      map.on("mousemove", b.layerId, move);
      map.on("mouseleave", b.layerId, onLeave);
      return { ...b, move };
    });

    return () => {
      cancelClear();
      for (const h of handlers) {
        map.off("mousemove", h.layerId, h.move);
        map.off("mouseleave", h.layerId, onLeave);
      }
    };
  }, [mapControllerRef, mapReady, cellBindings]);

  return hover;
}
