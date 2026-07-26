/**
 * Motore di completezza del Quaderno di Campagna, PURO (nessun DOM/React):
 * risponde alla domanda "questa task pianificata (o questa riga già
 * registrata) produrrebbe/è un record conforme del Quaderno di Campagna, e se
 * no, cosa manca?". È la base della Modalità Campo low-touch: dato che il
 * futuro riepilogo automatico chiude la sessione a bordo campo SENZA alcuna
 * conferma dell'operatore (zero tap, vedi il modulo `field-mode`), ogni campo
 * che serve al record deve essere raccolto in fase di pianificazione — o
 * segnalato come mancante mentre c'è ancora tempo per completarlo.
 *
 * Riusa le regole PAN esistenti ({@link validateTreatmentLog}/
 * {@link validateFertilizationLog} di `pan-validation.ts`) invece di
 * duplicarle: mappa i campi di dominio (`PlannedTask`/`Recipe`/
 * `TreatmentLog`, nomi/columns reali) sui draft dei validatori (pensati per il
 * form del Quaderno), poi ri-mappa gli eventuali errori sulle columns reali di
 * `treatment_logs` — così l'identificatore di campo (`field`) restituito è lo
 * STESSO sia che si stia valutando una task ancora da pianificare sia una riga
 * già registrata (vedi {@link TREATMENT_FIELD_MAP}/{@link FERTILIZATION_FIELD_MAP}).
 *
 * CRUX dell'incremento — "mancante ora" vs "si risolve da sé": alcuni campi
 * del record finale si conoscono SOLO all'esecuzione. Il caso principale è
 * `total_quantity` = dose × area REALMENTE lavorata, derivata dal tracciato
 * GPS della sessione a bordo campo — non dalla area catastale del plot, che
 * può differire (il perimetro effettivamente trattato è quasi sempre minore).
 * Segnalarlo come "mancante" già in pianificazione sarebbe un falso allarme e
 * contraddirebbe l'obiettivo low-touch (l'operatore non deve rincorrere un
 * dato che non può ancora conoscere). Questi campi hanno perciò
 * `severity: "resolvedAtExecution"` quando si valuta una {@link PlannedTask},
 * e tornano `"blocking"` (se davvero assenti) quando si fa l'audit di un
 * {@link TreatmentLog} già registrato, perché a quel punto l'esecuzione è
 * avvenuta e quel dato dovrebbe esserci.
 */

import type {
  PlannedTask,
  Recipe,
  RecipeProduct,
  TreatmentLog,
} from "../types";
import {
  type FertilizationDraft,
  type TreatmentDraft,
  validateFertilizationLog,
  validateTreatmentLog,
} from "./pan-validation";

/**
 * Urgenza di un campo mancante: `blocking` va segnalato SUBITO al chiamante
 * (pianificazione o audit, a seconda del caso); `resolvedAtExecution` è un
 * dato che la Modalità Campo valorizza da sola alla chiusura della sessione a
 * bordo campo (quantità/area derivate dal GPS) — non un'azione da chiedere
 * ora all'operatore, quindi mai da mostrare nell'avviso di pianificazione.
 */
export type CompletenessSeverity = "blocking" | "resolvedAtExecution";

/** Campo mancante (o non ancora determinabile) per un record del Quaderno. */
export interface CompletenessField {
  /** Nome del campo nello spazio di `treatment_logs` (stabile fra task e log). */
  field: string;
  /** Chiave i18n del messaggio (namespace `validation`, riusata da pan-validation). */
  messageKey: string;
  /** Parametri di interpolazione per la stringa tradotta. */
  params?: Record<string, string | number>;
  severity: CompletenessSeverity;
}

export interface CompletenessResult {
  missing: CompletenessField[];
  /**
   * true se non ci sono campi `blocking` mancanti. I campi
   * `resolvedAtExecution` NON contano ai fini di questo flag: si valorizzano
   * da soli alla chiusura della sessione e non devono generare un avviso in
   * fase di pianificazione (vedi la nota "CRUX" sopra).
   */
  complete: boolean;
}

/**
 * Contesto disponibile in fase di pianificazione ma ESTERNO alla singola
 * task: l'operatore e il suo patentino sono un dato del DISPOSITIVO/della
 * persona che pianifica (memoria condivisa fra Quaderno e Pianificazione, vedi
 * `field/operator-memory.ts`), non una colonna di `planned_tasks` — niente
 * migrazione di schema per portarli sulla task.
 */
