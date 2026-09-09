import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANY_TRANSFER_FORMAT,
  COMPANY_TRANSFER_VERSION,
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SECTIONS,
  documentSchemaVersion,
  emptyCompanySnapshot,
  fullTransferScope,
  migrateTransferDocument,
  parseCompanyTransfer,
  serializeCompanySnapshot,
  withinPeriod,
  type Company,
  type CompanySnapshot,
  type CompanyTransferDocument,
  type FieldOperationSession,
  type Product,
  type ProductLot,
  type Warehouse,
} from "@agrogea/core";

/**
 * Formato di scambio v3: il backup copre tutta l'azienda (magazzino, parco
 * macchine, pianificazione) e dichiara il proprio perimetro. Ciò che ha una
 * geometria diventa una Feature; il resto sta nei membri foreign della radice,
 * dove un lettore GIS lo salta senza inciamparci.
 */

const EXPORTED_AT = "2026-09-01T08:00:00.000Z";

function company(): Company {
  return {
    id: "company-1",
    tenant_id: "tenant-1",
    business_name: "Azienda di prova",
    national_company_id: null,
    vat_number: null,
    legal_form: null,
    address: null,
    city: null,
    province: null,
    region: null,
    postal_code: null,
    country: "IT",
    email: null,
    pec: null,
    sdi_code: null,
    centroid: null,
    certifications: [],
    farm_file_id: null,
    paying_agency: null,
    contact_name: null,
    contact_role: null,
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
  };
}

function warehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: "warehouse-1",
    tenant_id: "tenant-1",
    company_id: "company-1",
    name: "Deposito agrofarmaci",
    warehouse_type: "phytosanitary",
    geometry: { type: "Point", coordinates: [11.25, 43.77] },
    address: null,
    notes: null,
    metadata: {},
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
    ...overrides,
  };
}

function product(): Product {
  return {
    id: "product-1",
    tenant_id: "tenant-1",
    company_id: "company-1",
    category: "phytosanitary",
    name: "Rameico 50",
    unit: "kg",
    registration_number: "12345",
    active_substance: "rame",
    npk_n: null,
    npk_p: null,
    npk_k: null,
    uma_code: null,
    supplier: null,
    avg_unit_cost: 12.5,
    notes: null,
    metadata: {},
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
  };
}

function lot(): ProductLot {
  return {
    id: "lot-1",
    tenant_id: "tenant-1",
    product_id: "product-1",
    warehouse_id: "warehouse-1",
    lot_number: "L-2026-07",
    expires_at: "2028-03-31",
    initial_quantity: 100,
    quantity_on_hand: 62.5,
    unit_cost: 12.5,
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
  };
}

function session(
  overrides: Partial<FieldOperationSession> = {},
): FieldOperationSession {
  return {
    id: "session-1",
    tenant_id: "tenant-1",
    company_id: "company-1",
    planned_task_id: null,
    plot_id: "plot-1",
    operation_type: "tillage",
    recipe_id: null,
    machine_id: null,
    equipment_id: null,
    working_width_m: 3,
    start_time: "2026-04-12T06:30:00.000Z",
    end_time: "2026-04-12T09:10:00.000Z",
    path: {
      type: "LineString",
      coordinates: [
        [11.2, 43.7],
        [11.21, 43.71],
        [11.22, 43.72],
      ],
    },
    path_length_m: 2400,
    area_worked_ha: 1.8,
    status: "COMPLETED",
    audio_notes: [],
    treatment_log_ids: [],
    operator_name: "Mario",
    notes: null,
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
    ...overrides,
  };
}

