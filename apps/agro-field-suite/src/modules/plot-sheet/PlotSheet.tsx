import {
  formatArea,
  type PlannedTask,
  useAgroStore,
  useReadOnly,
  useSettingsStore,
} from "@agrogea/core";
import { reentryWindowForPlot } from "@agrogea/tools";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import {
  CalendarPlus,
  ClipboardList,
  NotebookPen,
  Play,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationDetailCard } from "../field-logbook/OperationDetailCard";
import { taskOperationLabel } from "../tasks/TaskForm";
import { TaskStatusBadge } from "../tasks/TaskStatusBadge";

/** Ordina le task PLANNED: data pianificata crescente, senza data in coda. */
function sortByPriority(tasks: PlannedTask[]): PlannedTask[] {
  return [...tasks].sort((a, b) => {
    if (a.planned_date && b.planned_date) {
      return a.planned_date.localeCompare(b.planned_date);
    }
    if (a.planned_date) return -1;
    if (b.planned_date) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * SCHEDA dell'appezzamento: tutto ciò che riguarda UN field in un unico posto —
 * le task programmate (avviabili) e le operazioni già registrate.
 *
 * È ciò che si apre toccando il field in mappa, e sostituisce il vecchio
 * comportamento (che apriva il Quaderno filtrato): indicare un campo sulla
 * mappa è il gesto più naturale per dire "voglio lavorare QUI", ed è anche la
 * via d'uscita quando il GPS non collabora — l'avvio di una task non dipende
 * più dal fatto che il geofencing scatti.
 *
 * L'avvio riusa la STESSA scheda di rilevamento del geofencing
 * (`FieldDetectionModal`, pilotata da `geofenceDetection`): non è una
 * scorciatoia che salta i controlli, quindi l'alert del tempo di rientro con
 * presa visione resta obbligatorio esattamente come all'ingresso automatico.
 *
 * Ambito deliberatamente RISTRETTO a questo appezzamento. Il registro
 * dell'intera azienda è un'altra cosa e vive nel modulo Quaderno: sono due
 * pannelli distinti proprio perché un registro di compliance non deve poter
 * mostrare un sottoinsieme parziale senza dirlo.
 */
export function PlotSheet() {
  const { t } = useTranslation();
  const plotSheetPlotId = useAgroStore((s) => s.plotSheetPlotId);
  const closePlotSheet = useAgroStore((s) => s.closePlotSheet);
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const treatments = useAgroStore((s) => s.treatments);
  const recipes = useAgroStore((s) => s.recipes);
  const fieldSessions = useAgroStore((s) => s.fieldSessions);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const units = useSettingsStore((s) => s.units);
  const setGeofenceDetection = useAgroStore((s) => s.setGeofenceDetection);
  const clearGeofenceDismissal = useAgroStore((s) => s.clearGeofenceDismissal);
  const openTasksForPlot = useAgroStore((s) => s.openTasksForPlot);
  const openLogbookForPlot = useAgroStore((s) => s.openLogbookForPlot);
  const deleteTreatment = useAgroStore((s) => s.deleteTreatment);

  const [detail, setDetail] = useState<(typeof treatments)[number] | null>(null);

  const plot = plotSheetPlotId
    ? (plots.find((p) => p.id === plotSheetPlotId) ?? null)
    : null;

  const cropName = useMemo(() => {
    if (!plot) return null;
    const campaign = campaignFields.find(
      (c) => c.plot_id === plot.id && c.closed_at == null && c.deleted_at == null,
    );
    return campaign
      ? (crops.find((c) => c.id === campaign.crop_id)?.common_name ?? null)
      : null;
  }, [plot, campaignFields, crops]);

  const tasks = useMemo(
    () =>
      plot
        ? sortByPriority(
            plannedTasks.filter(
              (task) =>
                task.plot_id === plot.id &&
                task.status === "PLANNED" &&
                task.deleted_at == null,
            ),
          )
        : [],
    [plot, plannedTasks],
  );

  const operations = useMemo(
    () =>
      plot
        ? treatments
            .filter((op) => op.plot_id === plot.id && op.deleted_at == null)
            .slice()
            .sort((a, b) => b.executed_at.localeCompare(a.executed_at))
        : [],
    [plot, treatments],
  );

  const reentry = useMemo(
    () => (plot ? reentryWindowForPlot(treatments, plot.id, Date.now()) : null),
    [plot, treatments],
  );

  /** Una sessione già in corso: avviarne un'altra non ha senso. */
  const busy = fieldSessions.some(
    (session) =>
      session.deleted_at == null &&
      (session.status === "IN_PROGRESS" || session.status === "PAUSED"),
  );

  if (!plotSheetPlotId || !plot) return null;

  /**
   * Avvia da qui: apre la scheda di rilevamento su questo appezzamento, come
   * se il GPS avesse confermato l'ingresso. Libera anche l'eventuale "Dopo":
   * chiedere esplicitamente di iniziare è una richiesta nuova.
   */
  function handleStartHere() {
    if (!plot || readOnly || busy) return;
    clearGeofenceDismissal(plot.id);
    setGeofenceDetection({ plotId: plot.id, at: Date.now() });
  }

  return (
    // Stesso wrapper degli altri pannelli (`FieldSheet`): bottom-sheet su
    // mobile, drawer ancorato a destra da tablet in su. Riusarlo invece di
    // posizionare a mano è ciò che rende la scheda coerente col resto dell'app
    // — e funzionante col pollice su uno schermo piccolo.
    <FieldSheet title={plot.user_plot_name} onClose={closePlotSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="flex items-center gap-1.5 text-xs text-[var(--ink-3)]">
          <ClipboardList size={13} className="shrink-0 text-[var(--accent)]" />
          {[formatArea(plot.area_ha, units.area), cropName]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {reentry && (
          <div className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[var(--warn)]" />
            <p className="text-xs text-[var(--ink-2)]">
              {t("reentryAlert.banner.message", {
                product:
                  reentry.productName ?? t("reentryAlert.banner.genericProduct"),
                hours: reentry.hoursRemaining,
              })}
            </p>
          </div>
        )}

        {/* Task programmate: il motivo per cui questa scheda esiste. */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("plotSheet.plannedTasks", { count: tasks.length })}
            </h3>
            {!readOnly && (
              <button
                type="button"
                onClick={() => openTasksForPlot(plot.id)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                <CalendarPlus size={13} /> {t("plotSheet.planTask")}
              </button>
            )}
          </div>

          {tasks.length === 0 ? (
            <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] px-3 py-3 text-xs text-[var(--ink-4)]">
              {t("plotSheet.noTasks")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {taskOperationLabel(t, task.operation_type)}
                      {task.recipe_id &&
                        ` · ${recipes.find((r) => r.id === task.recipe_id)?.name ?? ""}`}
                    </p>
                    <p className="truncate text-xs text-[var(--ink-3)]">
                      {[
                        task.target_pest_or_disease,
                        task.planned_date
                          ? new Date(task.planned_date).toLocaleDateString("it-IT")
                          : t("plotSheet.noDate"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <TaskStatusBadge status={task.status} />
                </li>
              ))}
            </ul>
          )}

          {/* Avvio manuale: la via d'uscita quando il geofencing non scatta. */}
          {!readOnly && (
            <Button
              type="button"
              disabled={busy}
              onClick={handleStartHere}
              title={busy ? t("plotSheet.startBusy") : undefined}
              className="mt-1 flex min-h-[var(--touch-min)] w-full items-center justify-center gap-2 font-semibold"
            >
              <Play size={16} />
              {tasks.length > 0
                ? t("plotSheet.startTask")
                : t("plotSheet.startOperation")}
            </Button>
          )}
          {busy && (
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("plotSheet.startBusy")}
            </p>
          )}
        </section>

        {/* Operazioni registrate su QUESTO appezzamento. */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("plotSheet.operations", { count: operations.length })}
            </h3>
            <button
              type="button"
              onClick={() => openLogbookForPlot(plot.id)}
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <NotebookPen size={13} /> {t("plotSheet.openLogbook")}
            </button>
          </div>

          {operations.length === 0 ? (
            <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] px-3 py-3 text-xs text-[var(--ink-4)]">
              {t("plotSheet.noOperations")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {operations.map((op) => (
                <li key={op.id}>
                  <button
                    type="button"
                    onClick={() => setDetail(op)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-left hover:bg-[var(--panel-2)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {op.product_name ?? taskOperationLabel(t, op.operation_type)}
                      </p>
                      <p className="truncate text-xs text-[var(--ink-3)]">
                        {[
                          taskOperationLabel(t, op.operation_type),
                          op.dose_value != null
                            ? `${op.dose_value} ${op.dose_unit ?? ""}`
                            : null,
                          op.target_disease,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <time className="agro-num shrink-0 text-xs text-[var(--ink-3)]">
                      {new Date(op.executed_at).toLocaleDateString("it-IT")}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detail && (
        <OperationDetailCard
          operation={detail}
          appezzamentoNome={plot.user_plot_name}
          onClose={() => setDetail(null)}
          onDelete={async () => {
            await deleteTreatment(detail.id);
            setDetail(null);
          }}
        />
      )}
    </FieldSheet>
  );
}
