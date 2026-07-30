import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { composeSessionLogs } from "../packages/agro-core/src/field/session-logbook";
import { sowingCropAssignment } from "../packages/agro-core/src/field/session-crop";
import type {
  FieldOperationSession,
  PlotCampaign,
  Product,
  ProductLot,
} from "../packages/agro-core/src/types";

/**
 * Chiusura di una sessione a bordo campo con COMPLETAMENTO DICHIARATO:
 *
 *   * la superficie del Quaderno è quella dichiarata (percentuale × superficie
 *     dell'appezzamento), non più una stima GPS;
 *   * sotto il 100% la TASK non si chiude: torna PLANNED con l'avanzamento, e
 *     il giorno dopo si riprende da lì;
 *   * la semente pianificata sulla task esce dal Magazzino esattamente per la
 *     quantità scritta nel Quaderno;
 *   * una semina su appezzamento libero assegna la coltura della campagna.
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

/** Appezzamento di 10 ha: le percentuali di completamento sono leggibili a occhio. */
async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 10)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

async function seedSowingTask(
  dal: TestDal,
  companyId: string,
  plotId: string,
  seedProductId: string | null,
): Promise<string> {
  const task = await dal.savePlannedTask({
    company_id: companyId,
    plot_id: plotId,
    operation_type: "sowing",
    recipe_id: null,
    target_pest_or_disease: null,
    status: "PLANNED",
    planned_date: null,
    operator_name: "Mario Rossi",
    notes: null,
    metadata: {
      seed_product_id: seedProductId,
      seed_product_name: "Grano Bologna",
      seed_dose: 2,
      seed_dose_unit: "kg/ha",
    },
  });
  return task.id;
}

async function seedSession(
  dal: TestDal,
  companyId: string,
  plotId: string,
  taskId: string | null,
): Promise<FieldOperationSession> {
  return dal.startFieldSession({
    company_id: companyId,
    planned_task_id: taskId,
    plot_id: plotId,
    operation_type: "sowing",
    recipe_id: null,
    machine_id: null,
    equipment_id: null,
    working_width_m: 4,
    operator_name: null,
    notes: null,
  });
}

function context(
  session: FieldOperationSession,
  extra: Partial<Parameters<typeof composeSessionLogs>[0]> = {},
) {
  return {
    session,
    plot: { id: session.plot_id, area_ha: 10 },
    recipe: null,
    task: null,
    plotCampaignId: null,
    operator: {},
    products: [] as Product[],
    lots: [] as ProductLot[],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Completamento parziale: la task resta aperta
// ---------------------------------------------------------------------------

describe("chiusura sessione / completamento dichiarato", () => {
  it("sotto il 100% la task torna PLANNED con l'avanzamento, la sessione si chiude comunque", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const taskId = await seedSowingTask(dal, companyId, plotId, null);
    const session = await seedSession(dal, companyId, plotId, taskId);

    // 6 ha su 10 = 60% dichiarato.
    const composition = composeSessionLogs(
      context({ ...session, area_worked_ha: 6 }),
    );
    const result = await dal.completeFieldSession(
      session.id,
      composition.drafts,
      { end_time: new Date().toISOString(), area_worked_ha: 6 },
      { taskCompletionPercent: 60 },
    );

    assert.ok(result);
    assert.equal(result.session.status, "COMPLETED");
    assert.equal(result.taskStillOpen, true);

    const task = await dal.getPlannedTask(taskId);
    assert.equal(task?.status, "PLANNED", "la task deve restare riprendibile");
    assert.equal(task?.metadata.completion_percent, 60);
  });

  it("al 100% la task si chiude (comportamento storico)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const taskId = await seedSowingTask(dal, companyId, plotId, null);
    const session = await seedSession(dal, companyId, plotId, taskId);

    const composition = composeSessionLogs(
      context({ ...session, area_worked_ha: 10 }),
    );
    const result = await dal.completeFieldSession(
      session.id,
      composition.drafts,
      { area_worked_ha: 10 },
      { taskCompletionPercent: 100 },
    );

    assert.equal(result?.taskStillOpen, false);
    const task = await dal.getPlannedTask(taskId);
    assert.equal(task?.status, "COMPLETED");
  });

  it("le quantità seguono la superficie DICHIARATA, non quella catastale", () => {
    const session = {
      id: "s1",
      plot_id: "p1",
      company_id: "c1",
      operation_type: "sowing",
      area_worked_ha: 4,
      end_time: new Date().toISOString(),
    } as unknown as FieldOperationSession;

    const composition = composeSessionLogs(
      context(session, {
        taskMetadata: {
          seed_product_name: "Grano Bologna",
          seed_dose: 2,
          seed_dose_unit: "kg/ha",
        },
      }),
    );
    // 2 kg/ha × 4 ha dichiarati = 8 kg (coi 10 ha catastali sarebbero 20).
    assert.equal(composition.areaUsedHa, 4);
    assert.equal(composition.drafts[0].input.total_quantity, 8);
  });
});

// ---------------------------------------------------------------------------
// 2. Magazzino: la semente della task esce davvero, sulla quantità del Quaderno
// ---------------------------------------------------------------------------

