import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LetturaMeteo, RegistroTrattamento } from "@agrogea/core";
import {
  bilancioIdricoFao66,
  coefficienteStressIdrico,
  et0PenmanMonteith,
  type ParametriSuolo,
} from "@agrogea/tools";
import {
  apportiIrriguiDaTrattamenti,
  apportoIrriguoMm,
  calcolaBilancioIdrico,
} from "../apps/agro-field-suite/src/modules/dss/water-balance";

/**
 * Precisione dell'equazione di deplezione idrica (FAO 56/66) e degli
 * adattatori dell'orchestratore. Verifica la conservazione di massa giorno per
 * giorno, l'esplicitazione della percolazione profonda e l'attivazione dello
 * stress alla soglia RAW.
 */

// Suolo di prova: AWC = (0.30 − 0.10)·1.0·1000 = 200 mm; RAW = 0.5·AWC = 100 mm.
const SUOLO: ParametriSuolo = {
  capacitaCampo: 0.3,
  puntoAppassimento: 0.1,
  profonditaRadici: 1.0,
  frazioneDeplezione: 0.5,
};
const AWC = 200;
const RAW = 100;

describe("bilancioIdricoFao66 — equazione di deplezione", () => {
  it("conserva la massa: Dr,t = Dr,t-1 − P − I + ETc + DP ad ogni giorno", () => {
    const etc = [10, 8, 12, 0, 6];
    const pioggia = [0, 0, 0, 30, 0];
    const irrig = [0, 0, 5, 0, 0];
    const { serie } = bilancioIdricoFao66(SUOLO, etc, pioggia, irrig, 0);

    let drPrev = 0;
    for (const g of serie) {
      const atteso = drPrev - g.pioggia - g.irrigazione + g.etc + g.percolazione;
      // Vale finché non si tocca il limite superiore AWC (qui mai).
      assert.ok(
        Math.abs(g.deplezione - atteso) < 1e-9,
        `giorno ${g.giorno}: Dr=${g.deplezione} ≠ ${atteso}`,
      );
      assert.ok(g.deplezione >= 0 && g.deplezione <= AWC, "Dr in [0, AWC]");
      drPrev = g.deplezione;
    }
  });

  it("la percolazione profonda è > 0 solo quando l'apporto satura il profilo", () => {
    // Dr iniziale 5 mm, pioggia 30 mm, nessuna ETc: 25 mm percolano via.
    const { serie } = bilancioIdricoFao66(SUOLO, [0], [30], [0], 5);
    assert.equal(serie[0].percolazione, 25);
    assert.equal(serie[0].deplezione, 0);

    // Giornata secca (solo ETc): nessuna percolazione.
    const { serie: secca } = bilancioIdricoFao66(SUOLO, [10], [0], [0], 0);
    assert.equal(secca[0].percolazione, 0);
  });

  it("attiva inStress esattamente quando Dr ≥ RAW e riporta i giorni di autonomia", () => {
    const etc = new Array(12).fill(10); // +10 mm/giorno → RAW(100) al giorno 9
    const { serie, giorniAutonomia } = bilancioIdricoFao66(SUOLO, etc, [], [], 0);
    assert.equal(serie[8].deplezione, 90);
    assert.equal(serie[8].inStress, false);
    assert.equal(serie[9].deplezione, 100);
    assert.equal(serie[9].inStress, true);
    assert.equal(giorniAutonomia, 9);
  });

  it("non scende sotto 0 né supera AWC (clamp fisico)", () => {
    const { serie } = bilancioIdricoFao66(SUOLO, [500], [0], [0], 0);
    // domanda non soddisfatta: Dr cappato ad AWC (≈200, modulo float).
    assert.ok(Math.abs(serie[0].deplezione - AWC) < 1e-6);
  });
});

describe("coefficienteStressIdrico (Ks, FAO-56 eq.84)", () => {
  it("è 1 sopra RAW e decresce a 0 al punto di appassimento", () => {
    assert.equal(coefficienteStressIdrico(50, RAW, AWC), 1); // Dr<RAW
    assert.equal(coefficienteStressIdrico(RAW, RAW, AWC), 1); // Dr=RAW
    assert.equal(coefficienteStressIdrico(150, RAW, AWC), 0.5); // a metà
    assert.equal(coefficienteStressIdrico(AWC, RAW, AWC), 0); // Dr=AWC
  });
});

describe("et0PenmanMonteith — sanità fisica", () => {
  it("è positiva e cresce con la temperatura", () => {
    const base = {
      tMin: 12,
      tMax: 24,
      rhMin: 40,
      rhMax: 80,
      vento2m: 2,
      radiazione: 22,
      altitudine: 100,
    };
    const et0 = et0PenmanMonteith(base);
    assert.ok(et0 > 0 && et0 < 15, `ET0 fuori range plausibile: ${et0}`);
    const caldo = et0PenmanMonteith({ ...base, tMin: 20, tMax: 35 });
    assert.ok(caldo > et0, "più caldo ⇒ ET0 maggiore");
  });
});

// -- Adattatori dell'orchestratore -----------------------------------------

function lettura(
  data: string,
  over: Partial<LetturaMeteo> = {},
): LetturaMeteo {
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

describe("apportoIrriguoMm / apportiIrriguiDaTrattamenti", () => {
  it("10 000 L su 1 ha = 1 mm; ignora aree non valide", () => {
    assert.equal(apportoIrriguoMm(10_000, 1), 1);
    assert.equal(apportoIrriguoMm(50_000, 2), 2.5);
    assert.equal(apportoIrriguoMm(10_000, 0), 0);
  });

  it("estrae solo i trattamenti di tipo irrigation con volume", () => {
    const trattamenti = [
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
    ] as unknown as RegistroTrattamento[];
    const apporti = apportiIrriguiDaTrattamenti(trattamenti, 2);
    assert.equal(apporti.length, 1);
    assert.equal(apporti[0].data, "2026-06-01");
    assert.equal(apporti[0].mm, 1); // 20000 / (2 ha · 10000)
  });
});

describe("calcolaBilancioIdrico — composizione end-to-end", () => {
  it("produce una riga per giorno con ETc = ET0·Kc e bilancio coerente", () => {
    const letture = [
      lettura("2026-06-01", { rain_mm: 0 }),
      lettura("2026-06-02", { rain_mm: 5 }),
      lettura("2026-06-03", { rain_mm: 0 }),
    ];
    const out = calcolaBilancioIdrico({
      letture,
      irrigazioni: [{ data: "2026-06-03", mm: 4 }],
      coltura: "vite",
      fase: "piena",
      suolo: SUOLO,
      altitudine: 100,
    });

    assert.equal(out.serie.length, 3);
    assert.equal(out.kc, 0.85); // vite, fase piena
    for (const g of out.serie) {
      assert.ok(g.et0 > 0, "ET0 positiva");
      assert.ok(Math.abs(g.etc - g.et0 * out.kc) < 1e-9, "ETc = ET0·Kc");
      assert.ok(Number.isFinite(g.deplezione), "Dr finito");
    }
    assert.equal(out.serie[2].irrigazione, 4);
  });
});
