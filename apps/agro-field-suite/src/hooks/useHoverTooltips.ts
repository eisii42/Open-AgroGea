import {
  circleLayerId,
  fillLayerId,
  lineLayerId,
  type MapController,
} from "@geolibre/map";
import type { GeoJSONFeature, MapGeoJSONFeature } from "maplibre-gl";
import { type RefObject, useEffect, useState } from "react";

/**
 * Tooltip al passaggio del mouse sui layer vettoriali (Modulo UI §2).
 *
 * Si aggancia ai layer nativi resi da GeoLibre (fill/line/circle derivati dagli
 * id dei layer agro) tramite le API MapLibre esposte da `getMap()`. Nessun
 * popup riscritto: si leggono le `properties` della feature sotto il cursore e
 * si compute la posizione schermo. Il tooltip sparisce su mouse-leave, con un
 * micro-debounce per evitare lo sfarfallio tra feature contigue.
 */

export type HoverKind = "appezzamento" | "infrastruttura" | "poi";

export interface HoverState {
  kind: HoverKind;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

const APPEZZAMENTI_ID = "agrogea-plots";
const INFRASTRUTTURE_ID = "agrogea-infrastrutture";
const POI_ID = "agrogea-poi";

interface Binding {
  layerId: string;
  kind: HoverKind;
}

export function useHoverTooltips(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): HoverState | null {
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapControllerRef.current?.getMap();
    if (!map) return;

    // Layer nativi (anche se i dati arrivano dopo: MapLibre lega per id).
    const bindings: Binding[] = [
      { layerId: fillLayerId(APPEZZAMENTI_ID), kind: "appezzamento" },
      { layerId: lineLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: fillLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: circleLayerId(INFRASTRUTTURE_ID), kind: "infrastruttura" },
      { layerId: circleLayerId(POI_ID), kind: "poi" },
    ];

    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelClear = () => {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
    };

    const onMove = (kind: HoverKind) => (
      e: { point: { x: number; y: number }; features?: GeoJSONFeature[] },
    ) => {
      cancelClear();
      const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";
      setHover({
        kind,
        x: e.point.x,
        y: e.point.y,
        props: feature.properties ?? {},
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
      const move = onMove(b.kind);
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
  }, [mapControllerRef, mapReady]);

  return hover;
}
