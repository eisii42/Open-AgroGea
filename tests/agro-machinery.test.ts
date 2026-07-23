import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { WarehouseError } from "../packages/agro-core/src/db/dal-warehouse";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  evaluateMaintenance,
  fuelConsumption,
  rescheduleMaintenance,
} from "../plugins/agro-tools/src/machinery";

/**
 * Parco macchine 0.3.0 (schema v18): migrazione ADDITIVA non distruttiva (le
 * otto nuove tabelle si creano, sono idempotenti e i dati pre-esistenti
 * sopravvivono), contatori ore materializzati con storno esatto su
 * modifica/cancellazione, scarico atomico del carburante dalla cisterna,
 * scadenziari manutenzione/documenti a soglia, consumo l/h + anomalie e flusso
 * end-to-end della Definition of Done §7.
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

async function seedPlot(dal: TestDal, companyId: string): Promise<string> {
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 2.5)
     returning id`,
    [TENANT, companyId],
  );
  return plot.rows[0].id;
}

/** Data ISO (YYYY-MM-DD) a `giorni` da oggi (negativo = passato). */
function relativeDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const BASE_TREATMENT = {
  company_id: "",
  plot_id: null as string | null,
  plot_campaign_id: null,
  operation_type: "tillage" as const,
  product_name: null,
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
  executed_at: new Date().toISOString(),
  reentry_interval_h: null,
  safety_period_days: null,
  weather_conditions: null,
  note: null,
};

