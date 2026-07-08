/**
 * Simboli delle operazioni del Quaderno sulla mappa (toggle "Mostra sulla
 * mappa"). Crea marker HTML (icone lucide per tipo operation) SOLO quando il
 * toggle è attivo (`mapOperationIds !== null`) e li rimuove allo spegnimento.
 *
 * Renderizza unicamente le operazioni VISIBILI nel registro (gli ID arrivano già
 * filtered dal LogbookPanel). Più operazioni sullo stesso plot NON si
 * sovrappongono: vengono disposte ad anello (offset in pixel, stabile a ogni
 * zoom) attorno al centroid dell'appezzamento.
 */
import {
  centroid,
  type TreatmentLog,
  type OperationType,
  useAgroStore,
} from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import {
  Droplets,
  Leaf,
  type LucideIcon,
  Sprout,
  SprayCan,
  TestTube,
  Tractor,
  Wheat,
  FlaskConical,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const OP_ICON: Record<OperationType, LucideIcon> = {
  phytosanitary: SprayCan,
  fertilization: FlaskConical,
  irrigation: Droplets,
  tillage: Tractor,
  sowing: Sprout,
  harvest: Wheat,
  sampling: TestTube,
};

const OP_COLOR: Record<OperationType, string> = {
  phytosanitary: "#dc2626",
  fertilization: "#16a34a",
  irrigation: "#0ea5e9",
  tillage: "#92400e",
  sowing: "#a855f7",
  harvest: "#d97706",
  sampling: "#0d9488",
};

const OP_LABEL: Record<OperationType, string> = {
  phytosanitary: "Trattamento",
  fertilization: "Fertilizzazione",
  irrigation: "Irrigazione",
  tillage: "Lavorazione",
  sowing: "Semina",
  harvest: "Harvest",
  sampling: "Campionamento",
};

interface Placement {
  op: TreatmentLog;
  lngLat: [number, number];
  offset: [number, number];
}

interface Slot {
  el: HTMLDivElement;
  op: TreatmentLog;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  /** Offset base (px) dell'anello a zoom di riferimento, prima dello scaling. */
  base: [number, number];
}

// Le icone hanno dimensione fissa RISPETTO ALL'APPEZZAMENTO (geografica), non in
// pixel: senza questo, lo zoom-out rimpicciolisce il field ma non l'icona, che
// appare enorme. Scaliamo come un oggetto al soil (× 2^(zoom-rif)), con clamp
// per restare leggibili/cliccabili agli estremi.
const REF_ZOOM = 16;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.4;

function scaleForZoom(zoom: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, 2 ** (zoom - REF_ZOOM)));
}

export function OperationMarkers({
  mapControllerRef,
  mapReady,
}: {
  mapControllerRef: RefObject<MapController | null>;
  mapReady: boolean;
}) {
  const ids = useAgroStore((s) => s.mapOperationIds);
  const treatments = useAgroStore((s) => s.treatments);
  const plots = useAgroStore((s) => s.plots);

  // Posizioni: una per operation visibile, raggruppate per plot e
  // disposte ad anello attorno al centroid (offset in pixel → niente overlap).
  const placements = useMemo<Placement[]>(() => {
    if (!ids) return [];
    const idSet = new Set(ids);
    const centroids = new Map<string, [number, number]>();
    for (const a of plots) {
      centroids.set(a.id, centroid(a.geometry) as [number, number]);
    }
    const byPlot = new Map<string, TreatmentLog[]>();
    for (const t of treatments) {
      if (t.deleted_at != null || !idSet.has(t.id)) continue;
      if (!t.plot_id || !centroids.has(t.plot_id)) continue;
      const arr = byPlot.get(t.plot_id) ?? [];
      arr.push(t);
      byPlot.set(t.plot_id, arr);
    }
    const out: Placement[] = [];
    for (const [plotId, ops] of byPlot) {
      const c = centroids.get(plotId);
      if (!c) continue;
      const n = ops.length;
      ops.forEach((op, i) => {
        let offset: [number, number] = [0, 0];
        if (n > 1) {
          const radius = Math.min(48, 18 + n * 3);
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          offset = [radius * Math.cos(angle), radius * Math.sin(angle)];
        }
        out.push({ op, lngLat: c, offset });
      });
    }
    return out;
  }, [ids, treatments, plots]);

  // Crea/distrugge i marker MapLibre quando le posizioni cambiano.
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
      return { el, op: p.op };
    });
    markersRef.current = entries;
    setSlots(created);

    // Scaling geografico: a ogni zoom update la dimensione dell'icona (via CSS
    // var letta dal badge) e il raggio dell'anello (offset del marker), così i
    // simboli restano proporzionati all'appezzamento.
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
      {slots.map(({ el, op }) => createPortal(<OpBadge op={op} />, el, op.id))}
    </>
  );
}

function OpBadge({ op }: { op: TreatmentLog }) {
  const Icon = OP_ICON[op.operation_type] ?? Leaf;
  const color = OP_COLOR[op.operation_type] ?? "#64748b";
  const data = new Date(op.executed_at).toLocaleDateString("it-IT");
  const title = [
    OP_LABEL[op.operation_type] ?? op.operation_type,
    op.product_name,
    data,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-[var(--sh-1)]"
      style={{
        background: color,
        // Scaling geografico iniettato dal marker (× 2^(zoom-rif)).
        transform: "scale(var(--op-scale, 1))",
        transformOrigin: "center",
      }}
    >
      <Icon size={13} color="#ffffff" strokeWidth={2.5} />
    </span>
  );
}