function snapshot(): CompanySnapshot {
  const base = emptyCompanySnapshot(company());
  base.warehouse = {
    warehouses: [warehouse()],
    products: [product()],
    lots: [lot()],
    movements: [
      {
        id: "movement-1",
        tenant_id: "tenant-1",
        treatment_log_id: "treatment-1",
        product_lot_id: "lot-1",
        quantity: 37.5,
        unit_cost: 12.5,
        total_cost: 468.75,
        created_at: EXPORTED_AT,
        updated_at: EXPORTED_AT,
        deleted_at: null,
      },
    ],
  };
  base.planning = { ...base.planning, sessions: [session()] };
  return base;
}

function documentOf(input: CompanySnapshot = snapshot()): CompanyTransferDocument {
  return serializeCompanySnapshot(input, { exportedAt: EXPORTED_AT });
}

describe("scambio v3 / dati non agronomici", () => {
  it("il magazzino georeferenziato diventa una Feature puntuale", () => {
    const doc = documentOf();
    const feature = doc.features.find((f) => f.properties.kind === "warehouse");
    assert.ok(feature);
    assert.deepEqual(feature.geometry, {
      type: "Point",
      coordinates: [11.25, 43.77],
    });
    // La geometria non resta duplicata dentro le properties.
    assert.ok(!("geometry" in (feature.properties as { warehouse: object }).warehouse));
  });

  it("un magazzino logico resta nel file con geometry null", () => {
    // RFC 7946 ammette `geometry: null`: un deposito senza posizione sulla
    // mappa è un dato da salvare, non un errore da scartare.
    const snap = snapshot();
    snap.warehouse.warehouses = [warehouse({ id: "warehouse-2", geometry: null })];
    const doc = documentOf(snap);
    const feature = doc.features.find((f) => f.properties.kind === "warehouse");
    assert.equal(feature?.geometry, null);
    assert.equal(parseCompanyTransfer(doc).warehouse.warehouses[0].geometry, null);
  });

  it("prodotti, lotti e movimenti stanno alla radice, non fra le Feature", () => {
    const doc = documentOf();
    assert.equal(doc.agrogea.warehouse.products.length, 1);
    assert.equal(doc.agrogea.warehouse.lots[0].quantity_on_hand, 62.5);
    assert.equal(doc.agrogea.warehouse.movements[0].total_cost, 468.75);
    // I depositi viaggiano come Feature: nel membro root non si duplicano.
    assert.deepEqual(doc.agrogea.warehouse.warehouses, []);
  });

  it("la sessione di campo porta il tracciato GPS come LineString", () => {
    const doc = documentOf();
    const feature = doc.features.find((f) => f.properties.kind === "session");
    assert.equal(feature?.geometry?.type, "LineString");
    assert.equal(doc.agrogea.planning.sessions.length, 0);
  });

  it("una sessione senza tracciato utile non genera una LineString invalida", () => {
    // Meno di due posizioni non è una LineString valida (RFC 7946 §3.1.4).
    const snap = snapshot();
    snap.planning.sessions = [
      session({ path: { type: "LineString", coordinates: [] } }),
    ];
    const doc = documentOf(snap);
    const feature = doc.features.find((f) => f.properties.kind === "session");
    assert.equal(feature?.geometry, null);
    const restored = parseCompanyTransfer(doc).planning.sessions[0];
    assert.deepEqual(restored.path, { type: "LineString", coordinates: [] });
  });

  it("il documento dichiara il bbox delle geometrie che contiene", () => {
    const doc = documentOf();
    assert.deepEqual(doc.bbox, [11.2, 43.7, 11.25, 43.77]);
  });

  it("senza geometrie non inventa un bbox", () => {
    const doc = documentOf(emptyCompanySnapshot(company()));
    assert.equal(doc.bbox, undefined);
  });

  it("export → import → export produce un documento identico", () => {
    const first = documentOf();
    const reparsed = parseCompanyTransfer(JSON.parse(JSON.stringify(first)));
    const second = serializeCompanySnapshot(reparsed, { exportedAt: EXPORTED_AT });
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });
});