/** Crea una macchina con lettura iniziale del contaore (via adjustCounter). */
async function seedMachine(
  dal: TestDal,
  companyId: string,
  initialHours = 0,
): Promise<string> {
  const machine = await dal.upsertMachine({
    company_id: companyId,
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
  if (initialHours > 0) {
    await dal.adjustCounter({
      machine_id: machine.id,
      type: "initial_reading",
      new_value: initialHours,
      adjusted_at: relativeDay(-30),
    });
  }
  return machine.id;
}

/** Crea un product carburante + lot cisterna con la giacenza indicata. */
async function seedFuelCistern(
  dal: TestDal,
  companyId: string,
  liters: number,
): Promise<{ productId: string; lotId: string }> {
  const product = await dal.upsertProduct({
    company_id: companyId,
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
  const lot = await dal.receiveLot({
    product_id: product.id,
    lot_number: "CISTERNA",
    expires_at: null,
    initial_quantity: liters,
    unit_cost: 1.5,
  });
  return { productId: product.id, lotId: lot.id };
}

const NEW_TABLES = [
  "machines",
  "equipment",
  "activity_machines",
  "maintenance_schedules",
  "maintenance_logs",
  "machine_documents",
  "counter_adjustments",
  "fuel_refills",
];

describe("schema v18 / migrazione additiva Parco macchine", () => {
  it("crea le otto tabelle, è idempotente e preserva i dati pre-esistenti", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    // Record pre-esistente del Quaderno con il mezzo a TESTO LIBERO: il vincolo
    // di migrazione §3 impone che sopravviva intatto (fallback preservato).
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ('22222222-2222-2222-2222-222222222222', $1, 'Az')`,
      [TENANT],
    );
    await db.query(
      `insert into treatment_logs
         (id, tenant_id, company_id, operation_type, machinery_equipment, executed_at)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222',
               'tillage', 'Trattore vecchio a testo libero', now())`,
      [TENANT],
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

    // Il fallback testo libero è INTATTO.
    const legacy = await db.query<{ machinery_equipment: string }>(
      `select machinery_equipment from treatment_logs`,
    );
    assert.equal(legacy.rows.length, 1);
    assert.equal(
      legacy.rows[0].machinery_equipment,
      "Trattore vecchio a testo libero",
    );
  });

  it("il CHECK giacenza del lot resta la guardia atomica per il refill", async () => {
    // Il refill scarica il lot carburante: il vincolo quantity_on_hand >= 0
    // (Magazzino 0.2.0) deve continuare a valere anche dopo la migrazione v18.
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ('22222222-2222-2222-2222-222222222222', $1, 'Az')`,
      [TENANT],
    );
    const product = await db.query<{ id: string }>(
      `insert into products (id, tenant_id, company_id, category, name, unit, uma_code)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222',
               'fuel', 'Gasolio agricolo', 'l', 'UMA-1') returning id`,
      [TENANT],
    );
    const lot = await db.query<{ id: string }>(
      `insert into product_lots (id, tenant_id, product_id, initial_quantity, quantity_on_hand, unit_cost)
       values (gen_random_uuid(), $1, $2, 1000, 1000, 1.5) returning id`,
      [TENANT, product.rows[0].id],
    );
    await assert.rejects(
      db.query(
        `update product_lots set quantity_on_hand = quantity_on_hand - 2000 where id = $1`,
        [lot.rows[0].id],
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Engine puro: consumo l/h, anomalie, manutenzione (@agrogea/tools)
// ---------------------------------------------------------------------------

describe("fuelConsumption / consumo l/h pieno-a-pieno (§5.6)", () => {
  it("l/h = litri / Δore tra rifornimenti a pieno consecutivi", () => {
    const res = fuelConsumption([
      { refueled_at: "2026-05-01", liters: 50, counter_hours: 100, full_tank: true },
      { refueled_at: "2026-05-05", liters: 60, counter_hours: 110, full_tank: true },
      { refueled_at: "2026-05-10", liters: 40, counter_hours: 118, full_tank: true },
    ]);
    // Intervalli: 60/10 = 6, 40/8 = 5 → media 5.5, ultimo 5.
    assert.equal(res.sampleCount, 2);
    assert.equal(res.avgLitersPerHour, 5.5);
    assert.equal(res.lastLitersPerHour, 5);
  });

  it("primo rifornimento e contaore mancante: casi limite senza intervallo", () => {
    const res = fuelConsumption([
      { refueled_at: "2026-05-01", liters: 50, counter_hours: null, full_tank: true },
      { refueled_at: "2026-05-05", liters: 60, counter_hours: 110, full_tank: true },
    ]);
    // Nessuna ancora precedente con contaore → nessun intervallo calcolabile.
    assert.equal(res.sampleCount, 0);
    assert.equal(res.avgLitersPerHour, null);
    assert.equal(res.anomaly, false);
  });

  it("rifornimento parziale: i litri confluiscono nell'intervallo pieno", () => {
    const res = fuelConsumption([
      { refueled_at: "2026-05-01", liters: 30, counter_hours: 100, full_tank: true },
      { refueled_at: "2026-05-03", liters: 20, counter_hours: 105, full_tank: false },
      { refueled_at: "2026-05-06", liters: 40, counter_hours: 110, full_tank: true },
    ]);
    // Consumo tra i due pieni = 20 (parziale) + 40 (pieno) = 60 su 10 ore = 6.
    assert.equal(res.sampleCount, 1);
    assert.equal(res.lastLitersPerHour, 6);
  });

  it("segnala l'anomalia quando l'ultimo intervallo devia oltre soglia", () => {
    const res = fuelConsumption([
      { refueled_at: "2026-05-01", liters: 50, counter_hours: 100, full_tank: true },
      { refueled_at: "2026-05-05", liters: 50, counter_hours: 110, full_tank: true },
      { refueled_at: "2026-05-09", liters: 50, counter_hours: 120, full_tank: true },
      // Ultimo intervallo: 100 litri in 10 ore = 10 l/h contro ~5 storico.
      { refueled_at: "2026-05-13", liters: 100, counter_hours: 130, full_tank: true },
    ]);
    assert.equal(res.anomaly, true);
    assert.equal(res.lastLitersPerHour, 10);
  });
});

describe("evaluateMaintenance / soglie tempo e ore (§5.3)", () => {
  it("trigger a tempo: ok / due / overdue", () => {
    const today = new Date();
    const mk = (dueDate: string | null) => ({
      trigger_type: "time" as const,
      due_date: dueDate,
      due_hours: null,
    });
    assert.equal(evaluateMaintenance(mk(relativeDay(60)), 0, today).urgency, "ok");
    assert.equal(evaluateMaintenance(mk(relativeDay(10)), 0, today).urgency, "due");
    assert.equal(evaluateMaintenance(mk(relativeDay(-1)), 0, today).urgency, "overdue");
  });

  it("trigger a ore: due/overdue rispetto al contatore corrente", () => {
    const today = new Date();
    const mk = (dueHours: number) => ({
      trigger_type: "hours" as const,
      due_date: null,
      due_hours: dueHours,
    });
    // Contatore 480, soglia 500, anticipo 20 → due (residuo 20).
    assert.equal(evaluateMaintenance(mk(500), 480, today).urgency, "due");
    // Contatore 505 oltre la soglia 500 → overdue.
    assert.equal(evaluateMaintenance(mk(500), 505, today).urgency, "overdue");
    assert.equal(evaluateMaintenance(mk(600), 480, today).urgency, "ok");
  });
});

describe("rescheduleMaintenance / prossima scadenza", () => {
  it("a tempo: data intervento + intervallo giorni", () => {
    const next = rescheduleMaintenance(
      { trigger_type: "time", interval_days: 180, interval_hours: null },
      "2026-05-10",
      null,
    );
    assert.equal(next.due_date, "2026-11-06");
  });

  it("a ore: contaore intervento + intervallo ore", () => {
    const next = rescheduleMaintenance(
      { trigger_type: "hours", interval_days: null, interval_hours: 250 },
      "2026-05-10",
      480,
    );
    assert.equal(next.due_hours, 730);
  });
});

// ---------------------------------------------------------------------------
// DAL: contatori ore automatici (§5.2)
// ---------------------------------------------------------------------------

describe("DAL Parco macchine / contatori ore automatici (§5.2)", () => {
  it("il salvataggio attività incrementa contaore macchina e usura attrezzo", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const machineId = await seedMachine(dal, companyId, 100);
    const equip = await dal.upsertEquipment({
      company_id: companyId,
      name: "Aratro",
      equipment_type: "Aratro",
      working_width_m: 3,
      status: "operational",
      purchase_value: null,
      purchase_date: null,
      useful_life_hours: null,
      useful_life_years: null,
      residual_value: null,
      notes: null,
    });

    await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
      [],
      [{ machine_id: machineId, equipment_id: equip.id, hours: 8 }],
    );

    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 108);
    assert.equal(Number((await dal.getEquipment(equip.id))?.usage_counter), 8);
  });

  it("la cancellazione dell'attività storna i contatori senza scostamenti", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 100);
    const { treatment } = await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId },
      [],
      [{ machine_id: machineId, hours: 8 }],
    );
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 108);

    await dal.deleteTreatment(treatment.id);
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 100);
  });

  it("la modifica dei mezzi ricalcola i contatori (storno vecchi + nuovi)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 100);
    const { treatment } = await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId },
      [],
      [{ machine_id: machineId, hours: 8 }],
    );
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 108);

    // Correzione: erano 5 ore, non 8.
    await dal.updateActivityMachines(treatment.id, [
      { machine_id: machineId, hours: 5 },
    ]);
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 105);
  });

  it("rettifica manuale: audit + SET del contatore; l'incremento riparte dal reale", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 100);

    // Sostituzione motore: reset del contatore a 0.
    await dal.adjustCounter({
      machine_id: machineId,
      type: "engine_reset",
      new_value: 0,
      adjusted_at: relativeDay(-1),
      reason: "Sostituzione motore",
    });
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 0);

    // L'incremento successivo parte dal valore rettificato (0), non da 100.
    await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId },
      [],
      [{ machine_id: machineId, hours: 12 }],
    );
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 12);

    // Audit trail: lettura iniziale + reset registrati.
    const adj = await dal.listCounterAdjustments({ machineId });
    assert.equal(adj.length, 2);
    assert.equal(adj[0].type, "engine_reset");
    assert.equal(Number(adj[0].previous_value), 100);
  });
});

