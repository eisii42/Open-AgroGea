import { cn } from "@geolibre/ui";
import { useTranslation } from "react-i18next";
import { taskOperationLabel } from "./TaskForm";
import {
  completenessFieldLabel,
  type CompletenessAttentionEntry,
} from "./task-completeness-view";

/**
 * Cruscotto "Record incompleti" del Riquadro Pianificazione: elenca le task
 * PROGRAMMATE e le righe del Quaderno già registrate che, così come sono,
 * produrrebbero/sono un record non conforme al PAN. Stesso idioma di
 * `modules/machinery/AttentionPanel.tsx` (cruscotto "Richiede attenzione"):
 * nessun rumore se l'elenco è vuoto, ogni riga è cliccabile e apre il punto
 * giusto per completarla (la task nel planner, l'operation nel Quaderno).
 *
 * Perché qui e non nel Quaderno: il Riquadro Pianificazione è già l'hub della
 * flow low-touch (vi convivono lo status del geofencing e l'allerta di
 * rientro PAN) — centralizzare qui ANCHE le righe del Quaderno incomplete
 * evita di frammentare l'attenzione dell'operatore su due pannelli diversi
 * per lo stesso tipo di problema ("cosa devo ancora sistemare prima che
 * diventi un problema di conformità").
 */
export function TaskCompletenessPanel({
  entries,
  plotName,
  readOnly,
  onSelect,
}: {
  entries: CompletenessAttentionEntry[];
  plotName: (plotId: string | null) => string;
  readOnly: boolean;
  onSelect: (entry: CompletenessAttentionEntry) => void;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--warn)]">
        ⚠ {t("taskCompleteness.panel.title")} ({entries.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <li key={`${entry.kind}-${entry.refId}`}>
            <button
              type="button"
              disabled={readOnly}
              title={readOnly ? t("moduleSidebar.readOnlyUnavailable") : undefined}
              onClick={() => onSelect(entry)}
              className={cn(
                "flex w-full min-h-[var(--touch-min)] items-center gap-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-2 py-1.5 text-left",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[var(--warn)]">
                  {plotName(entry.plotId)}
                  <span className="rounded-full bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-3)]">
                    {t(
                      entry.kind === "plannedTask"
                        ? "taskCompleteness.panel.kindPlannedTask"
                        : "taskCompleteness.panel.kindTreatmentLog",
                    )}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--ink-2)]">
                  {[
                    taskOperationLabel(t, entry.operationType),
                    entry.date ? new Date(entry.date).toLocaleDateString("it-IT") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-3)]">
                  {t("taskCompleteness.panel.missing", {
                    fields: entry.missing
                      .map((m) => completenessFieldLabel(t, m.field))
                      .join(", "),
                  })}
                </span>
              </span>
              <span className="text-[var(--ink-4)]">›</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
