import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import { composeSessionLogs } from "../packages/agro-core/src/field/session-logbook";
import type {
  FieldOperationSession,
  PlannedTaskMetadata,
  Product,
  ProductLot,
} from "../packages/agro-core/src/types";

/**
 * Pianificazione allineata al Quaderno di Campagna: i campi che una task chiede
 * sono quelli che il Quaderno chiederebbe per lo stesso tipo di operation, e i
 * valori già pianificati si riversano nella row del registro invece di essere
 * ridigitati a bordo campo.
 *
 * La derivazione della specifica (`modules/tasks/task-field-spec.ts`) non è
 * testata qui perché importa un componente React; le sue regole sono però
 * verificate indirettamente dal contratto che segue — quali campi finiscono nel
 * `metadata` e come vengono consumati.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

class TestDal extends AgroDal {
  /** Connessione grezza: `exec` accetta lo schema multi-statement, `query` no. */
  raw!: PGlite;

  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const dal = new TestDal(db, TENANT, "device-test");
    dal.raw = db;
    return dal;
  }
}

async function seedCompany(dal: TestDal): Promise<string> {
  const company = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name)
     values (gen_random_uuid(), $1, 'Company Test') returning id`,
    [TENANT],
  );
  return company.rows[0].id;
}

async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 5)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

/** Sessione con 2 ha realmente percorsi (contro i 5 ha catastali del plot). */
async function seedSession(
  dal: TestDal,
  companyId: string,
  plotId: string,
  taskId: string | null,
  operationType: "tillage" | "irrigation" | "sowing",
): Promise<FieldOperationSession> {
  const session = await dal.startFieldSession({
    company_id: companyId,
    planned_task_id: taskId,
    plot_id: plotId,
    operation_type: operationType,
    recipe_id: null,
    machine_id: null,
    equipment_id: null,
    working_width_m: 4,
    operator_name: null,
    notes: null,
  });
  return (
    (await dal.updateFieldSession(session.id, { area_worked_ha: 2 })) ?? session
  );
}

function contextFor(
  session: FieldOperationSession,
  taskMetadata: PlannedTaskMetadata,
) {
  return {
    session,
    plot: { id: session.plot_id, area_ha: 5 },
    recipe: null,
    task: null,
    taskMetadata,
    plotCampaignId: null,
    operator: {},
    products: [] as Product[],
    lots: [] as ProductLot[],
  };
}

// ---------------------------------------------------------------------------
// 1. Il metadata sopravvive al round-trip (schema v20, migrazione additiva)
// ---------------------------------------------------------------------------

describe("pianificazione per tipo / metadata della task", () => {
  it("il metadata torna un oggetto reale e le task pre-v20 leggono {}", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    const withMeta = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "irrigation",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: null,
      operator_name: null,
      notes: null,
      metadata: { irrigation_amount: 25, irrigation_unit: "mm" },
    });
    const reread = await dal.getPlannedTask(withMeta.id);
    assert.equal(typeof reread?.metadata, "object");
    assert.equal(reread?.metadata.irrigation_amount, 25);
    assert.equal(reread?.metadata.irrigation_unit, "mm");

    // Task senza metadata: default '{}' dello schema, non null.
    const withoutMeta = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "sampling",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: null,
      operator_name: null,
      notes: null,
      metadata: {},
    });
    const bare = await dal.getPlannedTask(withoutMeta.id);
    assert.deepEqual(bare?.metadata, {});
  });

  it("la migrazione additiva non tocca le task già esistenti", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: null,
      operator_name: null,
      notes: null,
      metadata: { tillage_type: "Aratura" },
    });

    // Riesecuzione dell'intero schema: idempotente, dati intatti.
    await dal.raw.exec(AGRO_LOCAL_SCHEMA_SQL);
    const reread = await dal.getPlannedTask(task.id);
    assert.equal(reread?.metadata.tillage_type, "Aratura");
  });
});

// ---------------------------------------------------------------------------
// 2. I campi pianificati arrivano nel Quaderno senza essere ridigitati
// ---------------------------------------------------------------------------

describe("pianificazione per tipo / riversamento nel Quaderno", () => {
  it("lavorazione: il tipo pianificato diventa il product_name della row", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null, "tillage");

    const composition = composeSessionLogs(
      contextFor(session, { tillage_type: "Aratura profonda" }),
    );
    assert.equal(composition.drafts.length, 1);
    assert.equal(composition.drafts[0].input.product_name, "Aratura profonda");
    assert.equal(composition.drafts[0].input.dose_value, null);
  });

  it("irrigazione: l'apporto in mm diventa water_volume_l sulla superficie GPS", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null, "irrigation");

    const composition = composeSessionLogs(
      contextFor(session, { irrigation_amount: 10, irrigation_unit: "mm" }),
    );
    // 10 mm su 2 ha REALI = 200 000 L. Sui 5 ha catastali sarebbero 500 000.
    assert.equal(composition.areaUsedHa, 2);
    assert.equal(composition.drafts[0].input.water_volume_l, 200_000);
  });

  it("irrigazione in hl: volume assoluto, indipendente dalla superficie", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null, "irrigation");

    const composition = composeSessionLogs(
      contextFor(session, { irrigation_amount: 30, irrigation_unit: "hl" }),
    );
    assert.equal(composition.drafts[0].input.water_volume_l, 3_000);
  });

  it("semina: semente e dose pianificate diventano product, dose e quantità totale", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null, "sowing");

    const composition = composeSessionLogs(
      contextFor(session, {
        seed_product_name: "Frumento Bologna",
        seed_dose: 220,
        seed_dose_unit: "kg/ha",
      }),
    );
    const row = composition.drafts[0].input;
    assert.equal(row.product_name, "Frumento Bologna");
    assert.equal(row.dose_value, 220);
    assert.equal(row.dose_unit, "kg/ha");
    // 220 kg/ha × 2 ha GPS = 440 kg (non 1100 sui 5 ha catastali).
    assert.equal(row.total_quantity, 440);
  });

  it("senza metadata la row resta vuota come prima (nessuna regressione)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null, "sampling" as "tillage");

    const composition = composeSessionLogs(contextFor(session, {}));
    const row = composition.drafts[0].input;
    assert.equal(row.product_name, null);
    assert.equal(row.dose_value, null);
    assert.equal(row.water_volume_l, null);
    assert.equal(row.total_quantity, null);
  });

  it("il riversamento arriva fino alla row PERSISTITA nel Quaderno", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: null,
      operator_name: "Mario Rossi",
      notes: null,
      metadata: { tillage_type: "Erpicatura" },
    });
    const session = await seedSession(dal, companyId, plotId, task.id, "tillage");

    const composition = composeSessionLogs({
      ...contextFor(session, task.metadata),
      task,
    });
    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);

    const [log] = await dal.listTreatments(companyId);
    assert.equal(log.product_name, "Erpicatura");
    assert.equal(log.operator_name, "Mario Rossi");
  });
});
