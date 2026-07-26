import {
  type OperationType,
  type PlannedTask,
  formatArea,
  useAgroStore,
  useReadOnly,
  useSettingsStore,
} from "@agrogea/core";
import { reentryWindowForPlot } from "@agrogea/tools";
import { Button, Select, cn } from "@geolibre/ui";
import {
  CheckCircle2,
  ChevronRight,
  Droplets,
  FlaskConical,
  type LucideIcon,
  MapPinned,
  MoreHorizontal,
  ShieldAlert,
  SprayCan,
  Tractor,
  Wheat,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { taskOperationLabel } from "../tasks/TaskForm";
import { loadFieldModeConfig } from "./field-mode-config";

/** Tipi operation proposti come pulsanti giganti primari (§spec Part E). */
const PRIMARY_TYPES: OperationType[] = ["phytosanitary", "fertilization", "tillage"];
/** Tipi residui, dietro il pulsante "Altro". */
const OTHER_TYPES: OperationType[] = [
  "irrigation",
  "sowing",
  "harvest",
  "sampling",
];

const QUICK_ICON: Record<OperationType, LucideIcon> = {
  phytosanitary: SprayCan,
  fertilization: Droplets,
  tillage: Tractor,
  irrigation: Droplets,
  sowing: Wheat,
  harvest: Wheat,
  sampling: FlaskConical,
};

/** Etichetta corta dei tre tipi primari (i pulsanti giganti hanno poco spazio). */
function quickOperationLabel(t: TFunction, type: OperationType): string {
  return t(`fieldMode.detection.quickOperation.${type}` as never);
}

/** Ordina le task PLANNED del plot: data pianificata crescente, senza data in coda. */
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
 * Modale GIGANTE a tutto schermo: compare quando il
 * geofencing conferma l'ingresso in un appezzamento (`geofenceDetection`
 * valorizzato in `useAgroStore`). Progettata per l'uso con una mano sola in
 * pieno sole: tipografia grande, spaziatura generosa, target touch ≥ 64px
 * (i pulsanti che avviano il lavoro ≥ 80px). Z-index massimo: sopra pannelli,
 * mappa e ogni altro overlay dell'app.
 */
