import { cn } from "@geolibre/ui";
import { useTranslation } from "react-i18next";
import type { AttentionEntry } from "./machinery-view";

/**
 * Cruscotto "Richiede attenzione" (§5.8) in testa alla sotto-scheda Mezzi:
 * elenca le sole voci ACTIONABLE prodotte da {@link buildAttentionEntries}
 * (manutenzioni/documenti in scadenza o scaduti, consumi anomali, mezzi
 * fermi). Nessun rumore: il componente non renderizza nulla se l'elenco è
 * vuoto. Ogni riga è cliccabile e apre il dettaglio del mezzo/attrezzo
 * interessato.
 */
export function AttentionPanel({
  entries,
  onSelect,
}: {
  entries: AttentionEntry[];
  onSelect: (entry: AttentionEntry) => void;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  const severityStyle: Record<AttentionEntry["kind"], string> = {
    maintenance_overdue: "border-[var(--danger)] bg-[var(--danger-l)]",
    document_expired: "border-[var(--danger)] bg-[var(--danger-l)]",
    machine_down: "border-[var(--danger)] bg-[var(--danger-l)]",
    fuel_anomaly: "border-[var(--warn)] bg-[var(--warn-l)]",
    maintenance_due: "border-[var(--warn)] bg-[var(--warn-l)]",
    document_expiring: "border-[var(--warn)] bg-[var(--warn-l)]",
  };
  const severityTextStyle: Record<AttentionEntry["kind"], string> = {
    maintenance_overdue: "text-[var(--danger)]",
    document_expired: "text-[var(--danger)]",
    machine_down: "text-[var(--danger)]",
    fuel_anomaly: "text-[var(--warn)]",
    maintenance_due: "text-[var(--warn)]",
    document_expiring: "text-[var(--warn)]",
  };

  function remainingLabel(entry: AttentionEntry): string | null {
    if (entry.remaining == null || entry.unit == null) return null;
    const overdue = entry.remaining < 0;
    const count = Math.abs(entry.remaining);
    if (entry.unit === "days") {
      return overdue
        ? t("machinery.attention.overdueByDays", { count })
        : t("machinery.attention.inDays", { count });
    }
    return overdue
      ? t("machinery.attention.overdueByHours", { count })
      : t("machinery.attention.inHours", { count });
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        ⚠ {t("machinery.attention.title")} ({entries.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((entry, i) => {
          const remaining = remainingLabel(entry);
          return (
            <li key={`${entry.kind}-${entry.refId ?? entry.machineId ?? entry.equipmentId ?? i}`}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className={cn(
                  "flex w-full min-h-[var(--touch-min)] items-center gap-2 rounded-[var(--r-2)] border px-2 py-1.5 text-left",
                  severityStyle[entry.kind],
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-xs font-semibold",
                      severityTextStyle[entry.kind],
                    )}
                  >
                    {t(`machinery.attention.${entry.kind}` as never)}
                  </span>
                  <span className="block truncate text-xs text-[var(--ink-2)]">
                    {entry.subject}
                    {remaining ? ` · ${remaining}` : ""}
                  </span>
                </span>
                <span className="text-[var(--ink-4)]">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
