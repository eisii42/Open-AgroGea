import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";

/**
 * Pianificazione task & Modalità Campo low-touch (schema v19):
 * fondamenta dati (ricette, task programmate su plot, sessioni a bordo campo,
 * note vocali local-only). Migrazione ADDITIVA non distruttiva (le quattro
 * nuove tabelle si creano, sono idempotenti e i dati pre-esistenti
 * sopravvivono), round-trip jsonb dei products/dosi, CRUD delle task
 * programmate, avvio ATOMICO di una sessione dalla task (flip a IN_PROGRESS
 * nella stessa transazione), tracciamento outbox delle tre tabelle
 * sincronizzate e unicità della sessione attiva per azienda.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

/** Espone il costruttore protetto del DAL per i test su PGlite in-memory. */
class TestDal extends AgroDal {
  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    return new TestDal(db, TENANT, "device-test");
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

async function seedPlot(
  dal: TestDal,
  companyId: string,
  name = "Campo 1",
): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, $3, '{"type":"Polygon","coordinates":[]}'::jsonb, 2.5)
     returning id`,
    [TENANT, companyId, name],
  );
  return plot.rows[0].id;
}

/** Data ISO (YYYY-MM-DD) a `giorni` da oggi (negativo = passato). */
function relativeDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const NEW_TABLES = [
  "recipes",
  "planned_tasks",
  "field_operation_sessions",
  "field_session_audio",
];

describe("schema v19 / migrazione additiva Pianificazione task", () => {
  it("crea le quattro tabelle, è idempotente e preserva i dati pre-esistenti", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const companyId = "22222222-2222-2222-2222-222222222222";
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ($1, $2, 'Az')`,
      [companyId, TENANT],
    );
    const plot = await db.query<{ id: string }>(
      `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
       values (gen_random_uuid(), $1, $2, 'Campo pre-esistente', '{"type":"Polygon","coordinates":[]}'::jsonb, 3.1)
       returning id`,
      [TENANT, companyId],
    );
    await db.query(
      `insert into treatment_logs
         (id, tenant_id, company_id, operation_type, machinery_equipment, executed_at)
       values (gen_random_uuid(), $1, $2, 'tillage', 'Trattore pre-esistente', now())`,
      [TENANT, companyId],
    );

    // Ri-applicazione (aggiornamento di un'istanza esistente): idempotente.
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const nomi = tables.rows.map((r) => r.table_name);
    for (const t of NEW_TABLES) {
      assert.ok(nomi.includes(t), `manca la tabella ${t}`);
    }

    // I dati pre-esistenti sono INTATTI.
    const plots = await db.query<{ user_plot_name: string }>(
      `select user_plot_name from plots_registry where id = $1`,
      [plot.rows[0].id],
    );
    assert.equal(plots.rows[0].user_plot_name, "Campo pre-esistente");
    const legacy = await db.query<{ machinery_equipment: string }>(
      `select machinery_equipment from treatment_logs`,
    );
    assert.equal(legacy.rows.length, 1);
    assert.equal(legacy.rows[0].machinery_equipment, "Trattore pre-esistente");
  });
});

// ---------------------------------------------------------------------------
// Ricette: round-trip jsonb di products/dosi
// ---------------------------------------------------------------------------

describe("DAL Pianificazione task / ricette", () => {
  it("saveRecipe: i products jsonb tornano come array reale con dosi numeriche", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);

    const recipe = await dal.saveRecipe({
      company_id: companyId,
      name: "Rame + zolfo",
      operation_type: "phytosanitary",
      products: [
        {
          product_id: null,
          product_name: "Poltiglia bordolese",
          dose_per_ha: 2.5,
          unit: "kg/ha",
          active_substance: "Rame metallo",
          registration_number: null,
        },
        {
          product_id: null,
          product_name: "Zolfo bagnabile",
          dose_per_ha: 3,
          unit: "kg/ha",
        },
      ],
      target_disease: "Peronospora",
      notes: null,
    });

    assert.ok(Array.isArray(recipe.products));
    assert.equal(recipe.products.length, 2);
    assert.equal(recipe.products[0].dose_per_ha, 2.5);
    assert.equal(typeof recipe.products[0].dose_per_ha, "number");

    const [reloaded] = await dal.listRecipes(companyId);
    assert.ok(Array.isArray(reloaded.products));
    assert.equal(reloaded.products.length, 2);
    assert.equal(reloaded.products[1].product_name, "Zolfo bagnabile");
    assert.equal(reloaded.products[1].dose_per_ha, 3);
    assert.equal(typeof reloaded.products[1].dose_per_ha, "number");
  });

  it("deleteRecipe: soft-delete, sparisce da listRecipes", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const recipe = await dal.saveRecipe({
      company_id: companyId,
      name: "Ricetta da cancellare",
      operation_type: null,
      products: [],
      target_disease: null,
      notes: null,
    });
    await dal.deleteRecipe(recipe.id);
    const list = await dal.listRecipes(companyId);
    assert.equal(list.find((r) => r.id === recipe.id), undefined);
  });
});

