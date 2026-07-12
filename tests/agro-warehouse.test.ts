import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { WarehouseError } from "../packages/agro-core/src/db/dal-warehouse";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  cumpAfterInbound,
  expiryStatus,
  validateProduct,
} from "../packages/agro-core/src/warehouse/cump";

/**
 * Magazzino 0.2.0 (schema v16): CUMP (media ponderata mobile), issue ATOMICO
 * dei lots dalle attività del Quaderno (blocco per stock negativa e lots
 * scaduti), alert di scadenza, migrazione additiva (i dati testo-libero
 * pre-esistenti di treatment_logs sopravvivono) e flusso end-to-end della
 * Definition of Done §6.
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
  operation_type: "phytosanitary" as const,
  product_name: "Poltiglia",
  registration_number: "12345",
  dose_value: 2,
  dose_unit: "kg/ha" as const,
  total_quantity: 5,
  target_disease: "Peronospora",
  operator_name: null,
  machinery_equipment: null,
  active_substance: "Rame",
  water_volume_l: null,
  operator_tax_code: null,
  license_number: "PAT-1",
  fertilizer_type: null,
  npk_ratio: null,
  executed_at: new Date().toISOString(),
  reentry_interval_h: null,
  safety_period_days: null,
  weather_conditions: null,
  note: null,
};

describe("CUMP / media ponderata mobile (funzione pura)", () => {
  it("primo carico su stock vuota: CUMP = costo di carico", () => {
    assert.equal(cumpAfterInbound(0, 0, 100, 12.5), 12.5);
  });

  it("carico successivo: media ponderata sulle giacenze", () => {
    // 100 kg a 10 € in stock + 50 kg a 16 € → (1000+800)/150 = 12 €
    assert.equal(cumpAfterInbound(100, 10, 50, 16), 12);
  });

  it("giacenza esaurita: il CUMP riparte dal costo del nuovo carico", () => {
    assert.equal(cumpAfterInbound(0, 10, 40, 20), 20);
  });

  it("quantità non positiva: CUMP invariato", () => {
    assert.equal(cumpAfterInbound(100, 10, 0, 99), 10);
  });
});

describe("expiryStatus / alert lots", () => {
  it("classifica valido, in scadenza (soglia 30gg) e scaduto", () => {
    const today = new Date();
    assert.equal(expiryStatus(null, today), "valid");
    assert.equal(expiryStatus(relativeDay(60), today), "valid");
    assert.equal(expiryStatus(relativeDay(10), today), "expiring");
    assert.equal(expiryStatus(relativeDay(-1), today), "expired");
    // Un lot che scade oggi è ancora utilizzabile.
    assert.notEqual(expiryStatus(relativeDay(0), today), "expired");
  });

  it("soglia configurabile", () => {
    const today = new Date();
    assert.equal(expiryStatus(relativeDay(10), today, 5), "valid");
    assert.equal(expiryStatus(relativeDay(4), today, 5), "expiring");
  });
});

describe("validateProduct / categorie rigide", () => {
  it("agrofarmaco senza n. registrazione PAN è invalido", () => {
    const errors = validateProduct({
      category: "phytosanitary",
      name: "Poltiglia",
      unit: "kg",
    });
    assert.ok(errors.some((e) => e.field === "registration_number"));
  });

  it("concime richiede i tre titoli N-P-K in percentuale", () => {
    const errors = validateProduct({
      category: "fertilizer",
      name: "Concime",
      unit: "kg",
      npk_n: 15,
      npk_p: 200, // fuori range
    });
    assert.deepEqual(
      errors.map((e) => e.field).sort(),
      ["npk_k", "npk_p"],
    );
  });

  it("carburante richiede l'assegnazione UMA; le sementi solo name+unità", () => {
    assert.ok(
      validateProduct({ category: "fuel", name: "Gasolio", unit: "l" }).some(
        (e) => e.field === "uma_code",
      ),
    );
    assert.equal(
      validateProduct({ category: "seed", name: "Frumento", unit: "kg" }).length,
      0,
    );
  });
});

describe("schema v16 / migrazione additiva", () => {
  it("crea le tabelle warehouse, è idempotente e preserva i dati testo-libero", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    // Record pre-esistente del Quaderno con products/mezzi a testo libero.
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ('22222222-2222-2222-2222-222222222222', $1, 'Az')`,
      [TENANT],
    );
    await db.query(
      `insert into treatment_logs
         (id, tenant_id, company_id, operation_type, product_name, machinery_equipment, executed_at)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222',
               'phytosanitary', 'Product testo libero', 'Atomizzatore vecchio', now())`,
      [TENANT],
    );

    // Ri-applicazione (aggiornamento di un'istanza esistente): idempotente.
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const nomi = tables.rows.map((r) => r.table_name);
    for (const t of ["products", "product_lots", "activity_products"]) {
      assert.ok(nomi.includes(t), `manca la tabella ${t}`);
    }

    // Estensione anagrafica (sostanza attiva, fornitore) + categoria residuale
    // 'other': columns presenti e CHECK aggiornato anche su istanze ri-migrate.
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name='products'`,
    );
    const colNames = cols.rows.map((r) => r.column_name);
    for (const c of ["active_substance", "supplier"]) {
      assert.ok(colNames.includes(c), `products manca ${c}`);
    }
    await db.query(
      `insert into products (id, tenant_id, company_id, category, name)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222', 'other', 'Filo per legatura')`,
      [TENANT],
    );

    // Il fallback testo libero è INTATTO (vincolo di migrazione §3).
    const legacy = await db.query<{ product_name: string; machinery_equipment: string }>(
      `select product_name, machinery_equipment from treatment_logs`,
    );
    assert.equal(legacy.rows.length, 1);
    assert.equal(legacy.rows[0].product_name, "Product testo libero");
    assert.equal(legacy.rows[0].machinery_equipment, "Atomizzatore vecchio");
  });
});

describe("DAL warehouse / carico lots e CUMP", () => {
  it("il carico crea il lot, update il CUMP e accoda entrambe le mutazioni", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const product = await dal.upsertProduct({
      company_id: companyId,
      category: "phytosanitary",
      name: "Poltiglia Bordolese",
      unit: "kg",
      registration_number: "12345",
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      notes: null,
    });

    await dal.receiveLot({
      product_id: product.id,
      lot_number: "L-2026-01",
      expires_at: relativeDay(365),
      initial_quantity: 100,
      unit_cost: 10,
    });
    await dal.receiveLot({
      product_id: product.id,
      lot_number: "L-2026-02",
      expires_at: relativeDay(400),
      initial_quantity: 50,
      unit_cost: 16,
    });

    const updated = await dal.getProduct(product.id);
    assert.equal(Number(updated?.avg_unit_cost), 12); // (100·10 + 50·16)/150

    const lots = await dal.listLotti(companyId, { productId: product.id });
    assert.equal(lots.length, 2);
    assert.deepEqual(
      lots.map((l) => Number(l.quantity_on_hand)),
      [100, 50],
    );

    // Outbox: product (insert) + 2×(lot + aggiornamento CUMP).
    const outbox = await dal.listPendingMutations();
    const perTabella = outbox.reduce<Record<string, number>>((acc, m) => {
      acc[m.table_name] = (acc[m.table_name] ?? 0) + 1;
      return acc;
    }, {});
    assert.equal(perTabella.product_lots, 2);
    assert.ok((perTabella.products ?? 0) >= 3);
  });

  it("il product invalido per categoria è rifiutato", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    await assert.rejects(
      dal.upsertProduct({
        company_id: companyId,
        category: "fertilizer",
        name: "Concime senza titoli",
        unit: "kg",
        registration_number: null,
        npk_n: null,
        npk_p: null,
        npk_k: null,
        uma_code: null,
        notes: null,
      }),
      (e: unknown) => e instanceof WarehouseError && e.code === "invalid_product",
    );
  });
});

describe("DAL warehouse / issue atomico (§5.2)", () => {
  async function setup() {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);
    const product = await dal.upsertProduct({
      company_id: companyId,
      category: "phytosanitary",
      name: "Poltiglia",
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
      lot_number: "L-1",
      expires_at: relativeDay(180),
      initial_quantity: 10,
      unit_cost: 8,
    });
    return { dal, companyId, plotId, product, lot };
  }

  it("scarica la stock e congela il costo CUMP nella giunzione", async () => {
    const { dal, companyId, plotId, lot } = await setup();
    const { treatment, issues } = await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
      [{ product_lot_id: lot.id, quantity: 4 }],
    );

    const lots = await dal.listLotti(companyId);
    assert.equal(Number(lots[0].quantity_on_hand), 6);

    assert.equal(issues.length, 1);
    assert.equal(issues[0].unit_cost, 8); // CUMP al momento dello issue
    assert.equal(issues[0].total_cost, 32); // 4 × 8

    const registrati = await dal.listScarichiAttivita(treatment.id);
    assert.equal(registrati.length, 1);
    assert.equal(registrati[0].product_name, "Poltiglia");
  });

  it("giacenza insufficiente: BLOCCO atomico, nessuna scrittura parziale", async () => {
    const { dal, companyId, plotId, lot } = await setup();
    const outboxBefore = await dal.countPendingMutations();

    await assert.rejects(
      dal.insertTreatmentWithIssues(
        { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
        [{ product_lot_id: lot.id, quantity: 11 }], // > 10 disponibili
      ),
      (e: unknown) =>
        e instanceof WarehouseError && e.code === "insufficient_stock",
    );

    // NIENTE è stato scritto: attività, issues, stock e outbox invariati.
    const treatments = await dal.listTreatments(companyId);
    assert.equal(treatments.length, 0);
    const lots = await dal.listLotti(companyId);
    assert.equal(Number(lots[0].quantity_on_hand), 10);
    const issues = await dal.rawQuery(`select * from activity_products`);
    assert.equal(issues.rows.length, 0);
    assert.equal(await dal.countPendingMutations(), outboxBefore);
  });

  it("scarico multi-lot: se il SECONDO lot non basta, si annulla anche il primo", async () => {
    const { dal, companyId, plotId, product, lot } = await setup();
    const lot2 = await dal.receiveLot({
      product_id: product.id,
      lot_number: "L-2",
      expires_at: relativeDay(180),
      initial_quantity: 5,
      unit_cost: 8,
    });

    await assert.rejects(
      dal.insertTreatmentWithIssues(
        { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
        [
          { product_lot_id: lot.id, quantity: 4 }, // ok
          { product_lot_id: lot2.id, quantity: 6 }, // > 5: fallisce
        ],
      ),
      (e: unknown) =>
        e instanceof WarehouseError && e.code === "insufficient_stock",
    );

    const lots = await dal.listLotti(companyId);
    assert.deepEqual(
      lots.map((l) => Number(l.quantity_on_hand)).sort((a, b) => a - b),
      [5, 10], // entrambi INTATTI
    );
  });

  it("lotto scaduto: uso bloccato", async () => {
    const { dal, companyId, plotId, product } = await setup();
    const scaduto = await dal.receiveLot({
      product_id: product.id,
      lot_number: "L-EXP",
      expires_at: relativeDay(-5),
      initial_quantity: 20,
      unit_cost: 8,
    });

    await assert.rejects(
      dal.insertTreatmentWithIssues(
        { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
        [{ product_lot_id: scaduto.id, quantity: 1 }],
      ),
      (e: unknown) => e instanceof WarehouseError && e.code === "expired_lot",
    );
  });

  it("l'eliminazione dell'attività storna gli issues e reintegra la giacenza", async () => {
    const { dal, companyId, plotId, lot } = await setup();
    const { treatment } = await dal.insertTreatmentWithIssues(
      { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
      [{ product_lot_id: lot.id, quantity: 4 }],
    );

    await dal.deleteTreatment(treatment.id);

    const lots = await dal.listLotti(companyId);
    assert.equal(Number(lots[0].quantity_on_hand), 10); // reintegrata
    const issues = await dal.listScarichiAttivita(treatment.id);
    assert.equal(issues.length, 0); // tombstone
    const treatments = await dal.listTreatments(companyId);
    assert.equal(treatments.length, 0);
  });
});

describe("Definition of Done §6 / flusso end-to-end", () => {
  it("prodotto → lot → attività → stock, costo al field, alert, fallback", async () => {
    const dal = await TestDal.create();
    const companyId = await seedCompany(dal);
    const plotId = await seedPlot(dal, companyId);

    // 0) Record pre-esistente a testo libero (fallback da preservare).
    const legacy = await dal.insertTreatment({
      ...BASE_TREATMENT,
      company_id: companyId,
      plot_id: plotId,
      product_name: "Vecchio product testo libero",
    });

    // 1) Product con i campi obbligatori della categoria + lot con scadenza.
    const product = await dal.upsertProduct({
      company_id: companyId,
      category: "fertilizer",
      name: "Nitrato ammonico",
      unit: "kg",
      registration_number: null,
      npk_n: 26,
      npk_p: 0,
      npk_k: 0,
      uma_code: null,
      notes: null,
    });
    const lot = await dal.receiveLot({
      product_id: product.id,
      lot_number: "NA-26-001",
      expires_at: relativeDay(20), // entro la threshold alert default (30)
      initial_quantity: 300,
      unit_cost: 0.55,
    });

    // 2) L'attività download il lot reale.
    await dal.insertTreatmentWithIssues(
      {
        ...BASE_TREATMENT,
        company_id: companyId,
        plot_id: plotId,
        operation_type: "fertilization",
        product_name: "Nitrato ammonico",
        total_quantity: 120,
      },
      [{ product_lot_id: lot.id, quantity: 120 }],
    );

    // 3) Giacenza aggiornata…
    const lots = await dal.listLotti(companyId, { productId: product.id });
    assert.equal(Number(lots[0].quantity_on_hand), 180);
    // …e blocco atomico oltre la disponibilità residua.
    await assert.rejects(
      dal.insertTreatmentWithIssues(
        { ...BASE_TREATMENT, company_id: companyId, plot_id: plotId },
        [{ product_lot_id: lot.id, quantity: 999 }],
      ),
      (e: unknown) =>
        e instanceof WarehouseError && e.code === "insufficient_stock",
    );

    // 4) Costo (via CUMP) imputato al field trattato.
    const costi = await dal.productCostsPerField(companyId);
    assert.equal(costi.length, 1);
    assert.equal(costi[0].plot_id, plotId);
    assert.equal(Number(costi[0].total_cost), 66); // 120 × 0.55

    // 5) Alert di scadenza (soglia default 30 giorni).
    const expiring = await dal.listLottiInScadenza(companyId, 30);
    assert.equal(expiring.length, 1);
    assert.equal(expiring[0].lot_number, "NA-26-001");
    const outOfThreshold = await dal.listLottiInScadenza(companyId, 5);
    assert.equal(outOfThreshold.length, 0);

    // 6) Il dato pre-esistente a testo libero è intatto.
    const treatments = await dal.listTreatments(companyId);
    const legacyRow = treatments.find((t) => t.id === legacy.id);
    assert.equal(legacyRow?.product_name, "Vecchio product testo libero");
    const legacyDischarges = await dal.listScarichiAttivita(legacy.id);
    assert.equal(legacyDischarges.length, 0);
  });
});