export interface TaskCompletenessContext {
  operatorName?: string | null;
  operatorLicenseNumber?: string | null;
}

/**
 * Sottoinsieme di {@link PlannedTask} che il motore legge davvero: permette di
 * valutare anche una bozza di form non ancora salvata (`TaskForm`), senza
 * dover inventare id/timestamp fittizi per soddisfare il tipo completo.
 */
export type TaskCompletenessInput = Pick<
  PlannedTask,
  "plot_id" | "operation_type" | "target_pest_or_disease" | "operator_name"
>;

/** Sottoinsieme di {@link Recipe} che il motore legge davvero (idem, per una selezione non ancora confermata in `TaskForm`). */
export type RecipeCompletenessInput = Pick<Recipe, "products" | "target_disease">;

const isBlank = (v: string | null | undefined) => v == null || v.trim() === "";

/**
 * Data ISO fittizia ma valida: silenzia il controllo "data mancante/non
 * valida" dei validatori PAN per il campo `operation_date`, che qui è sempre
 * gestito come `resolvedAtExecution` (la data reale è `executed_at`, valorizzato
 * automaticamente alla chiusura della sessione — non necessariamente uguale
 * alla `planned_date` della task).
 */
const PLACEHOLDER_DATE = "2000-01-01";
/** Valore positivo fittizio: idem sopra, per i campi quantità `resolvedAtExecution`. */
const PLACEHOLDER_POSITIVE = 1;

/** Campi del draft fitosanitario validati UNA SOLA VOLTA per task (non per riga prodotto della ricetta). */
const TREATMENT_TASK_LEVEL_FIELDS = new Set(["target_disease", "operator_license_number"]);

/** Rimappa i nomi campo del draft `TreatmentDraft` (pan-validation.ts) sulle columns reali di `treatment_logs`. */
const TREATMENT_FIELD_MAP: Record<string, string> = {
  applied_dose: "dose_value",
  unit_of_measure: "dose_unit",
  operator_license_number: "license_number",
};
/** Idem sopra, per il draft `FertilizationDraft`. */
const FERTILIZATION_FIELD_MAP: Record<string, string> = {
  commercial_name: "product_name",
  total_amount_kg: "total_quantity",
};

function mapField(field: string, table: Record<string, string>): string {
  return table[field] ?? field;
}

function toResult(missing: CompletenessField[]): CompletenessResult {
  return { missing, complete: !missing.some((m) => m.severity === "blocking") };
}

// ---------------------------------------------------------------------------
// Fitosanitari / fertilizzazioni — delega a pan-validation.ts
// ---------------------------------------------------------------------------

/**
 * Righe prodotto su cui valutare le regole PAN: quelle della ricetta, o
 * un'unica riga "vuota" se la task non ha (ancora) una ricetta agganciata —
 * così l'assenza totale di un prodotto produce comunque l'elenco pieno dei
 * campi mancanti, invece di un risultato vuoto (che sarebbe un falso "completo").
 */
function productRows(recipe: RecipeCompletenessInput | null): (RecipeProduct | null)[] {
  if (recipe && recipe.products.length > 0) return recipe.products;
  return [null];
}

/**
 * Una ricetta può avere PIÙ righe prodotto (es. "Rame + zolfo"): il Quaderno
 * scrive un solo product/registrazione/sostanza per riga di `treatment_logs`,
 * quindi ogni riga viene validata separatamente. Con più di un prodotto il
 * `field` dell'eventuale voce mancante è prefissato con l'indice
 * (`products[1].registration_number`) per restare disambiguo; con un solo
 * prodotto (il caso comune) il prefisso si omette per restare leggibile.
 */