// ---------------------------------------------------------------------------
// Task programmate: CRUD + plannedTasksForPlot
// ---------------------------------------------------------------------------

describe("DAL Pianificazione task / task programmate", () => {
  it("savePlannedTask crea con status PLANNED di default; setPlannedTaskStatus transiziona", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: "Peronospora",
      planned_date: relativeDay(3),
      operator_name: "Mario Rossi",
      notes: null,
    });
    assert.equal(task.status, "PLANNED");

    const cancelled = await dal.setPlannedTaskStatus(task.id, "CANCELLED");
    assert.equal(cancelled?.status, "CANCELLED");

    const reread = await dal.getPlannedTask(task.id);
    assert.equal(reread?.status, "CANCELLED");
  });

  it("deletePlannedTask: soft-delete, sparisce da listPlannedTasks", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "sampling",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: null,
      operator_name: null,
      notes: null,
    });
    await dal.deletePlannedTask(task.id);
    const list = await dal.listPlannedTasks(companyId);
    assert.equal(list.find((t) => t.id === task.id), undefined);
  });

  it("plannedTasksForPlot: solo PLANNED del plot, ordinate per data (senza data in coda)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId, "Campo A");
    const otherPlotId = await seedPlot(dal, companyId, "Campo B");

    // Fuori ordine di creazione, per verificare il sort per planned_date.
    const later = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "irrigation",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: relativeDay(10),
      operator_name: null,
      notes: null,
    });
    const noDate = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: null,
      operator_name: null,
      notes: null,
    });
    const sooner = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: relativeDay(2),
      operator_name: null,
      notes: null,
    });
    // Task CANCELLED sullo stesso plot: non deve comparire.
    const cancelledTask = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "sampling",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: relativeDay(1),
      operator_name: null,
      notes: null,
    });
    await dal.setPlannedTaskStatus(cancelledTask.id, "CANCELLED");
    // Task PLANNED su un altro plot: non deve comparire.
    await dal.savePlannedTask({
      company_id: companyId,
      plot_id: otherPlotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: relativeDay(1),
      operator_name: null,
      notes: null,
    });

    const result = await dal.plannedTasksForPlot(plotId);
    assert.deepEqual(
      result.map((t) => t.id),
      [sooner.id, later.id, noDate.id],
    );
  });
});

// ---------------------------------------------------------------------------
// Sessioni a bordo campo: avvio atomico dalla task programmata
// ---------------------------------------------------------------------------

