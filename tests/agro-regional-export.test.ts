import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Plot,
  PlotCampaign,
  TreatmentLog,
} from "@agrogea/core";
import {
  baseExporter,
  buildBaseCsv,
  buildSiexJson,
  esExporter,
  flattenOperations,
  getRegionalExporter,
  makeItExporter,
  type RegionalExportInput,
} from "../apps/agro-field-suite/src/lib/regionalExport";

function plot(id: string, name: string): Plot {
  return {
    id,
    tenant_id: "t",
    company_id: "az",
    user_plot_name: name,
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 2,
    last_ndvi_mean: null,
    geometry: { type: "Polygon", coordinates: [] },
    irrigation_type: null,
    planting_year: null,
    historical_notes: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  };
}

function campaign(plotId: string): PlotCampaign {
  return {
    id: `cc-${plotId}`,
    tenant_id: "t",
    plot_id: plotId,
    crop_id: `crop-${plotId}`,
    campaign_year: 2026,
    reference_parcel_external_id: "IS-12",
    agricultural_parcel_external_id: "AP-3",
    crop_external_code: "060",
    variety_external_code: null,
    declared_area_ha: 2.5,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  };
}

function tratt(plotId: string): TreatmentLog {
  return {
    id: "t1",
    tenant_id: "t",
    company_id: "az",
    plot_id: plotId,
    plot_campaign_id: `cc-${plotId}`,
    operation_type: "phytosanitary",
    product_name: "Poltiglia Bordolese",
    registration_number: "12345",
    dose_value: 3,
    dose_unit: "kg/ha",
    total_quantity: 7.5,
    target_disease: "Peronospora",
    operator_name: "Mario Rossi",
    machinery_equipment: null,
    active_substance: "Rame",
    water_volume_l: 300,
    operator_tax_code: "RSSMRA",
    license_number: "PAT-9",
    fertilizer_type: null,
    npk_ratio: null,
    executed_at: "2026-05-20T08:30:00.000Z",
    reentry_interval_h: 48,
    safety_period_days: 20,
    weather_conditions: null,
    note: null,
    created_at: "2026-05-20T08:30:00.000Z",
    updated_at: "2026-05-20T08:30:00.000Z",
    deleted_at: null,
  };
}

const input: RegionalExportInput = {
  treatments: [tratt("p1")],
  plots: [plot("p1", "Vigna Alta")],
  campaignFields: [campaign("p1")],
  aziendaName: "Tenuta Demo",
};

describe("RegionalExporter / factory per country_code", () => {
  it("istanzia l'adapter giusto; FR ricade sul base internazionale", () => {
    assert.equal(getRegionalExporter("IT").countryCode, "IT");
    assert.equal(getRegionalExporter("IT").format, "csv");
    assert.equal(getRegionalExporter("ES"), esExporter);
    assert.equal(getRegionalExporter("EU"), baseExporter);
    assert.equal(getRegionalExporter("FR"), baseExporter);
  });
});

describe("flattenOperations", () => {
  it("congela lo stato di campagna nel record neutro", () => {
    const [op] = flattenOperations(input);
    assert.equal(op.operation_date, "2026-05-20");
    assert.equal(op.plot_name, "Vigna Alta");
    assert.equal(op.reference_parcel_external_id, "IS-12");
    assert.equal(op.agricultural_parcel_external_id, "AP-3");
    assert.equal(op.crop_external_code, "060");
    assert.equal(op.declared_area_ha, 2.5);
    assert.equal(op.active_substance, "Rame");
    assert.equal(op.operator_license_number, "PAT-9");
  });
});

describe("Adapter EU (base internazionale)", () => {
  it("CSV con separator virgola, header ISO e date YYYY-MM-DD", () => {
    const csv = buildBaseCsv(input);
    const [header, row] = csv.split("\n");
    assert.ok(header.startsWith("operation_date,plot_name,"));
    assert.ok(!header.includes(";"));
    assert.ok(row.startsWith("2026-05-20,Vigna Alta,"));
    assert.ok(baseExporter.bom === false);
  });
});

describe("Adapter ES (SIEX/Cuaderno Digital)", () => {
  it("produce JSON valido con le operaciones e i campi in spagnolo", () => {
    const json = JSON.parse(buildSiexJson(input));
    const cde = json.cuaderno_digital_explotacion;
    assert.equal(cde.explotacion, "Tenuta Demo");
    assert.equal(cde.operaciones.length, 1);
    const op = cde.operaciones[0];
    assert.equal(op.fecha, "2026-05-20");
    assert.equal(op.recinto, "AP-3");
    assert.equal(op.materia_activa, "Rame");
    assert.equal(op.num_carne_aplicador, "PAT-9");
    assert.equal(op.plazo_seguridad_dias, 20);
  });
});

describe("Adapter IT (SIAN/PAN)", () => {
  it("delega a sianExport: CSV con separator punto e virgola e BOM", () => {
    const it = makeItExporter();
    assert.equal(it.bom, true);
    const csv = it.build(input);
    assert.ok(csv.includes(";"), "atteso separator ;");
    assert.ok(csv.includes("IS-12"), "atteso codice Isola SIAN");
    assert.equal(it.fileName("Tenuta Demo"), `quaderno-sian-tenuta-demo-${new Date().toISOString().slice(0, 10)}.csv`);
  });
});