function evaluatePhytosanitary(
  targetDisease: string | null,
  operatorLicenseNumber: string | null | undefined,
  recipe: RecipeCompletenessInput | null,
): CompletenessField[] {
  const rows = productRows(recipe);
  const multi = rows.length > 1;
  const seenTaskLevel = new Set<string>();
  const missing: CompletenessField[] = [];

  rows.forEach((product, index) => {
    const draft: TreatmentDraft = {
      operation_date: PLACEHOLDER_DATE,
      target_disease: targetDisease,
      product_name: product?.product_name ?? null,
      registration_number: product?.registration_number ?? null,
      active_substance: product?.active_substance ?? null,
      applied_dose: product?.dose_per_ha ?? null,
      unit_of_measure: product?.unit ?? null,
      operator_license_number: operatorLicenseNumber ?? null,
    };
    for (const err of validateTreatmentLog(draft)) {
      if (err.field === "operation_date") continue; // sempre resolvedAtExecution, gestito sotto
      if (TREATMENT_TASK_LEVEL_FIELDS.has(err.field)) {
        if (seenTaskLevel.has(err.field)) continue; // identico su ogni riga: una sola voce
        seenTaskLevel.add(err.field);
        missing.push({
          field: mapField(err.field, TREATMENT_FIELD_MAP),
          messageKey: err.messageKey,
          params: err.params,
          severity: "blocking",
        });
      } else {
        const field = mapField(err.field, TREATMENT_FIELD_MAP);
        missing.push({
          field: multi ? `products[${index}].${field}` : field,
          messageKey: err.messageKey,
          params: err.params,
          severity: "blocking",
        });
      }
    }
  });

  // executed_at (data reale) e total_quantity (dose × area REALMENTE
  // lavorata) si conoscono solo alla chiusura della sessione GPS: mai
  // "mancanti" in pianificazione — vedi la nota "CRUX" in testa al file.
  missing.push({ field: "executed_at", messageKey: "validation.resolvedAtExecution", severity: "resolvedAtExecution" });
  missing.push({ field: "total_quantity", messageKey: "validation.resolvedAtExecution", severity: "resolvedAtExecution" });

  return missing;
}

/** Come {@link evaluatePhytosanitary}, ma per le regole di fertilizzazione: qui non c'è alcun campo "a livello di task" (nessun obbligo di patentino). */
function evaluateFertilization(recipe: RecipeCompletenessInput | null): CompletenessField[] {
  const rows = productRows(recipe);
  const multi = rows.length > 1;
  const missing: CompletenessField[] = [];

  rows.forEach((product, index) => {
    const draft: FertilizationDraft = {
      operation_date: PLACEHOLDER_DATE,
      fertilizer_type: product?.fertilizer_type ?? null,
      commercial_name: product?.product_name ?? null,
      total_amount_kg: PLACEHOLDER_POSITIVE,
      npk_ratio: product?.npk_ratio ?? null,
    };
    for (const err of validateFertilizationLog(draft)) {
      if (err.field === "operation_date" || err.field === "total_amount_kg") continue;
      const field = mapField(err.field, FERTILIZATION_FIELD_MAP);
      missing.push({
        field: multi ? `products[${index}].${field}` : field,
        messageKey: err.messageKey,
        params: err.params,
        severity: "blocking",
      });
    }
  });

  missing.push({ field: "executed_at", messageKey: "validation.resolvedAtExecution", severity: "resolvedAtExecution" });
  missing.push({ field: "total_quantity", messageKey: "validation.resolvedAtExecution", severity: "resolvedAtExecution" });

  return missing;
}

// ---------------------------------------------------------------------------
// Tipi operation senza regole PAN — fondamentali "leggeri"
// ---------------------------------------------------------------------------

/**
 * Il PAN (Dir. 2009/128/CE) regola solo i trattamenti fitosanitari e le
 * fertilizzazioni azotate: irrigazione, lavorazione, semina, raccolto e
 * campionamento non hanno un obbligo normativo di campi specifici. Restano
 * comunque i fondamentali minimi di un registro utilizzabile: field, tipo
 * operation, data (sempre `resolvedAtExecution`, come per i tipi PAN) e
 * operatore (qui SÌ bloccante: a differenza del patentino — un obbligo PAN
 * specifico — sapere CHI ha eseguito un'operazione non richiede una regola
 * normativa dedicata per essere un fondamentale di qualunque registro).
 */
function evaluateLightFundamentalsTask(
  task: TaskCompletenessInput,
  context: TaskCompletenessContext,
): CompletenessField[] {
  const missing: CompletenessField[] = [];
  if (isBlank(task.plot_id)) {
    missing.push({ field: "plot_id", messageKey: "validation.required", severity: "blocking" });
  }
  if (isBlank(task.operation_type)) {
    missing.push({ field: "operation_type", messageKey: "validation.required", severity: "blocking" });
  }
  if (isBlank(task.operator_name) && isBlank(context.operatorName)) {
    missing.push({ field: "operator_name", messageKey: "validation.required", severity: "blocking" });
  }
  missing.push({ field: "executed_at", messageKey: "validation.resolvedAtExecution", severity: "resolvedAtExecution" });
  return missing;
}