describe("chiusura sessione / scarico della semente pianificata", () => {
  it("scarica il lot della semente per la stessa quantità scritta nel Quaderno", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    const seed = await dal.upsertProduct({
      company_id: companyId,
      category: "seed",
      name: "Grano Bologna",
      unit: "kg",
      registration_number: null,
      active_substance: null,
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      supplier: null,
      notes: null,
      metadata: { species: "Frumento tenero", crop_category: "seminativo" },
    });
    await dal.receiveLot({
      product_id: seed.id,
      lot_number: "S1",
      expires_at: null,
      initial_quantity: 100,
      unit_cost: 1.5,
    });

    const taskId = await seedSowingTask(dal, companyId, plotId, seed.id);
    const session = await seedSession(dal, companyId, plotId, taskId);
    const task = await dal.getPlannedTask(taskId);

    const composition = composeSessionLogs(
      context({ ...session, area_worked_ha: 6 }, {
        taskMetadata: task?.metadata ?? null,
        products: await dal.listProducts(companyId),
        lots: await dal.listLotti(companyId),
      }),
    );

    // 2 kg/ha × 6 ha = 12 kg: stesso numero nel Quaderno e nello scarico.
    assert.equal(composition.drafts[0].input.total_quantity, 12);
    assert.equal(composition.drafts[0].issues.length, 1);
    assert.equal(composition.drafts[0].issues[0].quantity, 12);

    const result = await dal.completeFieldSession(
      session.id,
      composition.drafts,
      { area_worked_ha: 6 },
      { taskCompletionPercent: 60 },
    );
    assert.ok(result);

    const lots = await dal.listLotti(companyId);
    assert.equal(
      Number(lots[0].quantity_on_hand),
      88,
      "la giacenza deve scendere di quanto registrato nel Quaderno",
    );
  });

  it("semente NON in anagrafica: riga scritta, nessuno scarico, warning esplicito", () => {
    const session = {
      id: "s1",
      plot_id: "p1",
      company_id: "c1",
      operation_type: "sowing",
      area_worked_ha: 5,
    } as unknown as FieldOperationSession;

    const composition = composeSessionLogs(
      context(session, {
        taskMetadata: {
          seed_product_name: "Semente del vicino",
          seed_dose: 3,
          seed_dose_unit: "kg/ha",
        },
      }),
    );
    assert.equal(composition.drafts[0].input.total_quantity, 15);
    assert.equal(composition.drafts[0].issues.length, 0);
    assert.ok(
      composition.warnings.some((w) => w.kind === "product_not_in_warehouse"),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Semina → coltura di campagna
// ---------------------------------------------------------------------------

describe("semina a bordo campo / assegnazione coltura", () => {
  const seedProduct = {
    id: "seed-1",
    name: "Grano Bologna",
    metadata: {
      species: "Frumento tenero",
      scientific_name: "Triticum aestivum",
      variety_name: "Bologna",
      crop_category: "seminativo",
    },
  } as unknown as Product;

  const base = {
    operationType: "sowing",
    plot: { id: "p1", area_ha: 10 },
    campaignFields: [] as Pick<
      PlotCampaign,
      "plot_id" | "closed_at" | "deleted_at"
    >[],
    taskMetadata: {
      seed_product_id: "seed-1",
      seed_dose: 2,
      seed_dose_unit: "kg/ha" as const,
    },
    products: [seedProduct],
  };

  it("propone specie, varietà e densità dall'anagrafica della semente", () => {
    const assignment = sowingCropAssignment(base);
    assert.ok(assignment);
    assert.equal(assignment.species, "Frumento tenero");
    assert.equal(assignment.scientificName, "Triticum aestivum");
    assert.equal(assignment.varietyName, "Bologna");
    assert.equal(assignment.cropCategory, "seminativo");
    assert.equal(assignment.seedingDensity, 2);
    assert.equal(assignment.declaredAreaHa, 10);
  });

  it("non tocca un appezzamento con campagna già APERTA", () => {
    const assignment = sowingCropAssignment({
      ...base,
      campaignFields: [{ plot_id: "p1", closed_at: null, deleted_at: null }],
    });
    assert.equal(assignment, null);
  });

  it("una campagna CHIUSA non blocca la nuova semina", () => {
    const assignment = sowingCropAssignment({
      ...base,
      campaignFields: [
        { plot_id: "p1", closed_at: "2026-07-01T00:00:00.000Z", deleted_at: null },
      ],
    });
    assert.ok(assignment);
  });

  it("si applica solo alla semina e solo con una specie riconoscibile", () => {
    assert.equal(
      sowingCropAssignment({ ...base, operationType: "tillage" }),
      null,
    );
    assert.equal(
      sowingCropAssignment({ ...base, taskMetadata: {}, products: [] }),
      null,
    );
  });

  it("senza anagrafica ricade sul nome libero della semente", () => {
    const assignment = sowingCropAssignment({
      ...base,
      taskMetadata: { seed_product_name: "Orzo distico" },
      products: [],
    });
    assert.equal(assignment?.species, "Orzo distico");
    assert.equal(assignment?.cropCategory, "seminativo");
  });
});
