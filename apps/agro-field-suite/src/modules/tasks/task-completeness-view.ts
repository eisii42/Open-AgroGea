import {
  type CompletenessField,
  evaluateLogCompleteness,
  evaluateTaskCompleteness,
  type OperationType,
  type PlannedTask,
  type Recipe,
  toIsoString,
  type TreatmentLog,
} from "@agrogea/core";
import type { TFunction } from "i18next";

/**
 * Vista app del motore di completezza (`@agrogea/core` `field/task-completeness.ts`):
 * converte gli array di dominio dello store (task programmate, ricette, righe
 * del Quaderno) nelle voci del cruscotto "Record incompleti" del Riquadro
 * Pianificazione — stesso ruolo di `modules/machinery/machinery-view.ts`
 * (`buildAttentionEntries`) per il cruscotto "Richiede attenzione" del Parco
 * macchine: il motore PURO sta nel package di dominio, la vista che aggrega
 * più slice dello store e prepara le etichette per la UI sta qui.
 */

export type CompletenessSubjectKind = "plannedTask" | "treatmentLog";

/** Voce actionable del cruscotto "Record incompleti": solo i campi `blocking` (i `resolvedAtExecution` non sono un'azione da compiere ora, vedi il motore). */
export interface CompletenessAttentionEntry {
  kind: CompletenessSubjectKind;
  /** Id della planned_task o del treatment_log interessato (navigazione al dettaglio). */
  refId: string;
  plotId: string | null;
  operationType: OperationType;
  /** ISO: `planned_date` della task (null se non ancora pianificata), o `executed_at` della riga già registrata. */
  date: string | null;
  missing: CompletenessField[];
}

export interface CompletenessAttentionInput {
  plannedTasks: PlannedTask[];
  recipes: Recipe[];
  treatments: TreatmentLog[];
  operatorName?: string | null;
  operatorLicenseNumber?: string | null;
}

/**
 * Aggrega le task PROGRAMMATE (status PLANNED/IN_PROGRESS: quelle ancora "in
 * volo" verso il Quaderno) e le righe del Quaderno già registrate che
 * risultano incomplete. Esclusioni deliberate:
 *  - task soft-cancellate (`deleted_at`) o CANCELLED: non produrranno mai un
 *    record, non c'è nulla da completare;
 *  - task COMPLETED: la fonte di verità è ormai il `treatment_log` scritto
 *    alla chiusura della sessione (step futuro), non la task esaurita — è
 *    quel log, se presente fra `treatments`, a comparire nell'elenco;
 *  - righe del Quaderno soft-cancellate (`deleted_at`).
 */
export function buildTaskCompletenessEntries(
  input: CompletenessAttentionInput,
): CompletenessAttentionEntry[] {
  const recipeById = new Map(input.recipes.map((r) => [r.id, r]));
  const context = {
    operatorName: input.operatorName,
    operatorLicenseNumber: input.operatorLicenseNumber,
  };
  const entries: CompletenessAttentionEntry[] = [];

  for (const task of input.plannedTasks) {
    if (task.deleted_at != null) continue;
    if (task.status !== "PLANNED" && task.status !== "IN_PROGRESS") continue;
    const recipe = task.recipe_id ? (recipeById.get(task.recipe_id) ?? null) : null;
    const result = evaluateTaskCompleteness(task, recipe, context);
    const blocking = result.missing.filter((m) => m.severity === "blocking");
    if (blocking.length === 0) continue;
    entries.push({
      kind: "plannedTask",
      refId: task.id,
      plotId: task.plot_id,
      operationType: task.operation_type,
      date: task.planned_date,
      missing: blocking,
    });
  }

  for (const log of input.treatments) {
    if (log.deleted_at != null) continue;
    const result = evaluateLogCompleteness(log);
    const blocking = result.missing.filter((m) => m.severity === "blocking");
    if (blocking.length === 0) continue;
    entries.push({
      kind: "treatmentLog",
      refId: log.id,
      plotId: log.plot_id,
      operationType: log.operation_type,
      // Normalizzata: le row rilette da PGlite portano un `Date` anche dove il
      // tipo dichiara una stringa ISO, e questa voce viene formattata dalla UI.
      date: toIsoString(log.executed_at),
      missing: blocking,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Etichette dei campi mancanti (riuso delle chiavi i18n già esistenti: gli
// stessi campi sono già etichettati altrove nell'app — Quaderno, form task —
// niente nuove chiavi duplicate per lo stesso concetto).
// ---------------------------------------------------------------------------

const FIELD_LABEL_KEYS: Record<string, string> = {
  plot_id: "taskForm.plot",
  operation_type: "taskForm.operationTypeLabel",
  operator_name: "taskForm.operatorName",
  target_disease: "taskForm.targetPestOrDisease",
  product_name: "recipeForm.product",
  registration_number: "logbook.treatment.regNumber",
  active_substance: "logbook.treatment.activeSubstance",
  dose_value: "logbook.treatment.dose",
  dose_unit: "logbook.treatment.unit",
  license_number: "logbook.treatment.license",
  fertilizer_type: "logbook.fertilization.type",
  npk_ratio: "logbook.fertilization.npk",
  total_quantity: "operationForm.totalQuantityKg",
  executed_at: "operationForm.date",
};

/** `products[1].registration_number` → indice 1-based + nome campo, per le ricette multi-prodotto (vedi task-completeness.ts). */
const PRODUCT_INDEX_RE = /^products\[(\d+)\]\.(.+)$/;

/** Etichetta tradotta di un campo mancante (`CompletenessField.field`), pronta per l'elenco della UI. */
export function completenessFieldLabel(t: TFunction, field: string): string {
  const match = PRODUCT_INDEX_RE.exec(field);
  const baseField = match ? match[2] : field;
  const key = FIELD_LABEL_KEYS[baseField];
  const label = key ? t(key as never) : baseField;
  if (!match) return label;
  return t("taskCompleteness.panel.productField", {
    index: Number(match[1]) + 1,
    field: label,
  });
}
