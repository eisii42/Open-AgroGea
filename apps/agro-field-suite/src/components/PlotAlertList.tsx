import { cn } from "@geolibre/ui";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlotAlerts } from "../hooks/usePlotAlerts";

/**
 * I segnali del simbolo sull'appezzamento, per esteso: il triangolo dice solo
 * "manca qualcosa", qui si legge che cosa (e quante task sono previste). Stesso
 * calcolo dei simboli in mappa (`usePlotAlerts`), quindi i due non divergono.
 * Usato dal tooltip (desktop) e dalla scheda compatta del telefono.
 */
export function PlotAlertList({
  plotId,
  size = "sm",
  className,
}: {
  plotId: string | null;
  /** "sm" nel tooltip, "md" nella scheda del telefono (leggibile a braccio). */
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useTranslation();
  const alerts = usePlotAlerts();
  const alert = plotId ? alerts.find((a) => a.plotId === plotId) : undefined;
  if (!alert || (alert.gaps.length === 0 && alert.taskCount === 0)) return null;
  const iconSize = size === "md" ? 14 : 10;
  return (
    <ul
      className={cn(
        "flex flex-col leading-snug",
        size === "md" ? "gap-1 text-[13px]" : "gap-0.5 text-[10px]",
        className,
      )}
    >
      {alert.gaps.map((gap) => (
        <li key={gap} className="flex items-start gap-1.5 text-[#b45309]">
          <TriangleAlert size={iconSize} className="mt-[2px] shrink-0" />
          {t(`plotAlerts.gap.${gap}` as never)}
        </li>
      ))}
      {alert.taskCount > 0 && (
        <li className="flex items-start gap-1.5 text-[#2563eb]">
          <CircleAlert size={iconSize} className="mt-[2px] shrink-0" />
          {t("plotAlerts.tasksPending", { count: alert.taskCount })}
        </li>
      )}
    </ul>
  );
}
