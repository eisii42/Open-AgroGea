import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { WarehouseError } from "../packages/agro-core/src/db/dal-warehouse";
import { evaluateLogCompleteness } from "../packages/agro-core/src/field/task-completeness";
import { sessionElapsedMs } from "../plugins/agro-tools/src/field-session-clock";
import { activeReentryWindows } from "../plugins/agro-tools/src/reentry";
import {
  composeSessionLogs,
  pickLotForProduct,
} from "../packages/agro-core/src/field/session-logbook";
import type {
  FieldOperationSession,
  Product,
  ProductLot,
  Recipe,
} from "../packages/agro-core/src/types";

/**
 * CHIUSURA della sessione a bordo campo verso il Quaderno di Campagna
 * (Modalità Campo low-touch): composizione PURA delle righe (una per product
 * della miscela, quantità sulla superficie GPS) e persistenza ATOMICA +
 * IDEMPOTENTE via `completeFieldSession`.
 *
 * La scrittura è automatica e senza conferma dell'operatore: atomicità e
 * idempotenza non sono raffinatezze ma il requisito centrale — una chiusura a
 * metà o ripetuta falsificherebbe un registro di rilevanza legale senza che
 * nessuno se ne accorga.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

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

/** Appezzamento con area catastale 5 ha: deliberatamente ≠ dalla superficie GPS. */
async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 5)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

async function seedTask(
  dal: TestDal,
  companyId: string,
  plotId: string,
): Promise<string> {
  const task = await dal.savePlannedTask({
    company_id: companyId,
    plot_id: plotId,
    operation_type: "phytosanitary",
    recipe_id: null,
    target_pest_or_disease: "Oidio",
    status: "PLANNED",
    planned_date: null,
    operator_name: "Mario Rossi",
    notes: null,
  });
  return task.id;
}

/** Sessione con superficie GPS 2 ha (contro i 5 ha catastali del plot). */
async function seedSession(
  dal: TestDal,
  companyId: string,
  plotId: string,
  taskId: string | null,
): Promise<FieldOperationSession> {
  const session = await dal.startFieldSession({
    company_id: companyId,
    planned_task_id: taskId,
    plot_id: plotId,
    operation_type: "phytosanitary",
    recipe_id: null,
    machine_id: null,
    equipment_id: null,
    working_width_m: 4,
    operator_name: null,
    notes: null,
  });
  const updated = await dal.updateFieldSession(session.id, {
    area_worked_ha: 2,
    path_length_m: 5000,
  });
  return updated ?? session;
}

/** Miscela a due prodotti: rame + zolfo (il caso che genera due righe). */
function twoProductRecipe(): Pick<Recipe, "products" | "target_disease"> {
  return {
    target_disease: "Peronospora",
    products: [
      {
        product_id: null,
        product_name: "Rame",
        dose_per_ha: 3,
        unit: "kg/ha",
        active_substance: "Solfato di rame",
        registration_number: "1234",
      },
      {
        product_id: null,
        product_name: "Zolfo",
        dose_per_ha: 5,
        unit: "kg/ha",
        active_substance: "Zolfo",
        registration_number: "5678",
      },
    ],
  };
}

function emptyContext(session: FieldOperationSession, plotAreaHa: number) {
  return {
    session,
    plot: { id: session.plot_id, area_ha: plotAreaHa },
    recipe: null,
    task: null,
    plotCampaignId: null,
    operator: {},
    products: [] as Product[],
    lots: [] as ProductLot[],
  };
}

// ---------------------------------------------------------------------------
// 1. Una riga per prodotto + chiusura di sessione e task
// ---------------------------------------------------------------------------

