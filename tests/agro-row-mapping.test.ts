import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  normalizeRows,
  normalizeValue,
} from "../packages/agro-core/src/db/row-mapping";

/**
 * Normalizzazione delle rows in USCITA dal DAL: i tipi di dominio dichiarano
 * `string` per i timestamp e `number` per le `numeric`, ma PGlite restituisce
 * `Date` e `string`. Il wrapper di `AgroDalBase` riallinea le due cose una
 * volta sola, per ogni percorso di lettura.
 *
 * Questi test partono SEMPRE da una row realmente riletta dal database: una
 * row costruita in TypeScript avrebbe già i tipi giusti e non proverebbe nulla.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const OID_DATE = 1082;
const OID_TIMESTAMPTZ = 1184;
const OID_NUMERIC = 1700;

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

// ---------------------------------------------------------------------------
// 1. Conversione pura, per OID
// ---------------------------------------------------------------------------

describe("normalizeValue — conversione per OID", () => {
  it("timestamptz ⇒ stringa ISO completa (millisecondi preservati)", () => {
    const value = new Date("2026-07-27T09:38:50.145Z");
    assert.equal(normalizeValue(value, OID_TIMESTAMPTZ), "2026-07-27T09:38:50.145Z");
  });

  it("date ⇒ YYYY-MM-DD dai componenti UTC, non locali", () => {
    // PGlite restituisce una `date` come mezzanotte UTC del giorno indicato.
    // Coi componenti LOCALI, in un fuso negativo si otterrebbe il giorno prima.
    const value = new Date("2026-07-27T00:00:00.000Z");
    assert.equal(normalizeValue(value, OID_DATE), "2026-07-27");
  });

  it("numeric ⇒ number", () => {
    assert.equal(normalizeValue("123.456", OID_NUMERIC), 123.456);
    assert.equal(normalizeValue("0", OID_NUMERIC), 0);
  });

  it("una numeric non finita resta stringa, invece di diventare un NaN silenzioso", () => {
    assert.equal(normalizeValue("NaN", OID_NUMERIC), "NaN");
  });

  it("null resta null e i tipi non interessati passano intatti", () => {
    assert.equal(normalizeValue(null, OID_TIMESTAMPTZ), null);
    assert.equal(normalizeValue(null, OID_NUMERIC), null);
    assert.equal(normalizeValue("testo", 25), "testo");
    assert.equal(normalizeValue(42, 23), 42);
  });

  it("normalizeRows non copia nulla quando non c'è niente da convertire", () => {
    const rows = [{ id: "a" }];
    assert.equal(normalizeRows(rows, [{ name: "id", dataTypeID: 2950 }]), rows);
    assert.equal(normalizeRows(rows, undefined), rows);
  });
});

// ---------------------------------------------------------------------------
// 2. Round-trip reale attraverso il DAL
// ---------------------------------------------------------------------------

describe("normalizzazione end-to-end sul DAL", () => {
  it("i timestamp riletti sono STRINGHE e le numeric sono NUMERI", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plot = await dal.rawQuery<{ id: string }>(
      `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
       values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 2.5)
       returning id`,
      [TENANT, companyId],
    );

    const treatment = await dal.insertTreatment({
      company_id: companyId,
      plot_id: plot.rows[0].id,
      plot_campaign_id: null,
      operation_type: "phytosanitary",
      product_name: "Rame",
      registration_number: "1234",
      active_substance: "Solfato di rame",
      dose_value: 3,
      dose_unit: "kg/ha",
      total_quantity: 7.5,
      water_volume_l: null,
      target_disease: "Peronospora",
      fertilizer_type: null,
      npk_ratio: null,
      operator_name: "Mario Rossi",
      operator_tax_code: null,
      license_number: "PAT-99",
      machinery_equipment: null,
      executed_at: new Date().toISOString(),
      reentry_interval_h: 48,
      safety_period_days: 7,
      weather_conditions: null,
      note: null,
    });
    assert.ok(treatment);

    const [log] = await dal.listTreatments(companyId);
    assert.equal(typeof log.executed_at, "string", "timestamptz deve essere una stringa");
    assert.equal(typeof log.created_at, "string");
    assert.doesNotThrow(() => log.executed_at.slice(0, 10));
    // Era il crash originale: `.slice` su un Date.
    assert.match(log.executed_at.slice(0, 10), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof log.total_quantity, "number", "numeric deve essere un number");
    assert.equal(log.total_quantity, 7.5);
    assert.equal(typeof log.dose_value, "number");

    // jsonb, uuid e testo restano ciò che erano.
    const [plotRow] = await dal.listPlots(companyId);
    assert.equal(typeof plotRow.id, "string");
    assert.equal(typeof plotRow.geometry, "object");
    assert.equal(typeof plotRow.area_ha, "number");
  });

  it("una colonna `date` torna come YYYY-MM-DD, corretto anche in un fuso negativo", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const product = await dal.upsertProduct({
      company_id: companyId,
      category: "phytosanitary",
      name: "Rame Bio",
      unit: "kg",
      registration_number: "1234",
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      notes: null,
    });
    await dal.receiveLot({
      product_id: product.id,
      lot_number: "L1",
      expires_at: "2026-07-27",
      initial_quantity: 100,
      unit_cost: 10,
    });

    const [lot] = await dal.listLotti(companyId);
    assert.equal(typeof lot.expires_at, "string");
    assert.equal(
      lot.expires_at,
      "2026-07-27",
      "il giorno non deve slittare indietro: è il bug che i componenti locali introducevano nei fusi a ovest",
    );
    assert.equal(typeof lot.quantity_on_hand, "number");
    assert.equal(lot.quantity_on_hand, 100);
  });

  it("la normalizzazione vale anche DENTRO una transazione", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plot = await dal.rawQuery<{ id: string }>(
      `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
       values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 3)
       returning id`,
      [TENANT, companyId],
    );
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plot.rows[0].id,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: "2026-08-01",
      operator_name: null,
      notes: null,
    });

    // `startFieldSession` rilegge la task DENTRO la transazione e la riscrive:
    // se la lettura non fosse normalizzata, `planned_date` tornerebbe un Date e
    // finirebbe così nel payload di outbox.
    const session = await dal.startFieldSession({
      company_id: companyId,
      planned_task_id: task.id,
      plot_id: plot.rows[0].id,
      operation_type: "phytosanitary",
      recipe_id: null,
      machine_id: null,
      equipment_id: null,
      working_width_m: 4,
      operator_name: null,
      notes: null,
    });
    assert.ok(session);

    const reread = await dal.getPlannedTask(task.id);
    assert.equal(reread?.status, "IN_PROGRESS");
    assert.equal(typeof reread?.planned_date, "string");
    assert.equal(reread?.planned_date, "2026-08-01");
    assert.equal(typeof reread?.updated_at, "string");
  });

  it("i confronti fra stringhe usati dagli ordinamenti della UI non lanciano più", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plot = await dal.rawQuery<{ id: string }>(
      `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
       values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 3)
       returning id`,
      [TENANT, companyId],
    );
    const base = {
      company_id: companyId,
      plot_id: plot.rows[0].id,
      operation_type: "tillage" as const,
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED" as const,
      planned_date: null,
      operator_name: null,
      notes: null,
    };
    await dal.savePlannedTask(base);
    await dal.savePlannedTask(base);

    const tasks = await dal.listPlannedTasks(companyId);
    assert.equal(tasks.length, 2);
    // `created_at.localeCompare(...)` è esattamente ciò che fanno il riquadro di
    // pianificazione e la modale di rilevamento per ordinare le task senza data:
    // su un `Date` avrebbe lanciato "localeCompare is not a function".
    assert.doesNotThrow(() =>
      [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  });

  it("il payload di outbox porta timestamp ISO e numeri, non Date e stringhe", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plot = await dal.rawQuery<{ id: string }>(
      `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
       values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 3)
       returning id`,
      [TENANT, companyId],
    );
    const task = await dal.savePlannedTask({
      company_id: companyId,
      plot_id: plot.rows[0].id,
      operation_type: "phytosanitary",
      recipe_id: null,
      target_pest_or_disease: null,
      status: "PLANNED",
      planned_date: "2026-08-01",
      operator_name: null,
      notes: null,
    });
    await dal.setPlannedTaskStatus(task.id, "CANCELLED");

    const outbox = await dal.rawQuery<{ payload: Record<string, unknown> }>(
      `select payload from sync_outbox
       where table_name = 'planned_tasks' and operation = 'update'
       order by created_at desc limit 1`,
    );
    const payload = outbox.rows[0].payload;
    assert.equal(payload.planned_date, "2026-08-01");
    assert.equal(typeof payload.updated_at, "string");
  });
});
