/**
 * POI dei magazzini sulla mappa. Ogni magazzino georeferenziato
 * (`warehouses.geometry`) diventa un punto cliccabile con ICONA DEDICATA alla
 * sua tipologia: il click apre la scheda di QUEL deposito (modulo Magazzino già
 * filtrato), così la mappa è una via d'accesso alle giacenze e non solo alla
 * geometria dei campi.
 *
 * Marker HTML e non un layer vettoriale, per la stessa ragione di
 * `OperationMarkers`/`HarvestMarkers`: un'icona per tipologia + un badge con il
 * numero di lots in giacenza non si esprimono con lo stile di un cerchio
 * MapLibre. A differenza di quei due, però, i POI magazzino sono PERMANENTI
 * (non dipendono da un toggle): un deposito è un elemento stabile dell'azienda.
 */
import { type Warehouse, useAgroStore } from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import {
  Fuel,
  type LucideIcon,
  Package,
  Sprout,
  SprayCan,
  TestTube2,
  Tractor,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/** Icona per tipologia di deposito (fallback: magazzino generico). */
const KIND_ICON: Record<string, LucideIcon> = {
  general: WarehouseIcon,
  phytosanitary: SprayCan,
  fertilizer: TestTube2,
  seed: Sprout,
  fuel: Fuel,
  machinery: Tractor,
};

/**
 * Colore del POI magazzino: indaco, deliberatamente fuori dalla tavolozza delle
 * colture e da quella delle operazioni — un deposito non è un'attività di campo
 * né una coltura, e sulla mappa deve leggersi come una cosa di altra natura.
 */
const WAREHOUSE_COLOR = "#4f46e5";

interface Slot {
  el: HTMLDivElement;
  warehouse: Warehouse;
  lotCount: number;
}

export function WarehouseMarkers({
  mapControllerRef,
  mapReady,
}: {
  mapControllerRef: RefObject<MapController | null>;
  mapReady: boolean;
}) {
  const warehouses = useAgroStore((s) => s.warehouses);
  const lots = useAgroStore((s) => s.lots);
  const openWarehouse = useAgroStore((s) => s.openWarehouse);

  // Solo i magazzini georeferenziati compaiono in mappa: quelli senza punto
  // restano magazzini logici, raggiungibili dal modulo.
  const placed = useMemo(
    () =>
      warehouses.filter(
        (w): w is Warehouse & { geometry: NonNullable<Warehouse["geometry"]> } =>
          w.deleted_at == null && w.geometry != null,
      ),
    [warehouses],
  );

  /** Lotti CON giacenza per magazzino: è il numero mostrato dal badge. */
  const lotCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lot of lots) {
      if (lot.deleted_at != null || !lot.warehouse_id) continue;
      if (Number(lot.quantity_on_hand) <= 0) continue;
      counts.set(lot.warehouse_id, (counts.get(lot.warehouse_id) ?? 0) + 1);
    }
    return counts;
  }, [lots]);

  const [slots, setSlots] = useState<Slot[]>([]);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const markers: maplibregl.Marker[] = [];
    const created: Slot[] = placed.map((w) => {
      const el = document.createElement("div");
      const [lng, lat] = w.geometry.coordinates;
      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map),
      );
      return { el, warehouse: w, lotCount: lotCounts.get(w.id) ?? 0 };
    });
    markersRef.current = markers;
    setSlots(created);

    return () => {
      markers.forEach((m) => m.remove());
      markersRef.current = [];
      setSlots([]);
    };
  }, [placed, lotCounts, mapReady, mapControllerRef]);

  return (
    <>
      {slots.map(({ el, warehouse, lotCount }) =>
        createPortal(
          <WarehousePoi
            warehouse={warehouse}
            lotCount={lotCount}
            onOpen={() => openWarehouse(warehouse.id)}
          />,
          el,
          warehouse.id,
        ),
      )}
    </>
  );
}

function WarehousePoi({
  warehouse,
  lotCount,
  onOpen,
}: {
  warehouse: Warehouse;
  lotCount: number;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[warehouse.warehouse_type] ?? Package;
  const title = `${warehouse.name} · ${t("warehouseSheet.lotsInStock", {
    count: lotCount,
  })}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onOpen}
      className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--r-2)] border-2 border-white shadow-[var(--sh-1)]"
      style={{ background: WAREHOUSE_COLOR }}
    >
      <Icon size={16} color="#ffffff" strokeWidth={2.5} />
      {lotCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-[var(--ink)] px-1 text-[10px] font-bold leading-none text-white">
          {lotCount}
        </span>
      )}
    </button>
  );
}