describe("chiusura sessione / righe del Quaderno", () => {
  it("una miscela a due prodotti produce DUE righe, entrambe in treatment_log_ids, con sessione e task COMPLETED", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const taskId = await seedTask(dal, companyId, plotId);
    const session = await seedSession(dal, companyId, plotId, taskId);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
      operator: { name: "Mario Rossi", license: "PAT-99" },
    });
    assert.equal(composition.drafts.length, 2);

    const result = await dal.completeFieldSession(
      session.id,
      composition.drafts,
      { end_time: new Date().toISOString() },
    );
    assert.ok(result);
    assert.equal(result.alreadyCompleted, false);
    assert.equal(result.treatments.length, 2);
    assert.equal(result.session.status, "COMPLETED");
    assert.ok(result.session.end_time);
    assert.deepEqual(
      [...result.session.treatment_log_ids].sort(),
      result.treatments.map((t) => t.id).sort(),
    );

    const task = await dal.getPlannedTask(taskId);
    assert.equal(task?.status, "COMPLETED");

    const logs = await dal.listTreatments(companyId);
    assert.equal(logs.length, 2);
  });

  // -------------------------------------------------------------------------
  // 2. Le quantità nascono dalla superficie GPS, non da quella catastale
  // -------------------------------------------------------------------------

  it("total_quantity = dose × superficie GPS (2 ha), NON × superficie catastale (5 ha)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
    });
    assert.equal(composition.areaUsedHa, 2);
    // Rame 3 kg/ha × 2 ha = 6; zolfo 5 kg/ha × 2 ha = 10. Coi 5 ha catastali
    // sarebbero stati 15 e 25: la differenza è il senso del tracciamento.
    assert.equal(composition.drafts[0].input.total_quantity, 6);
    assert.equal(composition.drafts[1].input.total_quantity, 10);
    assert.notEqual(composition.drafts[0].input.total_quantity, 15);

    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);
    const totals = result.treatments.map((t) => Number(t.total_quantity)).sort((a, b) => a - b);
    assert.deepEqual(totals, [6, 10]);
  });

  it("senza superficie GPS ricade sulla superficie catastale e lo SEGNALA", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: null,
      plot_id: plotId,
      operation_type: "phytosanitary",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: null,
      operator_name: null,
      notes: null,
    });

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
    });
    assert.equal(composition.areaUsedHa, 5);
    assert.ok(composition.warnings.some((w) => w.kind === "gps_area_fallback"));
    // Nessuna quantità nulla: un record di compliance a zero sarebbe peggio.
    assert.equal(composition.drafts[0].input.total_quantity, 15);
  });

  // -------------------------------------------------------------------------
  // 3. Identità operatore
  // -------------------------------------------------------------------------

  it("name e patentino dell'operatore finiscono sulle righe del Quaderno", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
      operator: { name: "Mario Rossi", taxCode: "RSSMRA80A01H501U", license: "PAT-99" },
    });
    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);
    for (const log of result.treatments) {
      assert.equal(log.operator_name, "Mario Rossi");
      assert.equal(log.license_number, "PAT-99");
      assert.equal(log.operator_tax_code, "RSSMRA80A01H501U");
    }
  });

  it("l'operatore della task programmata ha precedenza sulla memoria di dispositivo", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
      task: { operator_name: "Luigi Verdi", target_pest_or_disease: "Oidio" },
      operator: { name: "Mario Rossi", license: "PAT-99" },
    });
    assert.equal(composition.drafts[0].input.operator_name, "Luigi Verdi");
    // L'avversità della task vince su quella della ricetta.
    assert.equal(composition.drafts[0].input.target_disease, "Oidio");
  });
});

// ---------------------------------------------------------------------------
// 4. Magazzino: scarico reale, CUMP congelato, blocco su giacenza
// ---------------------------------------------------------------------------