// ---------------------------------------------------------------------------
// DAL: refill carburante atomico (§5.5) e consumo (§5.6)
// ---------------------------------------------------------------------------

describe("DAL Parco macchine / refill carburante atomico (§5.5)", () => {
  it("il refill scarica la cisterna, deriva l'UMA e traccia il mezzo", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 200);
    const { lotId } = await seedFuelCistern(dal, companyId, 1000);

    const refill = await dal.recordFuelRefill({
      machine_id: machineId,
      product_lot_id: lotId,
      liters: 120,
      refueled_at: relativeDay(0),
      counter_hours: 200,
      operator_name: null,
      full_tank: true,
      notes: null,
    });
    assert.equal(refill.uma_code, "UMA-2026"); // derivato dal product
    const lots = await dal.listLotti(companyId, { productId: undefined });
    const cistern = lots.find((l) => l.id === lotId);
    assert.equal(Number(cistern?.quantity_on_hand), 880); // 1000 − 120

    const refills = await dal.listFuelRefills(companyId, { machineId });
    assert.equal(refills.length, 1);
  });

  it("giacenza cisterna insufficiente: BLOCCO atomico, niente refill", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId);
    const { lotId } = await seedFuelCistern(dal, companyId, 100);

    await assert.rejects(
      dal.recordFuelRefill({
        machine_id: machineId,
        product_lot_id: lotId,
        liters: 150, // > 100 disponibili
        refueled_at: relativeDay(0),
        counter_hours: null,
        operator_name: null,
        full_tank: true,
        notes: null,
      }),
      (e: unknown) =>
        e instanceof WarehouseError && e.code === "insufficient_stock",
    );
    const refills = await dal.listFuelRefills(companyId);
    assert.equal(refills.length, 0);
    const lot = (await dal.listLotti(companyId)).find((l) => l.id === lotId);
    assert.equal(Number(lot?.quantity_on_hand), 100); // intatta
  });

  it("lo storno del refill reintegra la giacenza della cisterna", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId);
    const { lotId } = await seedFuelCistern(dal, companyId, 1000);
    const refill = await dal.recordFuelRefill({
      machine_id: machineId,
      product_lot_id: lotId,
      liters: 200,
      refueled_at: relativeDay(0),
      counter_hours: null,
      operator_name: null,
      full_tank: true,
      notes: null,
    });
    await dal.deleteFuelRefill(refill.id);
    const lot = (await dal.listLotti(companyId)).find((l) => l.id === lotId);
    assert.equal(Number(lot?.quantity_on_hand), 1000); // reintegrata
  });
});

