import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { History, Ruler } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMapTools } from "../hooks/useMapTools";

/**
 * Cluster di controlli mappa fluttuante (Modulo UI §4). Espone il controllo
 * Measure NATIVO di GeoLibre (pannello righello per distanze/aree al volo) via
 * le API `openMeasurePanel`/`closeMeasurePanel` del plugin components: nessuna
 * logica di misura riscritta (vedi `useMapTools`).
 *
 * Il Terrain Control è anch'esso nativo ma ha già il suo pulsante MapLibre
 * (built-in "terrain", abilitato in `useFieldPlugins`) montato in alto a
 * destra sulla mappa, quindi non va duplicato qui. Stessa colonna di destra per
 * "Cerca luogo" (vedi `MapSearchControl`), che sta sotto il gestore livelli.
 *
 * Solo desktop: su telefono gli stessi strumenti stanno in `MobileMapTools`.
 */
export function MapControls({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const tools = useMapTools(mapControllerRef);

  return (
    <>
      {tools.showMeasure && (
        <button
          type="button"
          onClick={tools.toggleMeasure}
          title={t("mapControls.measure")}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border bg-[var(--panel)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]",
            tools.measureOn
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink-2)]",
          )}
        >
          <Ruler size={18} />
        </button>
      )}
      {tools.showWayback && (
        <button
          type="button"
          onClick={tools.toggleWayback}
          title={t("mapControls.wayback")}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border bg-[var(--panel)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]",
            tools.waybackOn
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink-2)]",
          )}
        >
          <History size={18} />
        </button>
      )}
    </>
  );
}