describe("chiusura sessione / scarico magazzino", () => {
  async function seedWarehouse(
    dal: TestDal,
    companyId: string,
    quantityOnHand: number,
  ): Promise<{ productId: string; lotId: string }> {
    const product = await dal.upsertProduct({
      company_id: companyId,
      category: "phytosanitary",
      name: "Rame Bio",
      unit: "kg",
      registration_number: "1234",
      active_substance: "Solfato di rame",
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      supplier: null,
      notes: null,
    });
    const lot = await dal.receiveLot({
      product_id: product.id,
      lot_number: "L1",
      expires_at: null,
      initial_quantity: quantityOnHand,
      unit_cost: 10,
    });
    return { productId: product.id, lotId: lot.id };
  }

  it("scarica il lot, crea activity_products col CUMP congelato e riduce la giacenza", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);
    const { productId } = await seedWarehouse(dal, companyId, 100);

    const products = await dal.listProducts(companyId);
    const lots = await dal.listLotti(companyId);
    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: {
        target_disease: "Peronospora",
        products: [
          {
            product_id: productId,
            product_name: "Rame Bio",
            dose_per_ha: 3,
            unit: "kg/ha",
          },
        ],
      },
      products,
      lots,
    });
    // 3 kg/ha × 2 ha GPS = 6 kg da scaricare.
    assert.equal(composition.drafts[0].issues[0]?.quantity, 6);

    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);

    const afterLots = await dal.listLotti(companyId);
    assert.equal(Number(afterLots[0].quantity_on_hand), 94);

    const issues = await dal.rawQuery<{ quantity: string; unit_cost: string }>(
      `select quantity, unit_cost from activity_products where treatment_log_id = $1`,
      [result.treatments[0].id],
    );
    assert.equal(issues.rows.length, 1);
    assert.equal(Number(issues.rows[0].quantity), 6);
    assert.equal(Number(issues.rows[0].unit_cost), 10);
  });

  it("giacenza insufficiente: WarehouseError e NESSUNA scrittura parziale (sessione ancora aperta)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);
    const { productId } = await seedWarehouse(dal, companyId, 1);

    const products = await dal.listProducts(companyId);
    const lots = await dal.listLotti(companyId);
    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: {
        target_disease: null,
        products: [
          {
            product_id: productId,
            product_name: "Rame Bio",
            dose_per_ha: 3,
            unit: "kg/ha",
          },
        ],
      },
      products,
      lots,
    });

    await assert.rejects(
      () => dal.completeFieldSession(session.id, composition.drafts),
      WarehouseError,
    );

    // Atomicità: nessuna row di Quaderno orfana, sessione NON chiusa, giacenza intatta.
    const logs = await dal.listTreatments(companyId);
    assert.equal(logs.length, 0);
    const reread = await dal.getFieldSession(session.id);
    assert.notEqual(reread?.status, "COMPLETED");
    const afterLots = await dal.listLotti(companyId);
    assert.equal(Number(afterLots[0].quantity_on_hand), 1);
  });

  it("pickLotForProduct sceglie la scadenza più vicina (FEFO) e ignora lots vuoti", () => {
    const base = {
      tenant_id: TENANT,
      product_id: "p1",
      initial_quantity: 10,
      unit_cost: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    };
    const lots: ProductLot[] = [
      { ...base, id: "l1", lot_number: "A", expires_at: "2027-06-01", quantity_on_hand: 5 },
      { ...base, id: "l2", lot_number: "B", expires_at: "2026-12-01", quantity_on_hand: 5 },
      { ...base, id: "l3", lot_number: "C", expires_at: "2026-01-02", quantity_on_hand: 0 },
    ];
    assert.equal(pickLotForProduct("p1", lots)?.id, "l2");
    assert.equal(pickLotForProduct("altro", lots), null);
  });

  it("senza lot utilizzabile non scarica nulla e lo SEGNALA (fallback a testo libero)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: {
        target_disease: null,
        products: [
          {
            product_id: "00000000-0000-0000-0000-000000000001",
            product_name: "Prodotto senza lotti",
            dose_per_ha: 3,
            unit: "kg/ha",
          },
        ],
      },
    });
    assert.equal(composition.drafts[0].issues.length, 0);
    assert.ok(composition.warnings.some((w) => w.kind === "no_lot_available"));
  });
});

// ---------------------------------------------------------------------------
// 5-7. Idempotenza, sessione senza ricetta, outbox
// ---------------------------------------------------------------------------

