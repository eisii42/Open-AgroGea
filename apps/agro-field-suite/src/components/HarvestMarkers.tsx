/**
 * Simboli delle harvests sulla mappa (toggle "Mostra sulla mappa" del pannello
 * Harvest). Speculare a {@link ./OperationMarkers}: crea marker HTML (icona
 * spiga) SOLO quando il toggle è active (`mapHarvestIds !== null`) e li rimuove
 * allo spegnimento. Le harvests NON sono più un layer persistente: così non
 * lasciano un punto permanente in mappa né una voce nella legenda dei layer.
 *
 * Le harvests con geometria propria (Point) sono posate lì; quelle che
 * ereditano il centroid dell'appezzamento vengono disposte ad anello (offset in
 * pixel, stabile a ogni zoom) per non sovrapporsi quando più raccolte insistono
 * sullo stesso field.
 */
import {
  centroid,
  type Harvest,
  useAgroStore,
} from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import { Wheat } from "lucide-react";
import maplibregl from "maplibre-gl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HARVEST_COLOR = "#d97706";

interface Placement {
  harvest: Harvest;
  lngLat: [number, number];
  offset: [number, number];
}

interface Slot {
  el: HTMLDivElement;
  harvest: Harvest;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  /** Offset base (px) dell'anello a zoom di riferimento, prima dello scaling. */
  base: [number, number];
}

// Stesse costanti/logica di scaling geografico di OperationMarkers: le icone
// mantengono una dimensione proporzionata all'appezzamento invece che ai pixel.
const REF_ZOOM = 16;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.4;

function scaleForZoom(zoom: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, 2 ** (zoom - REF_ZOOM)));
}

export function HarvestMarkers({
  mapControllerRef,
  mapReady,
}: {
  mapControllerRef: RefObject<MapController | null>;
  mapReady: boolean;
}) {
  const ids = useAgroStore((s) => s.mapHarvestIds);
  const harvests = useAgroStore((s) => s.harvests);
  const plots = useAgroStore((s) => s.plots);

  const placements = useMemo<Placement[]>(() => {
    if (!ids) return [];
    const idSet = new Set(ids);
    const centroids = new Map<string, [number, number]>();
    for (const a of plots) {
      centroids.set(a.id, centroid(a.geometry) as [number, number]);
    }
    const own: Placement[] = [];
    const byPlot = new Map<string, Harvest[]>();
    for (const r of harvests) {
      if (r.deleted_at != null || !idSet.has(r.id)) continue;
      if (r.geometry && r.geometry.type === "Point") {
        own.push({
          harvest: r,
          lngLat: r.geometry.coordinates as [number, number],
          offset: [0, 0],
        });
        continue;
      }
      if (!r.plot_id || !centroids.has(r.plot_id)) continue;
      const arr = byPlot.get(r.plot_id) ?? [];
      arr.push(r);
      byPlot.set(r.plot_id, arr);
    }
    const out: Placement[] = [...own];
    for (const [plotId, rs] of byPlot) {
      const c = centroids.get(plotId);
      if (!c) continue;
      const n = rs.length;
      rs.forEach((r, i) => {
        let offset: [number, number] = [0, 0];
        if (n > 1) {
          const radius = Math.min(48, 18 + n * 3);
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          offset = [radius * Math.cos(angle), radius * Math.sin(angle)];
        }
        out.push({ harvest: r, lngLat: c, offset });
      });
    }
    return out;
  }, [ids, harvests, plots]);

  const [slots, setSlots] = useState<Slot[]>([]);
  const markersRef = useRef<MarkerEntry[]>([]);

  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map || !mapReady) return;

    markersRef.current.forEach((e) => e.marker.remove());
    markersRef.current = [];

    const entries: MarkerEntry[] = [];
    const created: Slot[] = placements.map((p) => {
      const el = document.createElement("div");
      const marker = new maplibregl.Marker({ element: el, offset: p.offset })
        .setLngLat(p.lngLat)
        .addTo(map);
      entries.push({ marker, base: p.offset });
      return { el, harvest: p.harvest };
    });
    markersRef.current = entries;
    setSlots(created);

    const updateScale = () => {
      const scale = scaleForZoom(map.getZoom());
      for (const { marker, base } of entries) {
        marker.setOffset([base[0] * scale, base[1] * scale]);
        marker.getElement().style.setProperty("--op-scale", String(scale));
      }
    };
    updateScale();
    map.on("zoom", updateScale);

    return () => {
      map.off("zoom", updateScale);
      entries.forEach((e) => e.marker.remove());
      markersRef.current = [];
      setSlots([]);
    };
  }, [placements, mapReady, mapControllerRef]);

  return (
    <>
      {slots.map(({ el, harvest }) =>
        createPortal(<HarvestBadge harvest={harvest} />, el, harvest.id),
      )}
    </>
  );
}

function HarvestBadge({ harvest }: { harvest: Harvest }) {
  const data = new Date(harvest.harvested_at).toLocaleDateString("it-IT");
  const title = [harvest.cultivar, harvest.destination_logistics, data]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-[var(--sh-1)]"
      style={{
        background: HARVEST_COLOR,
        // Scaling geografico iniettato dal marker (× 2^(zoom-rif)).
        transform: "scale(var(--op-scale, 1))",
        transformOrigin: "center",
      }}
    >
      <Wheat size={13} color="#ffffff" strokeWidth={2.5} />
    </span>
  );
}