// ---------------------------------------------------------------------------
// DAL: manutenzione (riprogrammazione + ricambi) e documenti
// ---------------------------------------------------------------------------

describe("DAL Parco macchine / manutenzione (§5.3)", () => {
  it("l'intervento riprogramma il piano ricorrente a ore", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 480);
    const schedule = await dal.upsertMaintenanceSchedule({
      machine_id: machineId,
      equipment_id: null,
      name: "Cambio olio",
      category: "routine",
      trigger_type: "hours",
      interval_days: null,
      due_date: null,
      interval_hours: 250,
      due_hours: 500,
      active: true,
      notes: null,
    });

    await dal.recordMaintenance({
      schedule_id: schedule.id,
      machine_id: machineId,
      equipment_id: null,
      performed_at: relativeDay(0),
      counter_hours: 500,
      description: "Cambio olio e filtri",
      cost: 120,
      parts: "Olio 15W40, filtro",
      product_lot_id: null,
      parts_quantity: null,
    });

    const schedules = await dal.listMaintenanceSchedules(companyId);
    // Nuova soglia = 500 (ore intervento) + 250 (intervallo) = 750.
    assert.equal(Number(schedules[0].due_hours), 750);
  });

  it("scarico ricambio dal Magazzino: atomico, blocco su giacenza insufficiente", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId, 100);
    // Ricambio in categoria 'other'.
    const part = await dal.upsertProduct({
      company_id: companyId,
      category: "other",
      name: "Filtro olio",
      unit: "pz",
      registration_number: null,
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      notes: null,
    });
    const lot = await dal.receiveLot({
      product_id: part.id,
      lot_number: "F-1",
      expires_at: null,
      initial_quantity: 3,
      unit_cost: 12,
    });

    await dal.recordMaintenance({
      schedule_id: null,
      machine_id: machineId,
      equipment_id: null,
      performed_at: relativeDay(0),
      counter_hours: 100,
      description: "Sostituzione filtro",
      cost: 12,
      parts: null,
      product_lot_id: lot.id,
      parts_quantity: 1,
    });
    const after = (await dal.listLotti(companyId)).find((l) => l.id === lot.id);
    assert.equal(Number(after?.quantity_on_hand), 2); // 3 − 1

    // Oltre la giacenza → blocco, nessun log scritto.
    await assert.rejects(
      dal.recordMaintenance({
        schedule_id: null,
        machine_id: machineId,
        equipment_id: null,
        performed_at: relativeDay(0),
        counter_hours: 100,
        description: "Troppi filtri",
        cost: null,
        parts: null,
        product_lot_id: lot.id,
        parts_quantity: 99,
      }),
      (e: unknown) =>
        e instanceof WarehouseError && e.code === "insufficient_stock",
    );
    const logs = await dal.listMaintenanceLogs({ machineId });
    assert.equal(logs.length, 1); // solo il primo intervento
  });

  it("documenti in scadenza entro soglia (§5.4)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const machineId = await seedMachine(dal, companyId);
    await dal.upsertMachineDocument({
      machine_id: machineId,
      equipment_id: null,
      type: "insurance",
      reference: "RCA-1",
      issued_at: null,
      expires_at: relativeDay(20),
      issuer: "Assicurazione X",
      amount: null,
      attachment_path: null,
      notes: null,
    });
    await dal.upsertMachineDocument({
      machine_id: machineId,
      equipment_id: null,
      type: "inspection",
      reference: "REV-1",
      issued_at: null,
      expires_at: relativeDay(200),
      issuer: null,
      amount: null,
      attachment_path: null,
      notes: null,
    });
    const expiring = await dal.listExpiringDocuments(companyId, 30);
    assert.equal(expiring.length, 1);
    assert.equal(expiring[0].reference, "RCA-1");
  });
});

