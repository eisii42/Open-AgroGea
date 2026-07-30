import {
  type DssResult,
  type Harvest,
  type PlannedTask,
  type SoilWaterIndex,
  type TreatmentLog,
  useAgroStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import {
  CalendarPlus,
  ChevronRight,
  Droplets,
  NotebookPen,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ForecastDay } from "../../lib/WeatherSyncService";
import { weatherCodeInfo } from "../../lib/weather-codes";
import { HarvestDetailCard } from "../field-logbook/HarvestDetailCard";
import { OperationDetailCard } from "../field-logbook/OperationDetailCard";
import type { CalendarEvent } from "./calendar-events";

/**
 * Dettaglio di un GIORNO del Calendario: cosa è successo (o succederà), il
 * meteo di quel giorno e le due porte d'ingresso — pianificare una task
 * futura, registrare un'operazione passata — sempre sul giorno aperto, mai su
 * "oggi" per errore.
 *
 * Il calendario CONSULTA il registro, non lo riscrive: un'operazione o una
 * raccolta si aprono nella loro scheda di sola lettura (la stessa del Quaderno
 * e del registro raccolte). Correzioni e cancellazioni restano dove vive il
 * record — un registro di rilevanza legale non deve avere due porte di
 * modifica con regole diverse. Restano modificabili le sole TASK, che sono
 * pianificazione e non registrazione.
 */
export function CalendarDayPanel({
  day,
  events,
  weather,
  treatments,
  harvests,
  plannedTasks,
  dssResults,
  soilIndices,
  readOnly,
  onClose,
  onAddTask,
  onAddOperation,
  onEditTask,
}: {
  day: string;
  events: CalendarEvent[];
  weather: ForecastDay | undefined;
  treatments: TreatmentLog[];
  harvests: Harvest[];
  plannedTasks: PlannedTask[];
  dssResults: DssResult[];
  soilIndices: SoilWaterIndex[];
  readOnly: boolean;
  onClose: () => void;
  onAddTask: () => void;
  onAddOperation: () => void;
  onEditTask: (task: PlannedTask) => void;
}) {
  const { t, i18n } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  // Scheda aperta in sola lettura (operazione o raccolta).
  const [detail, setDetail] = useState<
    { kind: "operation" | "harvest"; id: string } | null
  >(null);

  const readableDate = new Date(`${day}T00:00:00`).toLocaleDateString(
    i18n.language,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  const plotName = (plotId: string | null): string | null =>
    plotId ? (plots.find((p) => p.id === plotId)?.user_plot_name ?? null) : null;

  const detailOperation =
    detail?.kind === "operation"
      ? (treatments.find((x) => x.id === detail.id) ?? null)
      : null;
  const detailHarvest =
    detail?.kind === "harvest"
      ? (harvests.find((x) => x.id === detail.id) ?? null)
      : null;

  const info = weatherCodeInfo(weather?.weatherCode);
  const WeatherIcon = info.Icon;

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold capitalize">{readableDate}</h3>
            {weather && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--ink-3)]">
                <WeatherIcon size={14} className="text-[var(--ink-2)]" />
                <span>{info.label}</span>
                <span className="agro-num">
                  {weather.tMax != null ? `${Math.round(weather.tMax)}°` : "—"} /{" "}
                  {weather.tMin != null ? `${Math.round(weather.tMin)}°` : "—"}
                </span>
                {weather.pioggiaMm != null && weather.pioggiaMm >= 0.1 && (
                  <span className="agro-num text-[#0284c7]">
                    {weather.pioggiaMm.toFixed(1)} mm
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("logbook.common.cancel")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={15} />
          </button>
        </header>

        {/* Le due azioni del giorno: pianificare avanti, registrare indietro. */}
        {!readOnly && (
          <div className="grid grid-cols-2 gap-2 border-b border-[var(--line)] p-3">
            <button
              type="button"
              onClick={onAddTask}
              className="flex min-h-[var(--touch-min)] items-center justify-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 text-xs font-medium hover:bg-[var(--panel-2)]"
            >
              <CalendarPlus size={14} /> {t("calendar.addTask")}
            </button>
            <button
              type="button"
              onClick={onAddOperation}
              className="flex min-h-[var(--touch-min)] items-center justify-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent)] px-2 text-xs font-medium text-white hover:opacity-90"
            >
              <NotebookPen size={14} /> {t("calendar.addOperation")}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {events.length === 0 && (
            <p className="p-4 text-center text-sm text-[var(--ink-4)]">
              {t("calendar.noEventsForDay")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {events.map((event) => {
              switch (event.kind) {
                case "operation":
                  return (
                    <RecordRow
                      key={event.key}
                      event={event}
                      subtitle={plotName(
                        treatments.find((x) => x.id === event.refId)?.plot_id ??
                          null,
                      )}
                      onOpen={() =>
                        setDetail({ kind: "operation", id: event.refId })
                      }
                    />
                  );
                case "harvest":
                  return (
                    <RecordRow
                      key={event.key}
                      event={event}
                      subtitle={plotName(
                        harvests.find((x) => x.id === event.refId)?.plot_id ??
                          null,
                      )}
                      onOpen={() =>
                        setDetail({ kind: "harvest", id: event.refId })
                      }
                    />
                  );
                case "task":
                  return (
                    <TaskRow
                      key={event.key}
                      event={event}
                      task={plannedTasks.find((x) => x.id === event.refId)}
                      plotName={plotName}
                      readOnly={readOnly}
                      onEdit={onEditTask}
                    />
                  );
                case "dss":
                  return (
                    <InsightRow
                      key={event.key}
                      event={event}
                      icon={<ShieldAlert size={14} />}
                      detail={dssDetailText(
                        t,
                        i18n.language,
                        dssResults.find((x) => x.id === event.refId),
                      )}
                    />
                  );
                default:
                  return (
                    <InsightRow
                      key={event.key}
                      event={event}
                      icon={<Droplets size={14} />}
                      detail={waterDetailText(
                        t,
                        soilIndices.find((x) => x.id === event.refId),
                      )}
                    />
                  );
              }
            })}
          </div>
        </div>
      </div>

      {/* Scheda di sola CONSULTAZIONE: nessuna modifica, nessuna eliminazione
          (niente prop `onDelete`). */}
      {detailOperation && (
        <OperationDetailCard
          operation={detailOperation}
          appezzamentoNome={plotName(detailOperation.plot_id)}
          onClose={() => setDetail(null)}
        />
      )}
      {detailHarvest && (
        <HarvestDetailCard
          harvest={detailHarvest}
          appezzamentoNome={plotName(detailHarvest.plot_id)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/** Riga di un record registrato (operazione/raccolta): apre la sua scheda. */
function RecordRow({
  event,
  subtitle,
  onOpen,
}: {
  event: CalendarEvent;
  subtitle: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2 text-left hover:bg-[var(--panel-2)]"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: event.color }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{event.label}</span>
        {subtitle && (
          <span className="block truncate text-[11px] text-[var(--ink-4)]">
            {subtitle}
          </span>
        )}
      </span>
      <ChevronRight size={15} className="shrink-0 text-[var(--ink-4)]" />
    </button>
  );
}

/**
 * Riga di una task programmata. È pianificazione, non registrazione: qui si
 * può ancora spostare, annullare o eliminare (la chiusura "vera" passa dalla
 * Modalità Campo, che scrive anche il Quaderno).
 */
function TaskRow({
  event,
  task,
  plotName,
  readOnly,
  onEdit,
}: {
  event: CalendarEvent;
  task: PlannedTask | undefined;
  plotName: (plotId: string | null) => string | null;
  readOnly: boolean;
  onEdit: (task: PlannedTask) => void;
}) {
  const { t } = useTranslation();
  const setStatus = useAgroStore((s) => s.setPlannedTaskStatus);
  const remove = useAgroStore((s) => s.deletePlannedTask);
  if (!task) return null;

  const progress =
    typeof task.metadata.completion_percent === "number"
      ? task.metadata.completion_percent
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: event.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{event.label}</span>
          <span className="block truncate text-[11px] text-[var(--ink-4)]">
            {[plotName(task.plot_id), task.operator_name]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-[var(--panel-3)] px-1.5 text-[10px] text-[var(--ink-4)]">
          {t("calendar.planned")}
        </span>
      </div>

      {task.notes && (
        <p className="text-[11px] text-[var(--ink-3)]">{task.notes}</p>
      )}
      {progress != null && progress > 0 && (
        <p className="text-[11px] font-medium text-[var(--warn)]">
          {t("calendar.taskProgress", { percent: progress })}
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--panel-2)]"
          >
            {t("calendar.editTask")}
          </button>
          <button
            type="button"
            onClick={() => void setStatus(task.id, "CANCELLED")}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-2.5 py-1 text-[11px] hover:bg-[var(--panel-2)]"
          >
            {t("calendar.cancelTask")}
          </button>
          <button
            type="button"
            onClick={() => void remove(task.id)}
            aria-label={t("calendar.delete")}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)]"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Riga di un esito CALCOLATO (DSS, bilancio idrico): sola lettura, sempre estesa. */
function InsightRow({
  event,
  icon,
  detail,
}: {
  event: CalendarEvent;
  icon: React.ReactNode;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2",
      )}
    >
      <span className="flex items-center gap-2 text-[13px]">
        <span className="shrink-0" style={{ color: event.color }}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{event.label}</span>
      </span>
      <span className="text-[11px] leading-snug text-[var(--ink-3)]">
        {detail}
      </span>
    </div>
  );
}

function dssDetailText(
  t: TFunction,
  language: string,
  record: DssResult | undefined,
): string {
  if (!record) return "";
  return `${t("calendar.dssModel")} ${record.model_name} · ${t("calendar.dssIndex")} ${record.output_value.toFixed(1)} · ${t("calendar.dssCalculatedOn")} ${new Date(
    record.calculated_at,
  ).toLocaleDateString(language)}`;
}

function waterDetailText(
  t: TFunction,
  record: SoilWaterIndex | undefined,
): string {
  if (!record) return "";
  return t("calendar.waterStressDetail", {
    depletion: record.depletion_mm.toFixed(1),
    raw: record.raw_mm.toFixed(1),
    etc: record.etc.toFixed(1),
  });
}