describe("chiusura sessione / idempotenza e outbox", () => {
  it("chiudere DUE volte non duplica le righe del Quaderno", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const taskId = await seedTask(dal, companyId, plotId);
    const session = await seedSession(dal, companyId, plotId, taskId);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
    });

    const first = await dal.completeFieldSession(session.id, composition.drafts);
    assert.equal(first?.treatments.length, 2);
    assert.equal(first?.alreadyCompleted, false);

    const second = await dal.completeFieldSession(session.id, composition.drafts);
    assert.equal(second?.alreadyCompleted, true);
    assert.equal(second?.treatments.length, 0);

    const logs = await dal.listTreatments(companyId);
    assert.equal(logs.length, 2, "un doppio tap su CONCLUDI non deve raddoppiare il registro");
  });

  it("una sessione senza ricetta scrive UNA riga, senza product né dose", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs(emptyContext(session, 5));
    assert.equal(composition.drafts.length, 1);

    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);
    assert.equal(result.treatments.length, 1);
    assert.equal(result.treatments[0].product_name, null);
    assert.equal(result.treatments[0].total_quantity, null);
  });

  it("la chiusura accoda in sync_outbox ogni tabella mutata", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const taskId = await seedTask(dal, companyId, plotId);
    const session = await seedSession(dal, companyId, plotId, taskId);

    await dal.rawQuery(`delete from sync_outbox`);
    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
    });
    await dal.completeFieldSession(session.id, composition.drafts);

    const rows = await dal.rawQuery<{ table_name: string }>(
      `select distinct table_name from sync_outbox`,
    );
    const tables = rows.rows.map((r) => r.table_name).sort();
    assert.deepEqual(tables, [
      "field_operation_sessions",
      "planned_tasks",
      "treatment_logs",
    ]);
  });

  // -------------------------------------------------------------------------
  // Regressione: i timestamp RILETTI da PGlite sono oggetti `Date`, non
  // stringhe ISO come dichiarano i tipi di dominio. I motori che li consumano
  // devono tollerare entrambe le forme: `executed_at.slice(0, 10)` su una row
  // riletta faceva cadere l'intera sidebar. I test che costruiscono le row in
  // TS non lo intercettano — questo passa deliberatamente dal DB.
  // -------------------------------------------------------------------------

  it("i motori che consumano i timestamp reggono le row RILETTE dal DB (Date, non stringhe)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs({
      ...emptyContext(session, 5),
      recipe: twoProductRecipe(),
      operator: { name: "Mario Rossi", license: "PAT-99" },
    });
    await dal.completeFieldSession(session.id, composition.drafts, {
      end_time: new Date().toISOString(),
    });

    const [log] = await dal.listTreatments(companyId);
    assert.ok(log, "la row deve esistere");
    // Precondizione del test: il driver restituisce davvero un Date. Se un
    // giorno PGlite cambiasse comportamento, questa asserzione lo direbbe.
    assert.ok(
      log.executed_at instanceof Date,
      "PGlite deserializza timestamptz in Date: è la premessa di questa regressione",
    );

    // Nessuno di questi deve lanciare né produrre NaN sulla row riletta.
    const audit = evaluateLogCompleteness(log);
    assert.ok(Array.isArray(audit.missing));
    assert.ok(
      !audit.missing.some((m) => m.field === "executed_at"),
      "la data c'è: non deve risultare mancante per un errore di parsing",
    );

    const reread = await dal.getFieldSession(session.id);
    assert.ok(reread);
    const elapsed = sessionElapsedMs(
      reread.start_time,
      0,
      null,
      Date.now(),
    );
    assert.ok(Number.isFinite(elapsed) && elapsed >= 0);

    const windows = activeReentryWindows(
      [{ plot_id: plotId, executed_at: log.executed_at, reentry_interval_h: 48 }],
      Date.now(),
    );
    assert.equal(windows.length, 1);
    assert.ok(windows[0].hoursRemaining > 0 && windows[0].hoursRemaining <= 48);
    assert.doesNotThrow(() => new Date(windows[0].until).toISOString());
  });

  it("la nota della riga lega il record alla sessione che l'ha generata", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const session = await seedSession(dal, companyId, plotId, null);

    const composition = composeSessionLogs(emptyContext(session, 5));
    const result = await dal.completeFieldSession(session.id, composition.drafts);
    assert.ok(result);
    const { sessionIdFromNote } = await import(
      "../packages/agro-core/src/field/session-logbook"
    );
    assert.equal(sessionIdFromNote(result.treatments[0].note), session.id);
  });
});
