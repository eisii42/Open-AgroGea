import type { PlannedTask } from "@agrogea/core";
import { X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBackDismiss, useModalBehavior } from "@agrogea/ui";
import { TaskForm } from "../tasks/TaskForm";

/**
 * Pianificazione (o modifica) di una task FUTURA dal Calendario: stesso form
 * del Riquadro Pianificazione, con la data programmata precompilata sul giorno
 * cliccato. È l'ingresso "dal calendario" alla stessa `planned_tasks` che il
 * geofencing propone all'ingresso nell'appezzamento.
 */
export function CalendarTaskDialog({
  day,
  existing,
  defaultPlotId,
  onClose,
}: {
  /** Giorno "YYYY-MM-DD" proposto come data programmata. */
  day: string;
  /** Task da modificare; assente = nuova pianificazione. */
  existing?: PlannedTask | null;
  defaultPlotId?: string;
  onClose: () => void;
}) {
  // Stesso modello di tutte le finestre: Esc, focus dentro, focus restituito.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalBehavior(dialogRef, onClose);
  const { t } = useTranslation();

  // Tasto indietro di Android: chiude il dialogo (no-op altrove).
  useBackDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 md:p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="flex min-h-full w-full max-w-[640px] flex-col bg-[var(--panel)] shadow-[var(--sh-pop)] md:my-auto md:min-h-0 md:rounded-[var(--r-3)] md:border md:border-[var(--line)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              {existing ? t("calendar.editTaskTitle") : t("calendar.addTaskTitle")}
            </h3>
            <p className="text-[11px] text-[var(--ink-3)]">{day}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("logbook.common.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-4">
          <TaskForm
            existing={existing}
            defaultPlotId={defaultPlotId}
            defaultPlannedDate={day}
            onCancel={onClose}
            onSaved={onClose}
          />
        </div>
      </div>
    </div>
  );
}
