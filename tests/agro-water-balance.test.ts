import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WeatherReading, TreatmentLog } from "@agrogea/core";
import {
  waterBalanceFao66,
  waterStressCoefficient,
  et0PenmanMonteith,
  type SoilParameters,
} from "@agrogea/tools";
import {
  irrigationInputsFromTreatments,
  irrigationInputMm,
  computeWaterBalance,
} from "../apps/agro-field-suite/src/modules/dss/water-balance";

/**
 * Precisione dell'equazione di depletion idrica (FAO 56/66) e degli
 * adattatori dell'orchestratore. Verifica la conservazione di massa day per
 * day, l'esplicitazione della percolation profonda e l'attivazione dello
 * stress alla soglia RAW.
 */

// Suolo di prova: AWC = (0.30 − 0.10)·1.0·1000 = 200 mm; RAW = 0.5·AWC = 100 mm.
const SUOLO: SoilParameters = {
  fieldCapacity: 0.3,
  wiltingPoint: 0.1,
  rootDepth: 1.0,
  depletionFraction: 0.5,
};
const AWC = 200;
const RAW = 100;

describe("waterBalanceFao66 — equazione di depletion", () => {
  it("conserva la massa: Dr,t = Dr,t-1 − P − I + ETc + DP ad ogni day", () => {
    const etc = [10, 8, 12, 0, 6];
    const rain = [0, 0, 0, 30, 0];
    const irrig = [0, 0, 5, 0, 0];
    const { series } = waterBalanceFao66(SUOLO, etc, rain, irrig, 0);

    let drPrev = 0;
    for (const g of series) {
      const atteso = drPrev - g.rain - g.irrigation + g.etc + g.percolation;
      // Vale finché non si tocca il limite superiore AWC (qui mai).
      assert.ok(
        Math.abs(g.depletion - atteso) < 1e-9,
        `day ${g.day}: Dr=${g.depletion} ≠ ${atteso}`,
      );
      assert.ok(g.depletion >= 0 && g.depletion <= AWC, "Dr in [0, AWC]");
      drPrev = g.depletion;
    }
  });

  it("la percolation profonda è > 0 solo quando l'apporto satura il profile", () => {
    // Dr iniziale 5 mm, rain 30 mm, nessuna ETc: 25 mm percolano via.
    const { series } = waterBalanceFao66(SUOLO, [0], [30], [0], 5);
    assert.equal(series[0].percolation, 25);
    assert.equal(series[0].depletion, 0);

    // Giornata secca (solo ETc): nessuna percolation.
    const { series: secca } = waterBalanceFao66(SUOLO, [10], [0], [0], 0);
    assert.equal(secca[0].percolation, 0);
  });

  it("attiva inStress esattamente quando Dr ≥ RAW e riporta i giorni di autonomia", () => {
    const etc = new Array(12).fill(10); // +10 mm/day → RAW(100) al day 9
    const { series, autonomyDays } = waterBalanceFao66(SUOLO, etc, [], [], 0);
    assert.equal(series[8].depletion, 90);
    assert.equal(series[8].inStress, false);
    assert.equal(series[9].depletion, 100);
    assert.equal(series[9].inStress, true);
    assert.equal(autonomyDays, 9);
  });

  it("non scende sotto 0 né supera AWC (clamp fisico)", () => {
    const { series } = waterBalanceFao66(SUOLO, [500], [0], [0], 0);
    // domanda non soddisfatta: Dr cappato ad AWC (≈200, module float).
    assert.ok(Math.abs(series[0].depletion - AWC) < 1e-6);
  });
});

describe("waterStressCoefficient (Ks, FAO-56 eq.84)", () => {
  it("è 1 sopra RAW e decresce a 0 al punto di appassimento", () => {
    assert.equal(waterStressCoefficient(50, RAW, AWC), 1); // Dr<RAW
    assert.equal(waterStressCoefficient(RAW, RAW, AWC), 1); // Dr=RAW
    assert.equal(waterStressCoefficient(150, RAW, AWC), 0.5); // a metà
    assert.equal(waterStressCoefficient(AWC, RAW, AWC), 0); // Dr=AWC
  });
});

describe("et0PenmanMonteith — sanità fisica", () => {
  it("è positiva e cresce con la temperatura", () => {
    const base = {
      tMin: 12,
      tMax: 24,
      rhMin: 40,
      rhMax: 80,
      windSpeed2m: 2,
      radiation: 22,
      altitude: 100,
    };
    const et0 = et0PenmanMonteith(base);
    assert.ok(et0 > 0 && et0 < 15, `ET0 fuori range plausibile: ${et0}`);
    const caldo = et0PenmanMonteith({ ...base, tMin: 20, tMax: 35 });
    assert.ok(caldo > et0, "più caldo ⇒ ET0 maggiore");
  });
});

// -- Adattatori dell'orchestratore -----------------------------------------

function reading(
  data: string,
  over: Partial<WeatherReading> = {},
): WeatherReading {
  return {
    id: data,
    tenant_id: "t",
    company_id: "c",
    station_id: "s1",
    measured_at: `${data}T12:00:00Z`,
    air_temperature: 20,
    relative_humidity: 60,
    rain_mm: 0,
    leaf_wetness: 0,
    solar_radiation: 22,
    wind_speed: 2,
    wind_direction: null,
    metadata: {},
    created_at: data,
    updated_at: data,
    deleted_at: null,
    ...over,
  };
}

describe("irrigationInputMm / irrigationInputsFromTreatments", () => {
  it("10 000 L su 1 ha = 1 mm; ignora aree non valide", () => {
    assert.equal(irrigationInputMm(10_000, 1), 1);
    assert.equal(irrigationInputMm(50_000, 2), 2.5);
    assert.equal(irrigationInputMm(10_000, 0), 0);
  });

  it("estrae solo i treatments di tipo irrigation con volume", () => {
    const treatments = [
      {
        operation_type: "irrigation",
        water_volume_l: 20_000,
        executed_at: "2026-06-01T08:00:00Z",
      },
      {
        operation_type: "phytosanitary",
        water_volume_l: 400,
        executed_at: "2026-06-02T08:00:00Z",
      },
      {
        operation_type: "irrigation",
        water_volume_l: null,
        executed_at: "2026-06-03T08:00:00Z",
      },
    ] as unknown as TreatmentLog[];
    const apporti = irrigationInputsFromTreatments(treatments, 2);
    assert.equal(apporti.length, 1);
    assert.equal(apporti[0].data, "2026-06-01");
    assert.equal(apporti[0].mm, 1); // 20000 / (2 ha · 10000)
  });
});

describe("computeWaterBalance — composizione end-to-end", () => {
  it("produce una riga per day con ETc = ET0·Kc e bilancio coerente", () => {
    const readings = [
      reading("2026-06-01", { rain_mm: 0 }),
      reading("2026-06-02", { rain_mm: 5 }),
      reading("2026-06-03", { rain_mm: 0 }),
    ];
    const out = computeWaterBalance({
      readings,
      irrigazioni: [{ data: "2026-06-03", mm: 4 }],
      crop: "vite",
      phase: "piena",
      soil: SUOLO,
      altitude: 100,
    });

    assert.equal(out.series.length, 3);
    assert.equal(out.kc, 0.85); // vite, phase piena
    for (const g of out.series) {
      assert.ok(g.et0 > 0, "ET0 positiva");
      assert.ok(Math.abs(g.etc - g.et0 * out.kc) < 1e-9, "ETc = ET0·Kc");
      assert.ok(Number.isFinite(g.depletion), "Dr finito");
    }
    assert.equal(out.series[2].irrigation, 4);
  });
});