/** Come {@link evaluateLightFundamentalsTask}, ma sull'audit di una riga già registrata. */
function evaluateLightFundamentalsLog(
  log: Pick<TreatmentLog, "plot_id" | "operation_type" | "operator_name">,
): CompletenessField[] {
  const missing: CompletenessField[] = [];
  if (isBlank(log.plot_id)) {
    missing.push({ field: "plot_id", messageKey: "validation.required", severity: "blocking" });
  }
  if (isBlank(log.operation_type)) {
    missing.push({ field: "operation_type", messageKey: "validation.required", severity: "blocking" });
  }
  if (isBlank(log.operator_name)) {
    missing.push({ field: "operator_name", messageKey: "validation.required", severity: "blocking" });
  }
  // executed_at è NOT NULL a schema (`treatment_logs.executed_at timestamptz
  // not null`): mai realmente mancante in una riga persistita, nessun
  // controllo qui (a differenza della pianificazione, dove è sempre "in arrivo").
  return missing;
}

// ---------------------------------------------------------------------------
// Audit di una riga già registrata — fitosanitari/fertilizzazioni
// ---------------------------------------------------------------------------

function evaluatePhytosanitaryLog(log: TreatmentLog): CompletenessField[] {
  const draft: TreatmentDraft = {
    operation_date: log.executed_at.slice(0, 10),
    target_disease: log.target_disease,
    product_name: log.product_name,
    registration_number: log.registration_number,
    active_substance: log.active_substance,
    applied_dose: log.dose_value,
    unit_of_measure: log.dose_unit,
    operator_license_number: log.license_number,
  };
  const missing: CompletenessField[] = validateTreatmentLog(draft).map((err) => ({
    field: mapField(err.field, TREATMENT_FIELD_MAP),
    messageKey: err.messageKey,
    params: err.params,
    severity: "blocking" as const,
  }));
  // total_quantity non è coperto da validateTreatmentLog (che valida solo la
  // dose per ettaro): a esecuzione avvenuta deve però essere valorizzato
  // (dose × area realmente lavorata) — qui, a differenza della
  // pianificazione, va segnalato se assente.
  if (log.total_quantity == null) {
    missing.push({ field: "total_quantity", messageKey: "validation.required", severity: "blocking" });
  }
  return missing;
}

function evaluateFertilizationLog(log: TreatmentLog): CompletenessField[] {
  const draft: FertilizationDraft = {
    operation_date: log.executed_at.slice(0, 10),
    fertilizer_type: log.fertilizer_type,
    commercial_name: log.product_name,
    total_amount_kg: log.total_quantity,
    npk_ratio: log.npk_ratio,
  };
  return validateFertilizationLog(draft).map((err) => ({
    field: mapField(err.field, FERTILIZATION_FIELD_MAP),
    messageKey: err.messageKey,
    params: err.params,
    severity: "blocking" as const,
  }));
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Completezza di una task PROGRAMMATA (più l'eventuale ricetta agganciata):
 * cosa manca perché l'operazione, se scritta oggi nel Quaderno così com'è,
 * risulti un record conforme. I campi `resolvedAtExecution` (vedi il modulo)
 * non contano ai fini di {@link CompletenessResult.complete}.
 */
export function evaluateTaskCompleteness(
  task: TaskCompletenessInput,
  recipe: RecipeCompletenessInput | null,
  context: TaskCompletenessContext = {},
): CompletenessResult {
  if (task.operation_type === "phytosanitary") {
    const targetDisease = task.target_pest_or_disease ?? recipe?.target_disease ?? null;
    return toResult(evaluatePhytosanitary(targetDisease, context.operatorLicenseNumber, recipe));
  }
  if (task.operation_type === "fertilization") {
    return toResult(evaluateFertilization(recipe));
  }
  return toResult(evaluateLightFundamentalsTask(task, context));
}

/**
 * Completezza di una riga GIÀ REGISTRATA del Quaderno: stessa forma di
 * {@link evaluateTaskCompleteness}, ma qui l'esecuzione è avvenuta — i campi
 * che in pianificazione erano `resolvedAtExecution` (`total_quantity` per i
 * fitosanitari) sono ora attesi e, se assenti, sono `blocking`.
 */
export function evaluateLogCompleteness(log: TreatmentLog): CompletenessResult {
  if (log.operation_type === "phytosanitary") {
    return toResult(evaluatePhytosanitaryLog(log));
  }
  if (log.operation_type === "fertilization") {
    return toResult(evaluateFertilizationLog(log));
  }
  return toResult(evaluateLightFundamentalsLog(log));
}
