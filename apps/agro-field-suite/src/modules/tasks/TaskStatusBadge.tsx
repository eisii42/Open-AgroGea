import type { PlannedTaskStatus } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { useTranslation } from "react-i18next";

/**
 * Semaforo di stato di una task programmata (`PlannedTaskStatus`), riusato dal
 * Riquadro Pianificazione: colore per stato, etichetta i18n. Stesso idioma di
 * `modules/machinery/StatusBadge.tsx` (MachineStatusBadge).
 */
export function TaskStatusBadge({ status }: { status: PlannedTaskStatus }) {
  const { t } = useTranslation();
  const style: Record<PlannedTaskStatus, string> = {
    PLANNED: "bg-[var(--accent-l)] text-[var(--accent)]",
    IN_PROGRESS: "bg-[var(--warn-l)] text-[var(--warn)]",
    COMPLETED: "bg-[var(--ok-l)] text-[var(--ok)]",
    CANCELLED: "bg-[var(--panel-2)] text-[var(--ink-3)]",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
        style[status],
      )}
    >
      {t(`taskPlanner.status.${status}` as never)}
    </span>
  );
}
