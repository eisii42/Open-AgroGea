import {
  type PlannedTask,
  type Recipe,
  useAgroStore,
  useReadOnly,
} from "@agrogea/core";
import { Button, cn } from "@geolibre/ui";
import {
  ClipboardList,
  FlaskConical,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskForm, taskOperationLabel } from "./TaskForm";
import { RecipeForm } from "./RecipeForm";
import { TaskStatusBadge } from "./TaskStatusBadge";

type Tab = "tasks" | "recipes";

type View =
  | { kind: "list" }
  | { kind: "newTask" }
  | { kind: "editTask"; id: string }
  | { kind: "newRecipe" }
  | { kind: "editRecipe"; id: string };

/**
 * Riquadro Pianificazione Task / Ricette (Step 1 della flow low-touch a bordo
 * campo). Pagina a tutto schermo (come `UserProfileSettingsPage`, non un
 * drawer): due sezioni — task in programmazione su un plot (l'oggetto che il
 * geofencing dello step 2 propone all'ingresso nel field) e la libreria
 * ricette riutilizzabili che le task possono suggerire.
 */
export function TaskPlannerPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const plots = useAgroStore((s) => s.plots);
  const recipes = useAgroStore((s) => s.recipes);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const deletePlannedTask = useAgroStore((s) => s.deletePlannedTask);
  const setPlannedTaskStatus = useAgroStore((s) => s.setPlannedTaskStatus);
  const deleteRecipe = useAgroStore((s) => s.deleteRecipe);
  const tasksOpenPlotId = useAgroStore((s) => s.tasksOpenPlotId);
  const consumeTasksOpen = useAgroStore((s) => s.consumeTasksOpen);

  const [tab, setTab] = useState<Tab>("tasks");
  const [view, setView] = useState<View>({ kind: "list" });
  const [defaultPlotId, setDefaultPlotId] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);

  // Apertura pre-mirata su un plot (click "Pianifica task" sul field in
  // mappa): apre subito il form di creazione con quel plot preselezionato.
  useEffect(() => {
    if (tasksOpenPlotId) {
      setDefaultPlotId(tasksOpenPlotId);
      setTab("tasks");
      setView({ kind: "newTask" });
      consumeTasksOpen();
    }
  }, [tasksOpenPlotId, consumeTasksOpen]);

  const plotName = (plotId: string) =>
    plots.find((p) => p.id === plotId)?.user_plot_name ??
    t("taskPlanner.unknownPlot");

  const recipeName = (recipeId: string | null) =>
    recipeId ? (recipes.find((r) => r.id === recipeId)?.name ?? "—") : "—";

  const upcoming = useMemo(
    () =>
      plannedTasks
        .filter((task) => task.status === "PLANNED" && task.deleted_at == null)
        .slice()
        .sort((a, b) => {
          if (a.planned_date && b.planned_date) {
            return a.planned_date.localeCompare(b.planned_date);
          }
          if (a.planned_date) return -1;
          if (b.planned_date) return 1;
          return a.created_at.localeCompare(b.created_at);
        }),
    [plannedTasks],
  );

  const history = useMemo(
    () =>
      plannedTasks
        .filter((task) => task.status !== "PLANNED" && task.deleted_at == null)
        .slice()
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [plannedTasks],
  );

  const activeRecipes = useMemo(
    () => recipes.filter((r) => r.deleted_at == null),
    [recipes],
  );

  async function handleCancelTask(task: PlannedTask) {
    await setPlannedTaskStatus(task.id, "CANCELLED");
  }

  async function handleDeleteTask(id: string) {
    await deletePlannedTask(id);
  }

  async function handleDeleteRecipe(id: string) {
    await deleteRecipe(id);
  }

  const title =
    view.kind === "newTask" || view.kind === "editTask"
      ? t("taskPlanner.title.taskForm")
      : view.kind === "newRecipe" || view.kind === "editRecipe"
        ? t("taskPlanner.title.recipeForm")
        : t("taskPlanner.header.title");

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-[var(--bg,var(--panel-2))]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <ClipboardList size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold">{title}</h1>
          {view.kind === "list" && (
            <p className="truncate text-xs text-[var(--ink-4)]">
              {t("taskPlanner.header.subtitle")}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t("taskPlanner.header.closeAria")}
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
        >
          <X size={20} />
        </button>
      </header>

      <main className="mx-auto flex max-w-[760px] flex-col gap-4 p-4">
        {readOnly && (
          <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--ink-2)]">
            {t("taskPlanner.readOnlyNotice")}
          </p>
        )}

        {view.kind === "list" && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={readOnly}
                className="min-h-[var(--touch-min)] flex-1 gap-1"
                onClick={() => setView({ kind: "newTask" })}
              >
                <Plus size={16} /> {t("taskPlanner.newTask")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={readOnly}
                className="min-h-[var(--touch-min)] flex-1 gap-1"
                onClick={() => setView({ kind: "newRecipe" })}
              >
                <FlaskConical size={16} /> {t("taskPlanner.newRecipe")}
              </Button>
            </div>

            <div className="flex gap-1 border-b border-[var(--line)]">
              <TabButton
                active={tab === "tasks"}
                onClick={() => setTab("tasks")}
                icon={<ListChecks size={15} />}
                label={t("taskPlanner.tab.tasks")}
              />
              <TabButton
                active={tab === "recipes"}
                onClick={() => setTab("recipes")}
                icon={<FlaskConical size={15} />}
                label={t("taskPlanner.tab.recipes")}
              />
            </div>

            {tab === "tasks" ? (
              <div className="flex flex-col gap-3">
                {upcoming.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <p className="text-sm text-[var(--ink-3)]">
                      {t("taskPlanner.emptyTasks")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={readOnly}
                      className="min-h-[var(--touch-min)] gap-1"
                      onClick={() => setView({ kind: "newTask" })}
                    >
                      <Plus size={16} /> {t("taskPlanner.newTask")}
                    </Button>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {upcoming.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold">
                              {plotName(task.plot_id)}
                            </span>
                            <TaskStatusBadge status={task.status} />
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-3)]">
                            {[
                              taskOperationLabel(t, task.operation_type),
                              recipeName(task.recipe_id),
                              task.target_pest_or_disease,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-4)]">
                            {[
                              task.planned_date
                                ? new Date(task.planned_date).toLocaleDateString(
                                    "it-IT",
                                  )
                                : t("taskPlanner.noDate"),
                              task.operator_name,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => setView({ kind: "editTask", id: task.id })}
                            aria-label={t("taskPlanner.action.edit")}
                            title={t("taskPlanner.action.edit")}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => void handleCancelTask(task)}
                            aria-label={t("taskPlanner.action.cancel")}
                            title={t("taskPlanner.action.cancel")}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--warn)] hover:bg-[var(--warn-l)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <XCircle size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => void handleDeleteTask(task.id)}
                            aria-label={t("taskPlanner.action.delete")}
                            title={t("taskPlanner.action.delete")}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <details
                  open={historyOpen}
                  onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2"
                >
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                    {t("taskPlanner.history.title")} ({history.length})
                  </summary>
                  {history.length === 0 ? (
                    <p className="py-2 text-center text-xs text-[var(--ink-3)]">
                      {t("taskPlanner.history.empty")}
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {history.map((task) => (
                        <li
                          key={task.id}
                          className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] p-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold">
                              {plotName(task.plot_id)}
                              <TaskStatusBadge status={task.status} />
                            </span>
                            <span className="block truncate text-[11px] text-[var(--ink-3)]">
                              {taskOperationLabel(t, task.operation_type)}
                              {task.planned_date
                                ? ` · ${new Date(task.planned_date).toLocaleDateString("it-IT")}`
                                : ""}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {activeRecipes.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <p className="text-sm text-[var(--ink-3)]">
                      {t("taskPlanner.emptyRecipes")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={readOnly}
                      className="min-h-[var(--touch-min)] gap-1"
                      onClick={() => setView({ kind: "newRecipe" })}
                    >
                      <Plus size={16} /> {t("taskPlanner.newRecipe")}
                    </Button>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeRecipes.map((recipe) => (
                      <li
                        key={recipe.id}
                        className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-semibold">{recipe.name}</span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-3)]">
                            {[
                              recipe.operation_type
                                ? taskOperationLabel(t, recipe.operation_type)
                                : null,
                              recipe.target_disease,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-4)]">
                            {recipeDoseSummary(recipe, t)}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() =>
                              setView({ kind: "editRecipe", id: recipe.id })
                            }
                            aria-label={t("taskPlanner.action.edit")}
                            title={t("taskPlanner.action.edit")}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => void handleDeleteRecipe(recipe.id)}
                            aria-label={t("taskPlanner.action.delete")}
                            title={t("taskPlanner.action.delete")}
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {(view.kind === "newTask" || view.kind === "editTask") && (
          <TaskForm
            key={view.kind === "editTask" ? view.id : "new"}
            existing={
              view.kind === "editTask"
                ? (plannedTasks.find((pt) => pt.id === view.id) ?? null)
                : null
            }
            defaultPlotId={view.kind === "newTask" ? defaultPlotId : undefined}
            onCancel={() => {
              setDefaultPlotId("");
              setView({ kind: "list" });
            }}
            onSaved={() => {
              setDefaultPlotId("");
              setView({ kind: "list" });
            }}
          />
        )}

        {(view.kind === "newRecipe" || view.kind === "editRecipe") && (
          <RecipeForm
            key={view.kind === "editRecipe" ? view.id : "new"}
            existing={
              view.kind === "editRecipe"
                ? (recipes.find((r) => r.id === view.id) ?? null)
                : null
            }
            onCancel={() => setView({ kind: "list" })}
            onSaved={() => setView({ kind: "list" })}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
        active
          ? "border-[var(--accent)] text-[var(--accent)]"
          : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Riepilogo sintetico delle dosi di una ricetta: N prodotti + totale per unità. */
function recipeDoseSummary(recipe: Recipe, t: TFunction): string {
  if (recipe.products.length === 0) return "";
  const totals = new Map<string, number>();
  for (const p of recipe.products) {
    totals.set(p.unit, (totals.get(p.unit) ?? 0) + p.dose_per_ha);
  }
  const dosePart = Array.from(totals.entries())
    .map(([unit, total]) => `${total} ${unit}`)
    .join(" + ");
  return `${t("taskPlanner.productCount", { count: recipe.products.length })} · ${dosePart}`;
}
