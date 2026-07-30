import {
  type DssResult,
  type Harvest,
  type PlannedTask,
  type SoilWaterIndex,
  type TreatmentLog,
  useAgroStore,
  useReadOnly,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  NotebookPen,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../components/AppHeader";
import { weatherCodeInfo } from "../../lib/weather-codes";
import { taskOperationLabel } from "../tasks/TaskForm";
import { CalendarDayPanel } from "./CalendarDayPanel";
import { CalendarOperationDialog } from "./CalendarOperationDialog";
import { CalendarTaskDialog } from "./CalendarTaskDialog";
import {
  type CalendarEvent,
  type CalendarEventKind,
  DSS_COLOR,
  HARVEST_COLOR,
  OPERATION_COLOR,
  TASK_COLOR,
  WATER_COLOR,
  buildCalendarEvents,
  groupEventsByDay,
  monthGrid,
  todayKey,
} from "./calendar-events";
import { useCalendarData } from "./useCalendarData";
import { useCalendarWeather } from "./useCalendarWeather";

/**
 * Calendario aziendale (`/calendar`): terza vista di primo livello accanto a
 * Mappa e Command Center, non più un riquadro dentro il cruscotto analitico.
 *
 * Una sola griglia temporale per tutto ciò che ha una data:
 *   * task PROGRAMMATE (pianificabili qui, sul giorno cliccato) e operazioni
 *     REGISTRATE (anch'esse inseribili a posteriori, con la data del giorno);
 *   * raccolte;
 *   * meteo giorno per giorno (icona, massima/minima, pioggia) — storico e
 *     previsione, dal servizio meteo, senza toccare la serie dei DSS;
 *   * giorni a rischio alto dei DSS e giorni di stress idrico del bilancio
 *     FAO 56/66, appena i rispettivi calcoli vengono eseguiti.
 *
 * La mappa e il Command Center restano montati (keep-alive in `App.tsx`):
 * passare al calendario non ricarica il workspace.
 */

function weekdayLabels(t: TFunction): string[] {
  return [
    t("calendar.weekday.mon"),
    t("calendar.weekday.tue"),
    t("calendar.weekday.wed"),
    t("calendar.weekday.thu"),
    t("calendar.weekday.fri"),
    t("calendar.weekday.sat"),
    t("calendar.weekday.sun"),
  ];
}

function monthLabels(t: TFunction): string[] {
  return [
    t("calendar.month.january"),
    t("calendar.month.february"),
    t("calendar.month.march"),
    t("calendar.month.april"),
    t("calendar.month.may"),
    t("calendar.month.june"),
    t("calendar.month.july"),
    t("calendar.month.august"),
    t("calendar.month.september"),
    t("calendar.month.october"),
    t("calendar.month.november"),
    t("calendar.month.december"),
  ];
}

/** Temperatura arrotondata, o trattino. */
function degrees(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)}°`;
}

/** Ordine e colore dei filtri per tipo di voce (stesso ordine in griglia). */
const FILTER_KINDS: { kind: CalendarEventKind; color: string }[] = [
  { kind: "task", color: TASK_COLOR },
  { kind: "operation", color: OPERATION_COLOR.phytosanitary },
  { kind: "harvest", color: HARVEST_COLOR },
  { kind: "dss", color: DSS_COLOR },
  { kind: "water", color: WATER_COLOR },
];

const ALL_KINDS: CalendarEventKind[] = FILTER_KINDS.map((f) => f.kind);

export function CalendarScreen() {
  const { t } = useTranslation();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const plots = useAgroStore((s) => s.plots);
  const treatments = useAgroStore((s) => s.treatments);
  const harvests = useAgroStore((s) => s.harvests);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [plotId, setPlotId] = useState<string>("");
  // Filtri per tipo di voce: tutti attivi all'apertura (il calendario è
  // completo per definizione; si spegne ciò che in quel momento distrae).
  const [visibleKinds, setVisibleKinds] = useState<Set<CalendarEventKind>>(
    () => new Set(ALL_KINDS),
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Dialoghi di inserimento: la data è SEMPRE quella del giorno aperto.
  const [taskDialogDay, setTaskDialogDay] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<PlannedTask | null>(null);
  const [operationDialogDay, setOperationDialogDay] = useState<string | null>(null);

  const data = useCalendarData(year);

  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
  const weather = useCalendarWeather(monthStart, monthEnd);

  const plotIds = useMemo<Set<string> | null>(
    () => (plotId ? new Set([plotId]) : null),
    [plotId],
  );

  const today = todayKey(now);

  const events = useMemo<CalendarEvent[]>(
    () =>
      buildCalendarEvents({
        plannedTasks,
        treatments,
        harvests,
        dssResults: data.dssResults,
        soilIndices: data.soilIndices,
        plotIdByCampaign: data.plotIdByCampaign,
        plotIds,
        today,
        labels: {
          task: (task: PlannedTask) =>
            `${t("calendar.taskPrefix")}: ${taskOperationLabel(t, task.operation_type)}${
              task.recipe_id
                ? ` · ${recipes.find((r) => r.id === task.recipe_id)?.name ?? ""}`
                : ""
            }`,
          operation: (log: TreatmentLog) =>
            `${t(`rawDataInspector.opType.${log.operation_type}` as never)}${
              log.product_name ? ` · ${log.product_name}` : ""
            }`,
          harvest: (harvest: Harvest) =>
            `${t("calendar.harvest")}${
              harvest.quantity_kg ? ` · ${harvest.quantity_kg} kg` : ""
            }`,
          dss: (result: DssResult) =>
            t("calendar.highRisk", { model: result.model_name }),
          water: (index: SoilWaterIndex) =>
            t("calendar.waterStress", {
              mm: Math.max(0, index.depletion_mm).toFixed(0),
            }),
        },
      }),
    [
      plannedTasks,
      treatments,
      harvests,
      data.dssResults,
      data.soilIndices,
      data.plotIdByCampaign,
      plotIds,
      today,
      recipes,
      t,
    ],
  );

  // Conteggi del MESE per tipo: alimentano le pillole di filtro, così si vede
  // anche ciò che si sta nascondendo.
  const monthCounts = useMemo(() => {
    const counts = new Map<CalendarEventKind, number>();
    for (const event of events) {
      if (event.day < monthStart || event.day > monthEnd) continue;
      counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    }
    return counts;
  }, [events, monthStart, monthEnd]);

  const visibleEvents = useMemo(
    () => events.filter((event) => visibleKinds.has(event.kind)),
    [events, visibleKinds],
  );

  const eventsByDay = useMemo(
    () => groupEventsByDay(visibleEvents),
    [visibleEvents],
  );
  const cells = useMemo(() => monthGrid(year, month), [year, month]);

  function toggleKind(kind: CalendarEventKind) {
    setVisibleKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  // Un solo dialogo per volta: aprirne uno chiude l'altro (altrimenti due
  // form si sovrapporrebbero sullo stesso giorno).
  function openTaskDialog(dayKeyValue: string, task: PlannedTask | null = null) {
    setOperationDialogDay(null);
    setEditingTask(task);
    setTaskDialogDay(dayKeyValue);
  }

  function openOperationDialog(dayKeyValue: string) {
    setTaskDialogDay(null);
    setEditingTask(null);
    setOperationDialogDay(dayKeyValue);
  }

  function shiftMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function goToday() {
    const current = new Date();
    setYear(current.getFullYear());
    setMonth(current.getMonth());
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader />

      {/* Prima barra: quando (mese) e dove (appezzamento) + le due azioni. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label={t("calendar.previousMonth")}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] text-center text-sm font-semibold capitalize">
            {monthLabels(t)[month]} {year}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label={t("calendar.nextMonth")}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="ml-1 rounded-[var(--r-2)] border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--panel-2)]"
          >
            {t("calendar.today")}
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]">
          {t("calendar.plotScope")}
          <select
            value={plotId}
            onChange={(e) => setPlotId(e.target.value)}
            className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
          >
            <option value="">{t("calendar.allPlots")}</option>
            {plots
              .filter((p) => p.deleted_at == null)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.user_plot_name}
                </option>
              ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => openTaskDialog(selectedDay ?? today)}
                className="flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm font-medium hover:bg-[var(--panel-2)]"
              >
                <CalendarPlus size={15} /> {t("calendar.addTask")}
              </button>
              <button
                type="button"
                onClick={() => openOperationDialog(selectedDay ?? today)}
                className="flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <NotebookPen size={15} /> {t("calendar.addOperation")}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={data.refresh}
            title={t("calendar.refreshTitle")}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--r-2)] border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            {data.loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
          </button>
        </div>
      </div>

      {/* Seconda barra: COSA mostrare. Le pillole fanno da legenda e da filtro
          insieme — un colore, un significato, un interruttore. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2">
        {FILTER_KINDS.map(({ kind, color }) => {
          const on = visibleKinds.has(kind);
          const count = monthCounts.get(kind) ?? 0;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => toggleKind(kind)}
              className={cn(
                "flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
                on
                  ? "border-transparent bg-[var(--panel-2)] text-[var(--ink)]"
                  : "border-[var(--line)] text-[var(--ink-4)]",
              )}
            >
              <span
                className={cn("h-2.5 w-2.5 rounded-full", !on && "opacity-30")}
                style={{ background: color }}
              />
              {t(`calendar.legend.${kind}` as never)}
              <span
                className={cn(
                  "agro-num tabular-nums text-[11px]",
                  on ? "text-[var(--ink-3)]" : "text-[var(--ink-4)]",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
        {visibleKinds.size !== ALL_KINDS.length && (
          <button
            type="button"
            onClick={() => setVisibleKinds(new Set(ALL_KINDS))}
            className="ml-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--panel-2)]"
          >
            {t("calendar.showAll")}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg)] p-3">
        <div className="grid grid-cols-7 gap-1">
          {weekdayLabels(t).map((label) => (
            <div
              key={label}
              className="pb-1 text-center text-[11px] font-medium text-[var(--ink-4)]"
            >
              {label}
            </div>
          ))}
          {cells.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} />;
            const dayEvents = eventsByDay.get(day) ?? [];
            const isToday = day === today;
            const forecast = weather.get(day);
            const info = weatherCodeInfo(forecast?.weatherCode);
            const WeatherIcon = info.Icon;
            return (
              <button
                type="button"
                key={day}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "flex min-h-[104px] flex-col gap-1 rounded-[var(--r-1)] border p-1.5 text-left transition-colors",
                  isToday
                    ? "border-[var(--accent)] bg-[var(--accent-l)]"
                    : "border-[var(--line)] bg-[var(--panel)] hover:bg-[var(--panel-2)]",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "text-[12px] font-semibold",
                      isToday ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  {/* Meteo del giorno: simbolo, massima/minima e pioggia —
                      il contesto che spiega perché una lavorazione è (o non è)
                      possibile in quel giorno. */}
                  {forecast && (
                    <span
                      className="flex items-center gap-1 text-[10px] text-[var(--ink-3)]"
                      title={info.label}
                    >
                      <WeatherIcon size={13} className="text-[var(--ink-2)]" />
                      <span className="tabular-nums font-medium text-[var(--ink-2)]">
                        {degrees(forecast.tMax)}
                      </span>
                      <span className="tabular-nums text-[var(--ink-4)]">
                        {degrees(forecast.tMin)}
                      </span>
                      {forecast.pioggiaMm != null && forecast.pioggiaMm >= 0.1 && (
                        <span className="tabular-nums font-medium text-[#0284c7]">
                          {forecast.pioggiaMm.toFixed(1)}mm
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEvents.slice(0, 4).map((event) => (
                    <span
                      key={event.key}
                      className={cn(
                        "truncate rounded-sm px-1 text-[9px] leading-tight text-white",
                        event.future && "opacity-70 ring-1 ring-inset",
                      )}
                      style={{ background: event.color }}
                      title={event.label}
                    >
                      {event.label}
                    </span>
                  ))}
                  {dayEvents.length > 4 && (
                    <span className="px-1 text-[9px] text-[var(--ink-4)]">
                      +{dayEvents.length - 4}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <CalendarDayPanel
          day={selectedDay}
          events={eventsByDay.get(selectedDay) ?? []}
          weather={weather.get(selectedDay)}
          treatments={treatments}
          harvests={harvests}
          plannedTasks={plannedTasks}
          dssResults={data.dssResults}
          soilIndices={data.soilIndices}
          readOnly={readOnly}
          onClose={() => setSelectedDay(null)}
          onAddTask={() => openTaskDialog(selectedDay)}
          onAddOperation={() => openOperationDialog(selectedDay)}
          onEditTask={(task) =>
            openTaskDialog(task.planned_date ?? selectedDay, task)
          }
        />
      )}

      {taskDialogDay && (
        <CalendarTaskDialog
          day={taskDialogDay}
          existing={editingTask}
          defaultPlotId={plotId || undefined}
          onClose={() => {
            setTaskDialogDay(null);
            setEditingTask(null);
          }}
        />
      )}

      {operationDialogDay && (
        <CalendarOperationDialog
          day={operationDialogDay}
          defaultPlotId={plotId || undefined}
          onClose={() => setOperationDialogDay(null)}
        />
      )}
    </div>
  );
}
