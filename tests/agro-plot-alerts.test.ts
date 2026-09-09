import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlotAlerts,
  lacksSoilTexture,
  type PlannedTask,
  type Plot,
  type PlotCampaign,
  type TreatmentLog,
} from "@agrogea/core";

/**
 * Segnali di attenzione in mappa (`field/plot-alerts.ts`): il punto esclamativo
 * per il LAVORO previsto e il triangolo per i DATI mancanti. Il motore è puro e
 * riusa i motori di completezza e di compliance dichiarativa già esistenti:
 * questi test fissano ciò che nella mappa deve comparire — e soprattutto ciò
 * che NON deve, perché un simbolo su ogni campo non segnalerebbe più nulla.
 */

const TENANT = "t";
const COMPANY = "c";

function makePlot(overrides: Partial<Plot> = {}): Plot {
  return {
    id: "plot-1",
    tenant_id: TENANT,
    company_id: COMPANY,
    user_plot_name: "Campo 1",
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 2,
    last_ndvi_mean: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [11, 43],
          [11.001, 43],
          [11.001, 43.001],
          [11, 43.001],
          [11, 43],
        ],
      ],
    },
    irrigation_type: null,
    planting_year: null,
    source_id: null,
    nuts_code: null,
    reference_unit_type: null,
    validity_year: null,
    // Tessitura presente = nessun gap pedologico, salvo quando il test lo vuole.
    metadata: { suolo: { tessitura: "franco" } },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: "task-1",
    tenant_id: TENANT,
    company_id: COMPANY,
    plot_id: "plot-1",
    operation_type: "tillage",
    recipe_id: null,
    target_pest_or_disease: null,
    status: "PLANNED",
    planned_date: "2026-09-10",
    operator_name: "Mario Rossi",
    notes: null,
    metadata: {},
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<PlotCampaign> = {}): PlotCampaign {
  return {
    id: "camp-1",
    tenant_id: TENANT,
    plot_id: "plot-1",
    crop_id: "crop-1",
    campaign_year: 2026,
    reference_parcel_external_id: "ISOLA-1",
    agricultural_parcel_external_id: "PART-1",
    crop_external_code: "CODE-1",
    variety_external_code: null,
    declared_area_ha: 2,
    production_regime: null,
    regime_since: null,
    regime_notes: null,
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

const EMPTY = {
  plots: [] as Plot[],
  plannedTasks: [] as PlannedTask[],
  campaignFields: [] as PlotCampaign[],
  recipes: [],
  treatments: [] as TreatmentLog[],
};

describe("lacksSoilTexture", () => {
  it("basta la classe tessiturale, oppure le tre percentuali", () => {
    assert.equal(lacksSoilTexture({ metadata: {} }), true);
    assert.equal(lacksSoilTexture({ metadata: { suolo: {} } }), true);
    assert.equal(
      lacksSoilTexture({ metadata: { suolo: { tessitura: "argilloso" } } }),
      false,
    );
    assert.equal(
      lacksSoilTexture({
        metadata: { suolo: { sabbia: 40, limo: 40, argilla: 20 } },
      }),
      false,
    );
    // Percentuali incomplete: il modello non ci può girare, il gap resta.
    assert.equal(
      lacksSoilTexture({ metadata: { suolo: { sabbia: 40, limo: 40 } } }),
      true,
    );
    // Una classe vuota non è una classe.
    assert.equal(
      lacksSoilTexture({ metadata: { suolo: { tessitura: "  " } } }),
      true,
    );
  });
});

describe("buildPlotAlerts", () => {
  it("un campo senza nulla da segnalare non compare", () => {
    const alerts = buildPlotAlerts({ ...EMPTY, plots: [makePlot()] });
    assert.deepEqual(alerts, []);
  });

  it("conta le sole task ancora in volo verso il Quaderno", () => {
    const alerts = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot()],
      plannedTasks: [
        makeTask({ id: "a", status: "PLANNED" }),
        makeTask({ id: "b", status: "IN_PROGRESS" }),
        makeTask({ id: "c", status: "COMPLETED" }),
        makeTask({ id: "d", status: "CANCELLED" }),
        makeTask({ id: "e", deleted_at: "2026-09-02T00:00:00.000Z" }),
      ],
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].taskCount, 2);
    assert.deepEqual(alerts[0].gaps, []);
  });

  it("segnala la tessitura mancante come gap pedologico", () => {
    const alerts = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot({ metadata: {} })],
    });
    assert.deepEqual(alerts, [
      { plotId: "plot-1", taskCount: 0, gaps: ["soil_texture"] },
    ]);
  });

  it("segnala i dichiarativi incompleti solo dove esiste un sistema gateato", () => {
    const campagnaIncompleta = makeCampaign({ crop_external_code: null });

    const italia = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot()],
      campaignFields: [campagnaIncompleta],
      countryCode: "IT",
    });
    assert.deepEqual(italia[0].gaps, ["declarative_fields"]);

    // Paese senza sistema dichiarativo: nessun vincolo, nessun triangolo.
    const francia = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot()],
      campaignFields: [campagnaIncompleta],
      countryCode: "FR",
    });
    assert.deepEqual(francia, []);
  });

  it("ignora le campagne chiuse o cancellate", () => {
    const alerts = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot()],
      campaignFields: [
        makeCampaign({
          id: "chiusa",
          crop_external_code: null,
          closed_at: "2026-08-01T00:00:00.000Z",
        }),
        makeCampaign({
          id: "cancellata",
          crop_external_code: null,
          deleted_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
      countryCode: "IT",
    });
    assert.deepEqual(alerts, []);
  });

  it("segnala le task incomplete e ordina i gap per priorità", () => {
    // Fitosanitario senza avversità né patentino: incompleto per il motore PAN.
    const alerts = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot({ metadata: {} })],
      plannedTasks: [
        makeTask({ operation_type: "phytosanitary", target_pest_or_disease: null }),
      ],
      campaignFields: [makeCampaign({ crop_external_code: null })],
      countryCode: "IT",
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].taskCount, 1);
    // Prima ciò che blocca un export ministeriale, poi i record, poi il suolo.
    assert.deepEqual(alerts[0].gaps, [
      "declarative_fields",
      "incomplete_records",
      "soil_texture",
    ]);
  });

  it("non segnala nulla per un appezzamento cancellato", () => {
    const alerts = buildPlotAlerts({
      ...EMPTY,
      plots: [makePlot({ metadata: {}, deleted_at: "2026-09-01T00:00:00.000Z" })],
      plannedTasks: [makeTask()],
    });
    assert.deepEqual(alerts, []);
  });
});
