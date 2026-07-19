import type { MachineStatus } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { useTranslation } from "react-i18next";

/**
 * Semaforo di stato di un mezzo/attrezzo (`MachineStatus`), riusato dall'elenco
 * e dal dettaglio del Parco macchine (0.3.0): colore per stato, etichetta i18n.
 */
export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  const { t } = useTranslation();
  const style: Record<MachineStatus, string> = {
    operational: "bg-[var(--ok-l)] text-[var(--ok)]",
    maintenance: "bg-[var(--warn-l)] text-[var(--warn)]",
    breakdown: "bg-[var(--danger-l)] text-[var(--danger)]",
    decommissioned: "bg-[var(--panel-2)] text-[var(--ink-3)]",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
        style[status],
      )}
    >
      {t(`machinery.status.${status}` as never)}
    </span>
  );
}
