import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  fullTransferScope,
  serializeCompanySnapshot,
  type Company,
  type TransferScope,
} from "../packages/agro-core/src";
import {
  buildCompanySnapshot,
  importCompanyData,
} from "../apps/agro-field-suite/src/services/companyDataIo";

/**
 * Backup dell'azienda end-to-end su PGlite reale: dall'archivio al file e da
 * un file a un archivio VUOTO. È qui che si vede se il backup è davvero
 * completo — il formato da solo non lo dimostra — e se il ripristino rimette i
 * numeri come stavano invece di rigiocare le operazioni (una giacenza
 * ricalcolata sarebbe un dato falso, non un dato ripristinato).
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

async function seedCompany(dal: TestDal, name = "Company Test"): Promise<Company> {
  const inserted = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name, country)
     values (gen_random_uuid(), $1, $2, 'IT') returning id`,
    [TENANT, name],
  );
  const companies = await dal.listAziende();
  const company = companies.find((c) => c.id === inserted.rows[0].id);
  assert.ok(company);
  return company;
}

async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1',
             '{"type":"Polygon","coordinates":[[[11,43],[11.01,43],[11.01,43.01],[11,43]]]}'::jsonb,
             2.5)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

function treatmentInput(companyId: string, plotId: string, executedAt: string) {
  return {
    company_id: companyId,
    plot_id: plotId,
    plot_campaign_id: null,
    operation_type: "phytosanitary" as const,
    product_name: "Rameico 50",
    registration_number: null,
    dose_value: null,
    dose_unit: null,
    total_quantity: null,
    target_disease: null,
    operator_name: null,
    machinery_equipment: null,
    active_substance: null,
    water_volume_l: null,
    operator_tax_code: null,
    license_number: null,
    fertilizer_type: null,
    npk_ratio: null,
    executed_at: executedAt,
    reentry_interval_h: null,
    safety_period_days: null,
    weather_conditions: null,
    note: null,
  };
}

/**
 * Azienda "piena": un campo lavorato, un deposito georeferenziato con un lotto
 * parzialmente consumato da un trattamento, un trattore che ha fatto il pieno
 * dalla cisterna e una lavorazione programmata.
 */
async function seedFullCompany(dal: TestDal): Promise<{
  company: Company;
  plotId: string;
  lotId: string;
  treatmentId: string;
}> {
  const company = await seedCompany(dal);
  const plotId = await seedPlot(dal, company.id);

  const warehouse = await dal.upsertWarehouse({
    company_id: company.id,
    name: "Deposito agrofarmaci",
    warehouse_type: "phytosanitary",
    geometry: { type: "Point", coordinates: [11.25, 43.77] },
    address: null,
    notes: null,
    metadata: {},
  });
  const product = await dal.upsertProduct({
    company_id: company.id,
    category: "phytosanitary",
    name: "Rameico 50",
    unit: "kg",
    registration_number: "12345",
    npk_n: null,
    npk_p: null,
    npk_k: null,
    uma_code: null,
    notes: null,
  });
  const lot = await dal.receiveLot({
    product_id: product.id,
    warehouse_id: warehouse.id,
    lot_number: "L-2026-07",
    expires_at: null,
    initial_quantity: 100,
    unit_cost: 12.5,
  });
  const { treatment } = await dal.insertTreatmentWithIssues(
    treatmentInput(company.id, plotId, "2026-05-10T08:00:00.000Z"),
    [{ product_lot_id: lot.id, quantity: 37.5 }],
  );

  const machine = await dal.upsertMachine({
    company_id: company.id,
    name: "Trattore 1",
    machine_type: "Trattore",
    license_plate: null,
    chassis_number: null,
    brand: null,
    model: null,
    year: null,
    status: "operational",
    purchase_value: null,
    purchase_date: null,
    useful_life_hours: null,
    useful_life_years: null,
    residual_value: null,
    notes: null,
  });
  const fuel = await dal.upsertProduct({
    company_id: company.id,
    category: "fuel",
    name: "Gasolio agricolo",
    unit: "l",
    registration_number: null,
    npk_n: null,
    npk_p: null,
    npk_k: null,
    uma_code: "UMA-2026",
    notes: null,
  });
  const cistern = await dal.receiveLot({
    product_id: fuel.id,
    lot_number: "CISTERNA",
    expires_at: null,
    initial_quantity: 1000,
    unit_cost: 1.5,
  });
  await dal.recordFuelRefill({
    machine_id: machine.id,
    product_lot_id: cistern.id,
    liters: 120,
    refueled_at: "2026-05-11T07:00:00.000Z",
    counter_hours: 340,
    operator_name: null,
    full_tank: true,
    notes: null,
  });

  await dal.savePlannedTask({
    company_id: company.id,
    plot_id: plotId,
    operation_type: "tillage",
    recipe_id: null,
    target_pest_or_disease: null,
    planned_date: "2026-06-01",
    operator_name: null,
    notes: null,
    metadata: {},
  });

  return { company, plotId, lotId: lot.id, treatmentId: treatment.id };
}

/** Esporta e riporta il documento al formato in cui viaggia (JSON su disco). */
async function exportDocument(
  dal: TestDal,
  company: Company,
  scope: TransferScope = fullTransferScope(),
): Promise<unknown> {
  const snapshot = await buildCompanySnapshot(dal, company, scope);
  return JSON.parse(JSON.stringify(serializeCompanySnapshot(snapshot)));
}

