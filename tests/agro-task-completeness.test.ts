import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompletenessField,
  type CompletenessResult,
  evaluateLogCompleteness,
  evaluateTaskCompleteness,
  type PlannedTask,
  type Recipe,
  type RecipeProduct,
  type TreatmentLog,
} from "@agrogea/core";
import { buildTaskCompletenessEntries } from "../apps/agro-field-suite/src/modules/tasks/task-completeness-view";

/**
 * Motore di completezza del Quaderno (`task-completeness.ts`, schema v19):
 * la task PROGRAMMATA e la ricetta agganciata "guarderebbero" a un record
 * conforme se scritte oggi nel Quaderno? Copre le due direzioni del motore
 * (pianificazione via {@link evaluateTaskCompleteness}, audit via
 * {@link evaluateLogCompleteness}) e l'aggregato app che alimenta il badge
 * contatore/il cruscotto "Record incompleti" ({@link buildTaskCompletenessEntries}).
 */

function makeTask(overrides: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: "task-1",
    tenant_id: "t",
    company_id: "c",
    plot_id: "plot-1",
    operation_type: "phytosanitary",
    recipe_id: null,
    target_pest_or_disease: "Peronospora",
    status: "PLANNED",
    planned_date: "2026-08-01",
    operator_name: "Mario Rossi",
    notes: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeRecipe(products: RecipeProduct[], overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    tenant_id: "t",
    company_id: "c",
    name: "Ricetta test",
    operation_type: "phytosanitary",
    products,
    target_disease: null,
    notes: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeLog(overrides: Partial<TreatmentLog> = {}): TreatmentLog {
  return {
    id: "log-1",
    tenant_id: "t",
    company_id: "c",
    plot_id: "plot-1",
    plot_campaign_id: null,
    operation_type: "phytosanitary",
    product_name: "Poltiglia bordolese",
    registration_number: "12345",
    dose_value: 3,
    dose_unit: "kg/ha",
    total_quantity: 6,
    target_disease: "Peronospora",
    operator_name: "Mario Rossi",
    machinery_equipment: null,
    active_substance: "Rame",
    water_volume_l: null,
    operator_tax_code: null,
    license_number: "PAT-9",
    fertilizer_type: null,
    npk_ratio: null,
    executed_at: "2026-08-01T09:00:00.000Z",
    reentry_interval_h: null,
    safety_period_days: null,
    weather_conditions: null,
    note: null,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T09:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

const fullPhytoProduct: RecipeProduct = {
  product_id: "p1",
  product_name: "Poltiglia bordolese",
  dose_per_ha: 3,
  unit: "kg/ha",
  active_substance: "Rame",
  registration_number: "12345",
};

const fullFertProduct: RecipeProduct = {
  product_id: "p2",
  product_name: "Nitrophoska",
  dose_per_ha: 300,
  unit: "kg/ha",
  fertilizer_type: "minerale",
  npk_ratio: "15-15-15",
};

/** Solo i campi `blocking` di un risultato, ordinati (i `resolvedAtExecution` non sono un'azione da compiere ora). */
function blockingFields(result: CompletenessResult): string[] {
  return result.missing
    .filter((m: CompletenessField) => m.severity === "blocking")
    .map((m) => m.field)
    .sort();
}

// ---------------------------------------------------------------------------
// 1) Task fitosanitaria completa (+ ricetta) → nessun fondamentale mancante
// ---------------------------------------------------------------------------

describe("Completezza task / fitosanitari — record completo", () => {
  it("una task completa con ricetta e patentino noto non riporta fondamentali bloccanti", () => {
    const result = evaluateTaskCompleteness(makeTask(), makeRecipe([fullPhytoProduct]), {
      operatorLicenseNumber: "PAT-9",
    });
    assert.equal(result.complete, true);
    assert.deepEqual(blockingFields(result), []);
  });
});

// ---------------------------------------------------------------------------
// 2) Ogni singolo campo PAN mancante è segnalato con l'identificatore giusto
// ---------------------------------------------------------------------------

describe("Completezza task / fitosanitari — campi PAN singolarmente mancanti", () => {
  it("segnala target_disease mancante (né sulla task né sulla ricetta)", () => {
    const task = makeTask({ target_pest_or_disease: null });
    const recipe = makeRecipe([fullPhytoProduct], { target_disease: null });
    const result = evaluateTaskCompleteness(task, recipe, { operatorLicenseNumber: "PAT-9" });
    assert.deepEqual(blockingFields(result), ["target_disease"]);
  });

  it("segnala product_name mancante", () => {
    const recipe = makeRecipe([{ ...fullPhytoProduct, product_name: "" }]);
    const result = evaluateTaskCompleteness(makeTask(), recipe, { operatorLicenseNumber: "PAT-9" });
    assert.deepEqual(blockingFields(result), ["product_name"]);
  });

  it("segnala registration_number (n. di registrazione) mancante", () => {
    const recipe = makeRecipe([{ ...fullPhytoProduct, registration_number: null }]);
    const result = evaluateTaskCompleteness(makeTask(), recipe, { operatorLicenseNumber: "PAT-9" });
    assert.deepEqual(blockingFields(result), ["registration_number"]);
  });

  it("segnala active_substance (sostanza attiva) mancante", () => {
    const recipe = makeRecipe([{ ...fullPhytoProduct, active_substance: null }]);
    const result = evaluateTaskCompleteness(makeTask(), recipe, { operatorLicenseNumber: "PAT-9" });
    assert.deepEqual(blockingFields(result), ["active_substance"]);
  });

  it("segnala dose_value (dose/ha non positiva) mancante", () => {
    const recipe = makeRecipe([{ ...fullPhytoProduct, dose_per_ha: 0 }]);
    const result = evaluateTaskCompleteness(makeTask(), recipe, { operatorLicenseNumber: "PAT-9" });
    assert.deepEqual(blockingFields(result), ["dose_value"]);
  });

  it("segnala license_number (patentino) mancante quando il contesto/la memoria di device non lo conosce", () => {
    const result = evaluateTaskCompleteness(makeTask(), makeRecipe([fullPhytoProduct]), {
      operatorLicenseNumber: null,
    });
    assert.deepEqual(blockingFields(result), ["license_number"]);
  });

  it("senza alcuna ricetta agganciata riporta tutti i campi prodotto/PAN mancanti", () => {
    const task = makeTask({ recipe_id: null, target_pest_or_disease: null });
    const result = evaluateTaskCompleteness(task, null, { operatorLicenseNumber: null });
    assert.deepEqual(
      blockingFields(result),
      [
        "active_substance",
        "dose_unit",
        "dose_value",
        "license_number",
        "product_name",
        "registration_number",
        "target_disease",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 3) "Mancante ora" vs "si risolve da sé" — il crux dell'incremento
// ---------------------------------------------------------------------------

describe("Completezza task / valori noti solo a esecuzione", () => {
  it("in pianificazione total_quantity ed executed_at sono sempre resolvedAtExecution, mai bloccanti", () => {
    const result = evaluateTaskCompleteness(makeTask(), makeRecipe([fullPhytoProduct]), {
      operatorLicenseNumber: "PAT-9",
    });
    assert.equal(result.complete, true);
    const totalQuantity = result.missing.find((m) => m.field === "total_quantity");
    const executedAt = result.missing.find((m) => m.field === "executed_at");
    assert.equal(totalQuantity?.severity, "resolvedAtExecution");
    assert.equal(executedAt?.severity, "resolvedAtExecution");
  });

  it("in audit una riga già registrata senza total_quantity è incompleta (bloccante)", () => {
    const result = evaluateLogCompleteness(makeLog({ total_quantity: null }));
    assert.equal(result.complete, false);
    const entry = result.missing.find((m) => m.field === "total_quantity");
    assert.equal(entry?.severity, "blocking");
  });

  it("in audit una riga già registrata CON total_quantity valorizzato è completa", () => {
    const result = evaluateLogCompleteness(makeLog());
    assert.equal(result.complete, true);
  });
});

// ---------------------------------------------------------------------------
// 4) Fertilizzazioni — le regole passano per validateFertilizationLog
// ---------------------------------------------------------------------------

describe("Completezza task / fertilizzazioni", () => {
  it("una ricetta di fertilizzazione completa non riporta campi bloccanti", () => {
    const task = makeTask({ operation_type: "fertilization" });
    const recipe = makeRecipe([fullFertProduct], { operation_type: "fertilization" });
    const result = evaluateTaskCompleteness(task, recipe, {});
    assert.equal(result.complete, true);
  });

  it("un titolo N-P-K in formato errato è segnalato con la chiave di validateFertilizationLog", () => {
    const task = makeTask({ operation_type: "fertilization" });
    const recipe = makeRecipe([{ ...fullFertProduct, npk_ratio: "15-15" }], {
      operation_type: "fertilization",
    });
    const result = evaluateTaskCompleteness(task, recipe, {});
    const entry = result.missing.find((m) => m.field === "npk_ratio");
    assert.equal(entry?.severity, "blocking");
    assert.equal(entry?.messageKey, "validation.npkFormat");
  });

  it("un tipo di concime non ammesso è segnalato con la chiave di validateFertilizationLog", () => {
    const task = makeTask({ operation_type: "fertilization" });
    const recipe = makeRecipe([{ ...fullFertProduct, fertilizer_type: "sintetico" }], {
      operation_type: "fertilization",
    });
    const result = evaluateTaskCompleteness(task, recipe, {});
    const entry = result.missing.find((m) => m.field === "fertilizer_type");
    assert.equal(entry?.severity, "blocking");
    assert.equal(entry?.messageKey, "validation.invalidFertilizerType");
  });
});

// ---------------------------------------------------------------------------
// 5) Tipi operation senza regole PAN — fondamentali "leggeri"
// ---------------------------------------------------------------------------

describe("Completezza task / tipi senza regole PAN", () => {
  it("un'irrigazione con field, tipo e operatore non riporta fondamentali mancanti", () => {
    const task = makeTask({ operation_type: "irrigation", target_pest_or_disease: null });
    const result = evaluateTaskCompleteness(task, null, {});
    assert.equal(result.complete, true);
  });

  it("un'irrigazione senza operatore (né su task né su memoria device) riporta solo il fondamentale operatore", () => {
    const task = makeTask({ operation_type: "irrigation", operator_name: null });
    const result = evaluateTaskCompleteness(task, null, {});
    assert.deepEqual(blockingFields(result), ["operator_name"]);
  });

  it("l'operatore noto dalla memoria di device basta anche se la task non lo specifica direttamente", () => {
    const task = makeTask({ operation_type: "irrigation", operator_name: null });
    const result = evaluateTaskCompleteness(task, null, { operatorName: "Mario Rossi" });
    assert.equal(result.complete, true);
  });

  it("in audit un log 'leggero' senza plot e operatore riporta entrambi i fondamentali", () => {
    const log = makeLog({
      operation_type: "tillage",
      plot_id: null,
      operator_name: null,
      product_name: "Aratura",
      registration_number: null,
      active_substance: null,
      dose_value: null,
      dose_unit: null,
      target_disease: null,
      license_number: null,
    });
    const result = evaluateLogCompleteness(log);
    assert.deepEqual(blockingFields(result), ["operator_name", "plot_id"]);
  });
});

// ---------------------------------------------------------------------------
// 6) Aggregato per il badge contatore/cruscotto — filtri di dominio
// ---------------------------------------------------------------------------

describe("Completezza task / aggregato buildTaskCompletenessEntries", () => {
  it("conta le task e le righe incomplete, ignorando cancellate, soft-delete e completate", () => {
    const plannedTasks: PlannedTask[] = [
      makeTask({
        id: "t-incomplete",
        status: "PLANNED",
        operation_type: "phytosanitary",
        recipe_id: null,
        target_pest_or_disease: null,
      }),
      makeTask({
        id: "t-complete",
        status: "PLANNED",
        operation_type: "irrigation",
        operator_name: "Mario Rossi",
      }),
      makeTask({
        id: "t-cancelled",
        status: "CANCELLED",
        operation_type: "phytosanitary",
        recipe_id: null,
        target_pest_or_disease: null,
      }),
      makeTask({
        id: "t-deleted",
        status: "PLANNED",
        operation_type: "phytosanitary",
        recipe_id: null,
        target_pest_or_disease: null,
        deleted_at: "2026-01-01T00:00:00.000Z",
      }),
      makeTask({
        id: "t-completed",
        status: "COMPLETED",
        operation_type: "phytosanitary",
        recipe_id: null,
        target_pest_or_disease: null,
      }),
    ];
    const treatments: TreatmentLog[] = [
      makeLog({ id: "log-incomplete", total_quantity: null }),
      makeLog({ id: "log-complete" }),
      makeLog({
        id: "log-deleted",
        total_quantity: null,
        deleted_at: "2026-01-01T00:00:00.000Z",
      }),
    ];

    const entries = buildTaskCompletenessEntries({
      plannedTasks,
      recipes: [],
      treatments,
      operatorName: null,
      operatorLicenseNumber: null,
    });

    assert.deepEqual(
      entries.filter((e) => e.kind === "plannedTask").map((e) => e.refId),
      ["t-incomplete"],
    );
    assert.deepEqual(
      entries.filter((e) => e.kind === "treatmentLog").map((e) => e.refId),
      ["log-incomplete"],
    );
  });
});