describe("DAL Pianificazione task / sessioni a bordo campo", () => {
  it("startFieldSession con planned_task_id crea la sessione E porta la task a IN_PROGRESS", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: "Peronospora",
      planned_date: relativeDay(0),
      operator_name: null,
      notes: null,
    });

    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: task.id,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: "Mario Rossi",
      notes: null,
    });

    assert.equal(session.status, "IN_PROGRESS");
    assert.equal(session.planned_task_id, task.id);
    assert.deepEqual(session.path, { type: "LineString", coordinates: [] });
    assert.deepEqual(session.audio_notes, []);
    assert.deepEqual(session.treatment_log_ids, []);

    const updatedTask = await dal.getPlannedTask(task.id);
    assert.equal(updatedTask?.status, "IN_PROGRESS");
  });

  it("startFieldSession senza planned_task_id non tocca alcuna task", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: null,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });
    assert.equal(session.planned_task_id, null);
    assert.equal(session.status, "IN_PROGRESS");
  });

  it("updateFieldSession: patch parziale preserva i campi non passati", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: null,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: 3.2,
      operator_name: "Mario Rossi",
      notes: null,
    });

    const updated = await dal.updateFieldSession(session.id, {
      path: { type: "LineString", coordinates: [[9, 45], [9.001, 45.001]] },
      path_length_m: 120.5,
      area_worked_ha: 0.8,
    });

    assert.equal(Number(updated?.path_length_m), 120.5);
    assert.equal(Number(updated?.area_worked_ha), 0.8);
    // Campi non passati nel patch: preservati.
    assert.equal(updated?.operator_name, "Mario Rossi");
    assert.equal(Number(updated?.working_width_m), 3.2);
  });

  it("activeFieldSession: ritorna la sessione IN_PROGRESS, poi null una volta chiusa", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: null,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });

    const active = await dal.activeFieldSession(companyId);
    assert.equal(active?.id, session.id);

    await dal.updateFieldSession(session.id, {
      status: "COMPLETED",
      end_time: new Date().toISOString(),
    });

    const activeAfter = await dal.activeFieldSession(companyId);
    assert.equal(activeAfter, null);
  });

  // -- abortFieldSession: abbandono ATOMICO, reversibile ------------

  it("abortFieldSession: porta la sessione ad ABORTED e la task agganciata torna a PLANNED (atomico)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: "Peronospora",
      planned_date: relativeDay(0),
      operator_name: null,
      notes: null,
    });
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: task.id,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });
    // L'avvio ha già portato la task a IN_PROGRESS (comportamento di startFieldSession).
    assert.equal((await dal.getPlannedTask(task.id))?.status, "IN_PROGRESS");

    const aborted = await dal.abortFieldSession(session.id);
    assert.equal(aborted?.status, "ABORTED");
    assert.ok(aborted?.end_time);

    const rereadSession = await dal.getFieldSession(session.id);
    assert.equal(rereadSession?.status, "ABORTED");

    const rereadTask = await dal.getPlannedTask(task.id);
    assert.equal(rereadTask?.status, "PLANNED");
  });

  it("abortFieldSession senza planned_task_id non tocca alcuna task", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: null,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });

    const aborted = await dal.abortFieldSession(session.id);
    assert.equal(aborted?.status, "ABORTED");
    assert.equal(aborted?.planned_task_id, null);
  });

  it("abortFieldSession su una sessione inesistente ritorna null", async () => {
    const dal = await TestDal.create();
    await seedCompany(dal);
    const result = await dal.abortFieldSession("00000000-0000-0000-0000-000000000000");
    assert.equal(result, null);
  });

  it("abortFieldSession accoda le voci di outbox della sessione E della task nella stessa transazione", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      target_pest_or_disease: null,
      planned_date: null,
      operator_name: null,
      notes: null,
    });
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: task.id,
      plot_id: plotId,
      operation_type: "tillage",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });

    await dal.abortFieldSession(session.id);

    const counts = await dal.rawQuery<{ table_name: string; n: number }>(
      `select table_name, count(*)::int as n from sync_outbox group by table_name`,
    );
    const byTable = Object.fromEntries(counts.rows.map((r) => [r.table_name, r.n]));
    // planned_tasks: 1 insert (savePlannedTask) + 1 update (flip a IN_PROGRESS
    // in startFieldSession) + 1 update (ritorno a PLANNED in abortFieldSession).
    assert.equal(byTable.planned_tasks, 3);
    // field_operation_sessions: 1 insert (startFieldSession) + 1 update (abortFieldSession).
    assert.equal(byTable.field_operation_sessions, 2);
  });
});

// ---------------------------------------------------------------------------
// Outbox: le tre tabelle sincronizzate producono voci in sync_outbox
// ---------------------------------------------------------------------------

describe("DAL Pianificazione task / outbox", () => {
  it("recipes, planned_tasks e field_operation_sessions accodano mutazioni; field_session_audio no", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    const recipe = await dal.saveRecipe({
      company_id: companyId,
      name: "Ricetta outbox",
      operation_type: null,
      products: [],
      target_disease: null,
      notes: null,
    });
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: recipe.id,
      target_pest_or_disease: null,
      planned_date: null,
      operator_name: null,
      notes: null,
    });
    await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: task.id,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: recipe.id,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });

    const counts = await dal.rawQuery<{ table_name: string; n: number }>(
      `select table_name, count(*)::int as n from sync_outbox group by table_name`,
    );
    const byTable = Object.fromEntries(counts.rows.map((r) => [r.table_name, r.n]));

    assert.equal(byTable.recipes, 1);
    // 1 insert (savePlannedTask) + 1 update (flip a IN_PROGRESS in startFieldSession).
    assert.equal(byTable.planned_tasks, 2);
    assert.equal(byTable.field_operation_sessions, 1);
    assert.equal(byTable.field_session_audio, undefined);
  });
});