describe("backup azienda / copertura dell'export", () => {
  it("il backup completo porta con sé magazzino, parco macchine e pianificazione", async () => {
    const dal = await TestDal.create();
    const { company } = await seedFullCompany(dal);
    const snapshot = await buildCompanySnapshot(dal, company);

    assert.equal(snapshot.plots.length, 1);
    assert.equal(snapshot.plots[0].treatments.length, 1);
    assert.equal(snapshot.warehouse.warehouses.length, 1);
    assert.equal(snapshot.warehouse.products.length, 2);
    assert.equal(snapshot.warehouse.lots.length, 2);
    assert.equal(snapshot.warehouse.movements.length, 1);
    assert.equal(snapshot.machinery.machines.length, 1);
    assert.equal(snapshot.machinery.fuelRefills.length, 1);
    assert.equal(snapshot.planning.plannedTasks.length, 1);
  });

  it("una sezione esclusa non finisce nel file, e il file lo dichiara", async () => {
    const dal = await TestDal.create();
    const { company } = await seedFullCompany(dal);
    const snapshot = await buildCompanySnapshot(dal, company, {
      sections: ["plots", "treatments"],
      period: null,
    });

    assert.equal(snapshot.warehouse.products.length, 0);
    assert.equal(snapshot.machinery.machines.length, 0);
    assert.deepEqual(snapshot.scope.sections, ["plots", "treatments"]);
  });

  it("il periodo taglia i fatti datati ma non le anagrafiche", async () => {
    const dal = await TestDal.create();
    const { company } = await seedFullCompany(dal);
    const snapshot = await buildCompanySnapshot(dal, company, {
      sections: [...fullTransferScope().sections],
      period: { from: "2026-01-01", to: "2026-04-30" },
    });

    // Il trattamento è di maggio: fuori periodo.
    assert.equal(snapshot.plots[0].treatments.length, 0);
    // Lo scarico segue il trattamento: senza la sua attività sarebbe orfano.
    assert.equal(snapshot.warehouse.movements.length, 0);
    assert.equal(snapshot.machinery.fuelRefills.length, 0);
    // Ma il campo, i prodotti, i lotti e il trattore restano: senza di loro il
    // file non sarebbe ripristinabile.
    assert.equal(snapshot.plots.length, 1);
    assert.equal(snapshot.warehouse.products.length, 2);
    assert.equal(snapshot.warehouse.lots.length, 2);
    assert.equal(snapshot.machinery.machines.length, 1);
  });
});

describe("backup azienda / ripristino su un archivio vuoto", () => {
  it("rimette i dati com'erano, giacenze e CUMP compresi", async () => {
    const source = await TestDal.create();
    const { company, lotId } = await seedFullCompany(source);
    const document = await exportDocument(source, company);

    const target = await TestDal.create();
    const destination = await seedCompany(target, "Azienda ripristinata");
    const summary = await importCompanyData(target, document, destination.id);

    assert.equal(summary.plots, 1);
    assert.equal(summary.treatments, 1);
    assert.equal(summary.linksSkipped, 0);

    const warehouses = await target.listWarehouses(destination.id);
    assert.equal(warehouses.length, 1);
    assert.deepEqual(warehouses[0].geometry, {
      type: "Point",
      coordinates: [11.25, 43.77],
    });

    // La giacenza è quella che era rimasta dopo lo scarico, non la quantità
    // caricata: il ripristino riscrive le righe, non rigioca il carico.
    const lots = await target.listLotti(destination.id);
    const restored = lots.find((l) => l.id === lotId);
    assert.equal(Number(restored?.quantity_on_hand), 62.5);
    assert.equal(Number(restored?.initial_quantity), 100);
    assert.equal(restored?.warehouse_id, warehouses[0].id);

    const cistern = lots.find((l) => l.lot_number === "CISTERNA");
    assert.equal(Number(cistern?.quantity_on_hand), 880);

    const refills = await target.listFuelRefills(destination.id);
    assert.equal(refills.length, 1);
    assert.equal(Number(refills[0].liters), 120);

    const tasks = await target.listPlannedTasks(destination.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].planned_date, "2026-06-01");
  });

  it("è idempotente: ripristinare due volte non duplica nulla", async () => {
    const source = await TestDal.create();
    const { company } = await seedFullCompany(source);
    const document = await exportDocument(source, company);

    const target = await TestDal.create();
    const destination = await seedCompany(target, "Azienda ripristinata");
    await importCompanyData(target, document, destination.id);
    await importCompanyData(target, document, destination.id);

    assert.equal((await target.listPlots(destination.id)).length, 1);
    assert.equal((await target.listProducts(destination.id)).length, 2);
    assert.equal((await target.listFuelRefills(destination.id)).length, 1);
    assert.equal((await target.listPlannedTasks(destination.id)).length, 1);
  });

  it("un backup parziale non fa fallire il ripristino: salta ciò che non aggancia", async () => {
    // Magazzino escluso ⇒ nel file ci sono i rifornimenti ma non la cisterna
    // da cui attingevano. Il rifornimento va saltato, tutto il resto entra.
    const source = await TestDal.create();
    const { company } = await seedFullCompany(source);
    const document = await exportDocument(source, company, {
      sections: ["plots", "treatments", "machinery", "planning"],
      period: null,
    });

    const target = await TestDal.create();
    const destination = await seedCompany(target, "Azienda ripristinata");
    const summary = await importCompanyData(target, document, destination.id);

    assert.equal(summary.machinery > 0, true);
    assert.equal((await target.listFuelRefills(destination.id)).length, 0);
    assert.equal(summary.linksSkipped, 1);
    // Ciò che non dipendeva dal magazzino è comunque tornato.
    assert.equal((await target.listMachines(destination.id)).length, 1);
    assert.equal((await target.listPlannedTasks(destination.id)).length, 1);
  });
});