describe("scambio v3 / perimetro dichiarato", () => {
  it("il backup di default dichiara tutte le sezioni e nessun periodo", () => {
    const doc = documentOf();
    assert.deepEqual(doc.agrogea.scope, {
      sections: [...TRANSFER_SECTIONS],
      period: null,
    });
  });

  it("un backup parziale dice di esserlo", () => {
    const snap = snapshot();
    snap.scope = {
      sections: ["plots", "warehouse"],
      period: { from: "2026-01-01", to: "2026-12-31" },
    };
    const doc = documentOf(snap);
    assert.deepEqual(doc.agrogea.scope.sections, ["plots", "warehouse"]);
    assert.equal(doc.agrogea.scope.period?.from, "2026-01-01");
    // E il perimetro sopravvive alla rilettura: è ciò che distingue "magazzino
    // vuoto" da "magazzino non incluso nel backup".
    assert.deepEqual(parseCompanyTransfer(doc).scope, doc.agrogea.scope);
  });

  it("un file senza perimetro leggibile vale come backup completo", () => {
    const doc = documentOf();
    const senzaScope = JSON.parse(JSON.stringify(doc));
    delete senzaScope.agrogea.scope;
    assert.deepEqual(parseCompanyTransfer(senzaScope).scope, fullTransferScope());
  });
});

describe("scambio v3 / migrazione dai file v2", () => {
  function v2Document(): Record<string, unknown> {
    return {
      type: "FeatureCollection",
      schemaVersion: "2.0.0",
      agrogea: {
        format: COMPANY_TRANSFER_FORMAT,
        version: 2,
        exportedAt: EXPORTED_AT,
        company: company(),
        crops: [],
        unassigned: { treatments: [], soilSamples: [], harvests: [] },
      },
      features: [],
    };
  }

  it("porta il documento alla versione corrente", () => {
    const migrated = migrateTransferDocument(v2Document()) as CompanyTransferDocument;
    assert.equal(documentSchemaVersion(migrated), TRANSFER_SCHEMA_VERSION);
    assert.equal(migrated.agrogea.version, COMPANY_TRANSFER_VERSION);
  });

  it("non dichiara sezioni che quel file non poteva contenere", () => {
    // Un v2 non conosceva magazzino, parco macchine e pianificazione:
    // dichiararle vuote farebbe credere a un ripristino che l'azienda le
    // avesse svuotate.
    const parsed = parseCompanyTransfer(v2Document());
    assert.deepEqual(parsed.scope.sections, [
      "plots",
      "treatments",
      "harvests",
      "soilSamples",
      "scouting",
      "assets",
    ]);
    assert.deepEqual(parsed.warehouse.products, []);
    assert.deepEqual(parsed.machinery.machines, []);
    assert.deepEqual(parsed.planning.recipes, []);
  });
});

describe("scambio v3 / filtro temporale", () => {
  const period = { from: "2026-01-01", to: "2026-12-31" };

  it("gli estremi sono inclusi, per l'intera giornata", () => {
    assert.equal(withinPeriod("2026-01-01T00:00:00.000Z", period), true);
    assert.equal(withinPeriod("2026-12-31T23:59:59.000Z", period), true);
    assert.equal(withinPeriod("2025-12-31T23:00:00.000Z", period), false);
    assert.equal(withinPeriod("2027-01-01T00:00:00.000Z", period), false);
  });

  it("un estremo aperto non taglia da quel lato", () => {
    assert.equal(withinPeriod("2001-05-05", { from: null, to: "2026-12-31" }), true);
    assert.equal(withinPeriod("2099-05-05", { from: "2026-01-01", to: null }), true);
  });

  it("senza periodo, e senza data, il record passa", () => {
    // Un backup non è il posto dove buttare via ciò che non si sa collocare
    // nel tempo (una task senza data, un documento senza emissione).
    assert.equal(withinPeriod("1999-01-01", null), true);
    assert.equal(withinPeriod(null, period), true);
  });
});
