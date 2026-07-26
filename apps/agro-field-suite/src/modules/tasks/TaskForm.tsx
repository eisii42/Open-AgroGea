import {
  evaluateTaskCompleteness,
  loadOperatorMemory,
  type OperationType,
  persistOperatorMemory,
  type PlannedTask,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { AlertTriangle } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { completenessFieldLabel } from "./task-completeness-view";

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
 * pianificata, operatore + patentino, note. Il geofencing userà lo status
 * 'PLANNED' risultante per proporre questa task all'ingresso nel field.
 *
 * Completezza del futuro record del Quaderno (Modalità Campo low-touch): la
 * chiusura della sessione a bordo campo scriverà il Quaderno SENZA alcuna
 * conferma dell'operatore, quindi qui si valuta in diretta — con lo stesso
 * motore riusato dal cruscotto "Record incompleti" del Riquadro
 * Pianificazione — se la task, così com'è, produrrebbe un record fitosanitario/
 * di fertilizzazione conforme al PAN, e si mostra un avviso non bloccante con
 * l'elenco di ciò che manca (il salvataggio resta comunque possibile: è
 * l'elenco "Record incompleti" a rendere sicuro rimandare il completamento).
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

  // Memoria per-device dell'operatore (condivisa col Quaderno, vedi
  // `field/operator-memory.ts`): il patentino non è una colonna di
  // `planned_tasks` (è un dato dell'operatore/dispositivo, non della singola
  // task) — qui si legge solo per precompilare, senza richiedere di
  // ridigitarlo se già noto da un'altra operation registrata sullo stesso device.
  const opMemory = useMemo(loadOperatorMemory, []);

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
  const [operatorName, setOperatorName] = useState(
    existing?.operator_name ?? opMemory.name ?? "",
  );
  const [licenseNumber, setLicenseNumber] = useState(opMemory.license ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Anteprima di completezza del futuro record (vedi doc-comment sopra):
  // ricalcolata a ogni modifica rilevante, sulla ricetta EFFETTIVAMENTE
  // selezionata (che porta i suoi prodotti/dosi/registrazioni).
  const selectedRecipe = recipeId ? (recipes.find((r) => r.id === recipeId) ?? null) : null;
  const completeness = useMemo(() => {
    if (operationType === "") return null;
    return evaluateTaskCompleteness(
      {
        plot_id: plotId,
        operation_type: operationType,
        target_pest_or_disease: targetPestOrDisease.trim() || null,
        operator_name: operatorName.trim() || null,
      },
      selectedRecipe,
      {
        operatorName: operatorName.trim() || null,
        operatorLicenseNumber: licenseNumber.trim() || null,
      },
    );
  }, [operationType, plotId, targetPestOrDisease, operatorName, licenseNumber, selectedRecipe]);
  const blockingMissing = completeness?.missing.filter((m) => m.severity === "blocking") ?? [];

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
      // Memoria operatore (condivisa col Quaderno): l'ultimo operatore/
      // patentino usati precompilano il prossimo form, qui o in OperationForm.
      if (operatorName.trim() || licenseNumber.trim()) {
        persistOperatorMemory({
          ...opMemory,
          name: operatorName.trim() || undefined,
          license: licenseNumber.trim() || undefined,
        });
      }
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tf-license">{t("taskForm.operatorLicenseNumber")}</Label>
          <Input
            id="tf-license"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            className="agro-num"
          />
          <p className="text-[11px] text-[var(--ink-4)]">
            {t("taskForm.operatorLicenseNumberHint")}
          </p>
        </div>
      </div>

      {blockingMissing.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          <span className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} /> {t("taskForm.completenessWarning.title")}
          </span>
          <ul className="list-disc pl-5 text-[var(--ink-2)]">
            {blockingMissing.map((m) => (
              <li key={m.field}>{completenessFieldLabel(t, m.field)}</li>
            ))}
          </ul>
        </div>
      )}

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