export function FieldDetectionModal() {
  const { t } = useTranslation();
  const geofenceDetection = useAgroStore((s) => s.geofenceDetection);
  const dismissGeofenceDetection = useAgroStore((s) => s.dismissGeofenceDetection);
  const setGeofenceDetection = useAgroStore((s) => s.setGeofenceDetection);
  const plots = useAgroStore((s) => s.plots);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);
  const treatments = useAgroStore((s) => s.treatments);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const units = useSettingsStore((s) => s.units);
  const startFieldSession = useAgroStore((s) => s.startFieldSession);
  const abortFieldSession = useAgroStore((s) => s.abortFieldSession);

  const [operationType, setOperationType] = useState<OperationType | "">("");
  const [showOtherTypes, setShowOtherTypes] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [reentryAck, setReentryAck] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startedSessionId, setStartedSessionId] = useState<string | null>(null);
  const [aborting, setAborting] = useState(false);

  const plot = geofenceDetection
    ? (plots.find((p) => p.id === geofenceDetection.plotId) ?? null)
    : null;

  const tasksForPlot = useMemo(
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

  const reentry = useMemo(
    () => (plot ? reentryWindowForPlot(treatments, plot.id, Date.now()) : null),
    [plot, treatments],
  );

  const availableRecipes = useMemo(
    () =>
      recipes.filter(
        (r) =>
          r.deleted_at == null &&
          (operationType === "" ||
            r.operation_type == null ||
            r.operation_type === operationType),
      ),
    [recipes, operationType],
  );

  // Nessuna proposta pendente, o l'appezzamento non esiste più (soft-delete
  // concorrente): nulla da mostrare.
  if (!geofenceDetection || !plot) return null;

  const reentryBlocking = reentry != null && !reentryAck;

  async function handleStart(input: {
    operationType: OperationType;
    plannedTaskId: string | null;
    recipeId: string | null;
  }) {
    if (starting || reentryBlocking || readOnly || !plot) return;
    setStarting(true);
    setStartError(null);
    try {
      const config = loadFieldModeConfig();
      const record = await startFieldSession({
        plot_id: plot.id,
        planned_task_id: input.plannedTaskId,
        operation_type: input.operationType,
        recipe_id: input.recipeId,
        machine_id: null,
        equipment_id: null,
        working_width_m: config.defaultWorkingWidthM,
        operator_name: null,
        notes: null,
      });
      if (record) setStartedSessionId(record.id);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  function handleClose() {
    setGeofenceDetection(null);
  }

  /**
   * Annulla una sessione avviata per errore (tap involontario, task
   * sbagliata): finché l'InFieldDashboard non esiste, questa è l'unica via
   * per correggere un avvio accidentale — il pulsante di abbandono "vero"
   * (con conferma) vivrà lì.
   */
  async function handleAbort() {
    if (!startedSessionId || aborting) return;
    setAborting(true);
    try {
      await abortFieldSession(startedSessionId);
    } finally {
      setAborting(false);
      setGeofenceDetection(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-y-auto bg-[var(--bg,var(--panel-2))]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--r-3)] bg-[var(--accent)] text-white">
          <MapPinned size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold leading-tight">
            {t("fieldMode.detection.headerPrefix")}{" "}
            <strong>{plot.user_plot_name}</strong>
          </h1>
          <p className="text-sm text-[var(--ink-3)]">
            {formatArea(plot.area_ha, units.area)}
          </p>
        </div>
        {!startedSessionId && (
          <button
            type="button"
            aria-label={t("fieldMode.detection.dismiss")}
            onClick={dismissGeofenceDetection}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            <X size={28} />
          </button>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-5 p-5">
        {reentry && (
          <div className="flex flex-col gap-3 rounded-[var(--r-3)] border-2 border-[var(--warn)] bg-[var(--warn-l)] p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={28} className="mt-0.5 shrink-0 text-[var(--warn)]" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-[var(--warn)]">
                  {t("reentryAlert.banner.title")}
                </p>
                <p className="mt-1 text-sm text-[var(--ink-2)]">
                  {t("reentryAlert.banner.message", {
                    product:
                      reentry.productName ?? t("reentryAlert.banner.genericProduct"),
                    hours: reentry.hoursRemaining,
                  })}
                </p>
              </div>
            </div>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--panel)] px-3 py-2">
              <input
                type="checkbox"
                checked={reentryAck}
                onChange={(e) => setReentryAck(e.target.checked)}
                className="h-5 w-5 accent-[var(--warn)]"
              />
              <span className="text-sm font-medium text-[var(--ink)]">
                {t("reentryAlert.banner.ack")}
              </span>
            </label>
          </div>
        )}

        {startError && (
          <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-sm text-[var(--danger)]">
            {startError}
          </p>
        )}

        {startedSessionId ? (
          <div className="flex flex-col items-center gap-3 rounded-[var(--r-3)] border border-[var(--ok)] bg-[var(--ok-l)] p-6 text-center">
            <CheckCircle2 size={40} className="text-[var(--ok)]" />
            <p className="text-lg font-bold text-[var(--ok)]">
              {t("fieldMode.detection.confirmTitle")}
            </p>
            <p className="text-sm text-[var(--ink-2)]">
              {t("fieldMode.detection.confirmBody")}
            </p>
            {/* TODO: qui monterà InFieldDashboard (tracking GPS,
                superficie lavorata, note vocali) invece di questa conferma. */}
            <div className="flex w-full flex-col gap-2">
              <Button
                type="button"
                className="min-h-[64px] w-full text-base"
                onClick={handleClose}
              >
                {t("fieldMode.detection.close")}
              </Button>
              <button
                type="button"
                disabled={aborting}
                onClick={() => void handleAbort()}
                className="min-h-[44px] self-center px-4 text-sm font-medium text-[var(--danger)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("fieldMode.detection.abortSession")}
              </button>
            </div>
          </div>
        ) : readOnly ? (
          <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--ink-2)]">
            {t("fieldMode.detection.readOnly")}
          </p>
        ) : tasksForPlot.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("fieldMode.detection.taskSectionTitle")}
            </p>
            {tasksForPlot.map((task, index) => (
              <button
                key={task.id}
                type="button"
                disabled={starting || reentryBlocking}
                onClick={() =>
                  void handleStart({
                    operationType: task.operation_type,
                    plannedTaskId: task.id,
                    recipeId: task.recipe_id,
                  })
                }
                className={cn(
                  "flex min-h-[88px] w-full flex-col items-start gap-1 rounded-[var(--r-3)] border-2 px-5 py-4 text-left shadow-[var(--sh-1)] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  index === 0
                    ? "border-[var(--accent)] bg-[var(--accent-l)]"
                    : "border-[var(--line)] bg-[var(--panel)] hover:bg-[var(--panel-2)]",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  {index === 0 && (
                    <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                      {t("fieldMode.detection.taskRecommended")}
                    </span>
                  )}
                  <span className="text-lg font-bold text-[var(--ink)]">
                    {taskOperationLabel(t, task.operation_type)}
                    {task.recipe_id &&
                      ` · ${recipes.find((r) => r.id === task.recipe_id)?.name ?? ""}`}
                  </span>
                  <ChevronRight size={22} className="ml-auto shrink-0 text-[var(--accent)]" />
                </span>
                <span className="text-sm text-[var(--ink-3)]">
                  {[
                    task.target_pest_or_disease,
                    task.planned_date
                      ? new Date(task.planned_date).toLocaleDateString("it-IT")
                      : t("fieldMode.detection.noDate"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-1 text-sm font-bold uppercase tracking-wide text-[var(--accent)]">
                  {t("fieldMode.detection.startTask")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("fieldMode.detection.noTaskTitle")}
            </p>
            <p className="text-base font-medium text-[var(--ink)]">
              {t("fieldMode.detection.chooseOperation")}
            </p>

            <div className="grid grid-cols-2 gap-3">
              {PRIMARY_TYPES.map((type) => {
                const Icon = QUICK_ICON[type];
                const selected = operationType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setOperationType(type);
                      setShowOtherTypes(false);
                    }}
                    className={cn(
                      "flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-[var(--r-3)] border-2 px-3 py-3 text-center transition-colors",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                        : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                    )}
                  >
                    <Icon size={24} />
                    <span className="text-sm font-bold">
                      {quickOperationLabel(t, type)}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowOtherTypes((v) => !v)}
                className={cn(
                  "flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-[var(--r-3)] border-2 px-3 py-3 text-center transition-colors",
                  showOtherTypes || OTHER_TYPES.includes(operationType as OperationType)
                    ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                    : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                )}
              >
                <MoreHorizontal size={24} />
                <span className="text-sm font-bold">
                  {t("fieldMode.detection.quickOperation.other")}
                </span>
              </button>
            </div>

            {showOtherTypes && (
              <div className="grid grid-cols-2 gap-2 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel-2)] p-3 sm:grid-cols-4">
                {OTHER_TYPES.map((type) => {
                  const Icon = QUICK_ICON[type];
                  const selected = operationType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setOperationType(type)}
                      className={cn(
                        "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[var(--r-2)] border px-2 py-2 text-center text-xs font-semibold transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                          : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                      )}
                    >
                      <Icon size={18} />
                      {taskOperationLabel(t, type)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="fdm-recipe" className="text-sm font-medium text-[var(--ink-2)]">
                {t("fieldMode.detection.recipeLabel")}
              </label>
              <Select
                id="fdm-recipe"
                value={recipeId}
                onChange={(e) => setRecipeId(e.target.value)}
              >
                <option value="">{t("fieldMode.detection.recipeNone")}</option>
                {availableRecipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>

            <Button
              type="button"
              disabled={operationType === "" || starting || reentryBlocking}
              className="min-h-[88px] w-full text-lg font-bold"
              onClick={() =>
                operationType !== "" &&
                void handleStart({
                  operationType,
                  plannedTaskId: null,
                  recipeId: recipeId || null,
                })
              }
            >
              {t("fieldMode.detection.startFree")}
            </Button>
          </div>
        )}

        {!startedSessionId && !readOnly && (
          <button
            type="button"
            onClick={dismissGeofenceDetection}
            className="min-h-[44px] self-center px-4 text-sm font-medium text-[var(--ink-3)] hover:text-[var(--ink)]"
          >
            {t("fieldMode.detection.dismiss")}
          </button>
        )}
      </main>
    </div>
  );
}