// ---------------------------------------------------------------------------
// Integrazione end-to-end (Definition of Done §7)
// ---------------------------------------------------------------------------

describe("Definition of Done §7 / flusso Parco macchine end-to-end", () => {
  it("mezzo → attività (contatore) → manutenzione → documento → refill (l/h)", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    // 1) Anagrafica mezzo con lettura iniziale contaore.
    const machineId = await seedMachine(dal, companyId, 480);

    // 2) Attività di campo → contatore +8 (488).
    await dal.insertTreatmentWithIssues(
      {
        ...BASE_TREATMENT,
        company_id: companyId,
        plot_id: plotId,
        operation_type: "tillage",
      },
      [],
      [{ machine_id: machineId, hours: 8 }],
    );
    assert.equal(Number((await dal.getMachine(machineId))?.hour_counter), 488);

    // 3) Scadenziario manutenzione a ore → alert (soglia 500, contatore 488).
    await dal.upsertMaintenanceSchedule({
      machine_id: machineId,
      equipment_id: null,
      name: "Tagliando",
      category: "routine",
      trigger_type: "hours",
      interval_days: null,
      due_date: null,
      interval_hours: 250,
      due_hours: 500,
      active: true,
      notes: null,
    });
    const sched = (await dal.listMaintenanceSchedules(companyId))[0];
    assert.equal(
      evaluateMaintenance(sched, 488, new Date()).urgency,
      "due",
    );

    // 4) Documento in scadenza → alert.
    await dal.upsertMachineDocument({
      machine_id: machineId,
      equipment_id: null,
      type: "road_tax",
      reference: "BOLLO-1",
      issued_at: null,
      expires_at: relativeDay(15),
      issuer: null,
      amount: null,
      attachment_path: null,
      notes: null,
    });
    assert.equal((await dal.listExpiringDocuments(companyId, 30)).length, 1);

    // 5) Refill dalla cisterna (blocco atomico) + consumo l/h derivato.
    const { lotId } = await seedFuelCistern(dal, companyId, 1000);
    await dal.recordFuelRefill({
      machine_id: machineId,
      product_lot_id: lotId,
      liters: 60,
      refueled_at: "2026-05-01",
      counter_hours: 480,
      operator_name: null,
      full_tank: true,
      notes: null,
    });
    await dal.recordFuelRefill({
      machine_id: machineId,
      product_lot_id: lotId,
      liters: 60,
      refueled_at: "2026-05-08",
      counter_hours: 490,
      operator_name: null,
      full_tank: true,
      notes: null,
    });
    const cistern = (await dal.listLotti(companyId)).find((l) => l.id === lotId);
    assert.equal(Number(cistern?.quantity_on_hand), 880); // 1000 − 120

    const refills = await dal.fuelRefillsForMachine(machineId);
    const consumo = fuelConsumption(
      refills.map((r) => ({
        refueled_at: r.refueled_at,
        liters: Number(r.liters),
        counter_hours: r.counter_hours != null ? Number(r.counter_hours) : null,
        full_tank: r.full_tank,
      })),
    );
    // 60 litri in (490 − 480) = 10 ore → 6 l/h.
    assert.equal(consumo.lastLitersPerHour, 6);

    // 7) Nessuna regressione: il Magazzino resta coerente (giacenza scaricata).
    assert.ok(Number(cistern?.quantity_on_hand) < 1000);
  });
});
