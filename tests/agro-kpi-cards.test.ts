import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CustomKpiCard,
  computeKpiCard,
  dimensionValues,
  rangeForPeriod,
} from "../apps/agro-field-suite/src/modules/analytics/kpi-cards";
import { sanitizeKpiCard } from "../apps/agro-field-suite/src/modules/analytics/kpi-cards-config";
import { ENTITIES } from "../apps/agro-field-suite/src/modules/analytics/dashboard-analytics";
import type { DashboardData } from "../apps/agro-field-suite/src/modules/analytics/dashboard-datasets";
import type {
  Plot,
  TreatmentLog,
  WeatherReading,
} from "../packages/agro-core/src/types";

/**
 * Schede KPI personalizzate del Command Center: sono il motore che sostituisce
 * gli ex indici fissi, quindi l'aritmetica (aggregazione, periodo, filtro,
 * soglie) vive in un modulo puro e si testa senza React.
 */

const CAMPAIGN_YEAR = 2026;

function plot(over: Partial<Plot> = {}): Plot {
  return {
    id: "p1",
    tenant_id: "tn",
    company_id: "c1",
    user_plot_name: "Vigna alta",
    area_ha: 2,
    irrigation_type: "goccia",
    planting_year: 2015,
    last_ndvi_mean: 0.7,
    geometry: null,
    deleted_at: null,
    ...over,
  } as unknown as Plot;
}

function treatment(over: Partial<TreatmentLog> = {}): TreatmentLog {
  return {
    id: "o1",
    tenant_id: "tn",
    company_id: "c1",
    plot_id: "p1",
    plot_campaign_id: null,
    operation_type: "phytosanitary",
    product_name: "Rameico",
    target_disease: "Peronospora",
    dose_value: 1.5,
    total_quantity: 3,
    water_volume_l: 400,
    executed_at: "2026-05-10T09:00:00.000Z",
    deleted_at: null,
    ...over,
  } as TreatmentLog;
}

function weather(over: Partial<WeatherReading> = {}): WeatherReading {
  return {
    id: "w1",
    tenant_id: "tn",
    company_id: "c1",
    station_id: "s1",
    measured_at: "2026-05-10T09:00:00.000Z",
    air_temperature: 20,
    relative_humidity: 60,
    rain_mm: 2,
    leaf_wetness: null,
    solar_radiation: null,
    wind_speed: 3,
    wind_direction: null,
    metadata: {},
    created_at: "2026-05-10T09:00:00.000Z",
    updated_at: "2026-05-10T09:00:00.000Z",
    deleted_at: null,
    ...over,
  } as WeatherReading;
}

function bundle(over: Partial<DashboardData> = {}): DashboardData {
  return {
    plots: [],
    crops: [],
    campaigns: [],
    treatments: [],
    harvests: [],
    soilIndices: [],
    weather: [],
    dssResults: [],
    ...over,
  };
}

function card(over: Partial<CustomKpiCard> = {}): CustomKpiCard {
  return {
    id: "k1",
    title: "Indice",
    entity: "treatments",
    aggregation: "count",
    measure: "dose",
    decimals: 0,
    period: { kind: "campaign" },
    trend: false,
    ...over,
  };
}

describe("catalogo dati / chiavi dei campi", () => {
  it("ogni campo dichiarato esiste davvero nelle righe proiettate", () => {
    // Regressione: dimensioni e misure con chiavi non corrispondenti alle
    // righe producevano silenziosamente "—" e valori a zero.
    const data = bundle({
      plots: [plot()],
      treatments: [treatment()],
      weather: [weather()],
    });
    for (const entity of ENTITIES) {
      const rows = entity.rows(data);
      if (rows.length === 0) continue;
      for (const field of entity.fields) {
        assert.ok(
          field.key in rows[0],
          `${entity.id}: il campo "${field.key}" non esiste nelle righe`,
        );
      }
    }
  });
});

