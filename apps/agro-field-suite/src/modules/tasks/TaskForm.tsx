import {
  type OperationType,
  type PlannedTask,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { type FormEvent, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/**
 * Tipi operation ammessi per task/ricette (Riquadro Pianificazione): stesso
 * dominio di `treatment_logs.operation_type`, MA include anche `harvest`
 * (assente nel registro `operationForm.type.*` del Quaderno, che ha il
 * raccolto in un module a sé — `HarvestPanel`). Tenuto qui come fonte unica
 * per TaskForm/RecipeForm/TaskPlannerPanel: evita di duplicare 7 label in tre
 * file diversi.
 */
export const TASK_OPERATION_TYPES: OperationType[] = [
  "phytosanitary",
  "fertilization",
  "irrigation",
  "tillage",
  "sowing",
  "harvest",
  "sampling",
];

/** Etichetta i18n di un tipo operation nel dominio Task/Ricette. */
export function taskOperationLabel(t: TFunction, type: OperationType): string {
  return t(`taskForm.operationType.${type}` as never);
}

/**
 * Form di creazione/modifica di una task programmata (`planned_tasks`):
 * plot + tipo operation (obbligatori), ricetta suggerita (filtrata sul tipo
 * operation quando impostato), avversità/patogeno bersaglio, data
 * pianificata, operatore, note. Il geofencing userà lo status
 * 'PLANNED' risultante per proporre questa task all'ingresso nel field.
 */
export function TaskForm({
  existing,
  defaultPlotId,
  onCancel,
  onSaved,
}: {
  /** null/undefined = creazione; valorizzato = modifica. */
  existing?: PlannedTask | null;
  /** Plot pre-selezionato in creazione (click "Pianifica task" sul field in mappa). */
  defaultPlotId?: string;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const recipes = useAgroStore((s) => s.recipes);
  const savePlannedTask = useAgroStore((s) => s.savePlannedTask);

  const [plotId, setPlotId] = useState(existing?.plot_id ?? defaultPlotId ?? "");
  const [operationType, setOperationType] = useState<OperationType | "">(
    existing?.operation_type ?? "",
  );
  const [recipeId, setRecipeId] = useState(existing?.recipe_id ?? "");
  const [targetPestOrDisease, setTargetPestOrDisease] = useState(
    existing?.target_pest_or_disease ?? "",
  );
  const [plannedDate, setPlannedDate] = useState(
    existing?.planned_date ? existing.planned_date.slice(0, 10) : "",
  );
  const [operatorName, setOperatorName] = useState(existing?.operator_name ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const availableRecipes = recipes.filter(
    (r) =>
      r.deleted_at == null &&
      (operationType === "" ||
        r.operation_type == null ||
        r.operation_type === operationType),
  );

  const plotMissing = plotId.trim() === "";
  const operationMissing = operationType === "";
  const invalid = plotMissing || operationMissing;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (saving || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const record = await savePlannedTask({
        id: existing?.id,
        plot_id: plotId,
        operation_type: operationType,
        recipe_id: recipeId || null,
        target_pest_or_disease: targetPestOrDisease.trim() || null,
        planned_date: plannedDate || null,
        operator_name: operatorName.trim() || null,
        notes: notes.trim() || null,
      });
      if (!record) return;
      onSaved(record.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-plot">{t("taskForm.plot")}</Label>
          <Select
            id="tf-plot"
            value={plotId}
            onChange={(e) => setPlotId(e.target.value)}
          >
            <option value="">{t("taskForm.plotPlaceholder")}</option>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.user_plot_name} · {p.area_ha.toFixed(2)} ha
              </option>
            ))}
          </Select>
          {submitAttempted && plotMissing && (
            <p className="text-[11px] text-[var(--danger)]">
              {t("taskForm.plotRequired")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-operation">{t("taskForm.operationTypeLabel")}</Label>
          <Select
            id="tf-operation"
            value={operationType}
            onChange={(e) => {
              const next = e.target.value as OperationType | "";
              setOperationType(next);
              // La ricetta scelta può non essere più coerente col nuovo tipo.
              if (
                recipeId &&
                next !== "" &&
                recipes.find((r) => r.id === recipeId)?.operation_type != null &&
                recipes.find((r) => r.id === recipeId)?.operation_type !== next
              ) {
                setRecipeId("");
              }
            }}
          >
            <option value="">{t("taskForm.operationTypePlaceholder")}</option>
            {TASK_OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {taskOperationLabel(t, type)}
              </option>
            ))}
          </Select>
          {submitAttempted && operationMissing && (
            <p className="text-[11px] text-[var(--danger)]">
              {t("taskForm.operationTypeRequired")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tf-recipe">{t("taskForm.recipe")}</Label>
        <Select
          id="tf-recipe"
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
        >
          <option value="">{t("taskForm.noRecipe")}</option>
          {availableRecipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-target">{t("taskForm.targetPestOrDisease")}</Label>
          <Input
            id="tf-target"
            value={targetPestOrDisease}
            onChange={(e) => setTargetPestOrDisease(e.target.value)}
            placeholder={t("taskForm.targetPestOrDiseasePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-date">{t("taskForm.plannedDate")}</Label>
          <Input
            id="tf-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-operator">{t("taskForm.operatorName")}</Label>
          <Input
            id="tf-operator"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tf-notes">{t("taskForm.notes")}</Label>
        <textarea
          id="tf-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={saving}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving ? t("logbook.common.saving") : t("taskForm.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[var(--touch-min)]"
        >
          {t("logbook.common.cancel")}
        </Button>
      </div>
    </form>
  );
}