describe("schede KPI / periodo", () => {
  it("l'annata copre l'anno solare della campagna", () => {
    assert.deepEqual(rangeForPeriod({ kind: "campaign" }, 2026), {
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("«ultimi N giorni» include oggi e conta all'indietro", () => {
    const today = new Date("2026-05-10T12:00:00.000Z");
    assert.deepEqual(rangeForPeriod({ kind: "lastDays", days: 7 }, 2026, today), {
      from: "2026-05-04",
      to: "2026-05-10",
    });
  });

  it("«tutto lo storico» non filtra nulla", () => {
    assert.deepEqual(rangeForPeriod({ kind: "all" }, 2026), {
      from: null,
      to: null,
    });
  });
});

describe("schede KPI / calcolo del valore", () => {
  it("conta i record dell'entità nel periodo dell'annata", () => {
    const data = bundle({
      plots: [plot()],
      treatments: [
        treatment({ id: "a" }),
        treatment({ id: "b", executed_at: "2026-06-02T09:00:00.000Z" }),
        // Fuori annata: non deve entrare nel conteggio.
        treatment({ id: "c", executed_at: "2025-06-02T09:00:00.000Z" }),
      ],
    });
    const out = computeKpiCard(card(), data, CAMPAIGN_YEAR);
    assert.equal(out.value, 2);
    assert.equal(out.display, "2");
    assert.equal(out.empty, false);
  });

  it("il filtro su una dimensione restringe l'indice (es. solo le irrigazioni)", () => {
    const data = bundle({
      plots: [plot()],
      treatments: [
        treatment({ id: "a", operation_type: "phytosanitary" }),
        treatment({ id: "b", operation_type: "irrigation" }),
        treatment({ id: "c", operation_type: "irrigation" }),
      ],
    });
    const out = computeKpiCard(
      card({ filter: { dimension: "operationType", value: "Irrigazioni" } }),
      data,
      CAMPAIGN_YEAR,
    );
    assert.equal(out.value, 2);
  });

  it("somma e media leggono la misura scelta, i valori nulli non contano", () => {
    const data = bundle({
      plots: [plot()],
      treatments: [
        treatment({ id: "a", total_quantity: 10 }),
        treatment({ id: "b", total_quantity: 20 }),
        treatment({ id: "c", total_quantity: null }),
      ],
    });
    const somma = computeKpiCard(
      card({ aggregation: "sum", measure: "quantity", decimals: 1 }),
      data,
      CAMPAIGN_YEAR,
    );
    assert.equal(somma.value, 30);
    assert.equal(somma.display, "30,0");
    const media = computeKpiCard(
      card({ aggregation: "avg", measure: "quantity" }),
      data,
      CAMPAIGN_YEAR,
    );
    assert.equal(media.value, 15);
    // I record restano 3: due concorrono alla media, il terzo è senza valore.
    assert.equal(media.sampleCount, 3);
  });

  it("il rapporto A/B somma numeratore e denominatore (es. kg per ettaro)", () => {
    const data = bundle({
      plots: [plot({ area_ha: 4 })],
      treatments: [
        treatment({ id: "a", total_quantity: 8 }),
        treatment({ id: "b", total_quantity: 4 }),
      ],
    });
    const out = computeKpiCard(
      card({
        aggregation: "ratio",
        measure: "quantity",
        measure2: "areaHa",
        decimals: 2,
      }),
      data,
      CAMPAIGN_YEAR,
    );
    // (8 + 4) / (4 + 4) = 1,5
    assert.equal(out.value, 1.5);
    assert.equal(out.display, "1,50");
  });

  it("senza record nel periodo la scheda è vuota, non zero", () => {
    const data = bundle({
      plots: [plot()],
      treatments: [treatment({ executed_at: "2024-05-10T09:00:00.000Z" })],
    });
    const out = computeKpiCard(card(), data, CAMPAIGN_YEAR);
    assert.equal(out.empty, true);
    assert.equal(out.display, "—");
  });

  it("con il trend attivo la sparkline segue la dimensione temporale", () => {
    const data = bundle({
      weather: [
        weather({ id: "w1", measured_at: "2026-05-01T09:00:00.000Z", rain_mm: 1 }),
        weather({ id: "w2", measured_at: "2026-05-01T15:00:00.000Z", rain_mm: 2 }),
        weather({ id: "w3", measured_at: "2026-05-02T09:00:00.000Z", rain_mm: 4 }),
        weather({ id: "w4", measured_at: "2026-05-03T09:00:00.000Z", rain_mm: 9 }),
      ],
    });
    const out = computeKpiCard(
      card({ entity: "weather", aggregation: "sum", measure: "rain", trend: true }),
      data,
      CAMPAIGN_YEAR,
    );
    assert.equal(out.value, 16);
    // Un punto per giorno: il 1° maggio somma le due letture orarie.
    assert.deepEqual(out.spark, [3, 4, 9]);
    // Ultimo punto (9) contro la media dei precedenti (3,5): +157%.
    assert.ok(out.trendPct != null && out.trendPct > 150);
  });
});

describe("schede KPI / soglie di colore", () => {
  /**
   * L'allarme è sempre la soglia più "estrema" nella direzione scelta: oltre
   * `warn` salendo, sotto `warn` scendendo.
   */
  const withThreshold = (
    direction: "above" | "below",
    quantity: number,
  ): ReturnType<typeof computeKpiCard> =>
    computeKpiCard(
      card({
        aggregation: "sum",
        measure: "quantity",
        thresholds:
          direction === "above"
            ? { warn: 10, danger: 20, direction }
            : { warn: 20, danger: 10, direction },
      }),
      bundle({
        plots: [plot()],
        treatments: [treatment({ total_quantity: quantity })],
      }),
      CAMPAIGN_YEAR,
    );

  it("direzione «supera»: verde sotto la soglia, ambra oltre, rosso all'allarme", () => {
    assert.equal(withThreshold("above", 5).severity, "good");
    assert.equal(withThreshold("above", 12).severity, "warn");
    assert.equal(withThreshold("above", 25).severity, "danger");
  });

  it("direzione «scende sotto»: si allarma quando il valore cala", () => {
    assert.equal(withThreshold("below", 30).severity, "good");
    assert.equal(withThreshold("below", 15).severity, "warn");
    assert.equal(withThreshold("below", 5).severity, "danger");
  });

  it("senza soglie la scheda resta neutra", () => {
    const data = bundle({ plots: [plot()], treatments: [treatment()] });
    assert.equal(computeKpiCard(card(), data, CAMPAIGN_YEAR).severity, "neutral");
  });
});

describe("schede KPI / valori di filtro e config salvata", () => {
  it("i valori del filtro arrivano dai dati reali dell'entità", () => {
    const data = bundle({
      plots: [plot()],
      treatments: [
        treatment({ id: "a", operation_type: "irrigation" }),
        treatment({ id: "b", operation_type: "phytosanitary" }),
        treatment({ id: "c", operation_type: "irrigation" }),
      ],
    });
    assert.deepEqual(dimensionValues("treatments", "operationType", data), [
      "Irrigazioni",
      "Trattamenti",
    ]);
  });

  it("una config salvata con le vecchie chiavi italiane viene tradotta", () => {
    const saved = sanitizeKpiCard({
      id: "k1",
      title: "Quantità distribuita",
      entity: "treatments",
      aggregation: "sum",
      measure: "quantita",
      filter: { dimension: "tipo", value: "Trattamenti" },
      decimals: 1,
      period: { kind: "campaign" },
      trend: true,
    });
    assert.equal(saved?.measure, "quantity");
    assert.deepEqual(saved?.filter, {
      dimension: "operationType",
      value: "Trattamenti",
    });
  });

  it("scarta le schede su entità inesistenti e normalizza i periodi assurdi", () => {
    assert.equal(
      sanitizeKpiCard({ id: "x", title: "T", entity: "boh", aggregation: "count" }),
      null,
    );
    const fixed = sanitizeKpiCard({
      id: "k2",
      title: "T",
      entity: "weather",
      aggregation: "avg",
      measure: "temperature",
      decimals: 9,
      period: { kind: "lastDays", days: -4 },
    });
    assert.deepEqual(fixed?.period, { kind: "lastDays", days: 1 });
    assert.equal(fixed?.decimals, 3);
  });
});
