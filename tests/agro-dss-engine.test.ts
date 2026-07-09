import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alertA01,
  normalizeRiskIndex,
  yieldReductionFao66,
  riskLevelA01,
  peacockEyeRisk,
} from "@agrogea/tools";
import { cropModuleById, type DssWeatherDay } from "../apps/agro-field-suite/src/modules/crops";
import {
  runDssEngine,
  underWaterStress,
  cropKy,
  waterRisk01,
  waterStressVector,
} from "../apps/agro-field-suite/src/modules/dss/dss-engine";

/**
 * Espansione DSS (Modulo 2): occhio di pavone, normalizzazione del risk
 * 0..1, riduzione di resa per stress idrico (FAO 66) e composizione del motore
 * unificato.
 */

const RAW = 100;
const AWC = 200;

describe("peacockEyeRisk (Spilocaea oleagina)", () => {
  it("scatta con bagnatura prolungata e temperatura mite", () => {
    const series = [
      { tMin: 12, tMax: 20, leafWetnessHours: 14 },
      { tMin: 12, tMax: 20, leafWetnessHours: 14 },
    ];
    const alert = peacockEyeRisk(series);
    assert.ok(alert, "atteso un alert");
    assert.ok(alert?.model.includes("pavone"));
    assert.ok((alert?.index ?? 0) >= 3);
  });

  it("tace senza bagnatura sufficiente o con caldo secco", () => {
    assert.equal(
      peacockEyeRisk([{ tMin: 14, tMax: 22, leafWetnessHours: 3 }]),
      null,
    );
    assert.equal(
      peacockEyeRisk([{ tMin: 28, tMax: 38, leafWetnessHours: 14 }]),
      null,
    );
  });

  it("escala a critico su bagnatura lunga in banda ottimale", () => {
    const alert = peacockEyeRisk([
      { tMin: 14, tMax: 20, leafWetnessHours: 20 },
    ]);
    assert.equal(alert?.index, 5);
    assert.equal(alert?.risk, "alto");
  });
});

describe("normalizzazione del risk 0..1", () => {
  it("mappa gli estremi index 1..5", () => {
    assert.equal(normalizeRiskIndex(0), 0);
    assert.equal(normalizeRiskIndex(5), 1);
    assert.equal(normalizeRiskIndex(10), 1); // clamp
    assert.equal(normalizeRiskIndex(2.5), 0.5);
  });
  it("alertA01 vale 0 senza alert", () => {
    assert.equal(alertA01(null), 0);
    assert.equal(
      alertA01({ model: "x", risk: "alto", index: 5, message: "", day: 0 }),
      1,
    );
  });
  it("riskLevelA01 ordina i livelli", () => {
    assert.equal(riskLevelA01("nullo"), 0);
    assert.ok(
      riskLevelA01("basso") < riskLevelA01("medio") &&
        riskLevelA01("medio") < riskLevelA01("alto"),
    );
  });
});

describe("yieldReductionFao66 (Ky)", () => {
  it("è 0 sopra RAW e cresce monotòna fino a Ky al punto di appassimento", () => {
    const ky = 1.0;
    assert.equal(yieldReductionFao66(RAW, RAW, AWC, ky), 0); // nessuno stress
    const a = yieldReductionFao66(130, RAW, AWC, ky);
    const b = yieldReductionFao66(160, RAW, AWC, ky);
    assert.ok(a > 0 && b > a, "monotòna crescente sotto RAW");
    assert.ok(b <= 1, "limitata a 1");
    assert.equal(yieldReductionFao66(AWC, RAW, AWC, ky), 1); // Ks=0 → perdita Ky
  });
});

describe("waterRisk01 e vettore di stress", () => {
  it("vale 0 a field pieno, 0.5 alla soglia RAW, 1 al punto di appassimento", () => {
    assert.equal(waterRisk01({ depletion: 0, raw: RAW, awc: AWC }), 0);
    assert.equal(waterRisk01({ depletion: RAW, raw: RAW, awc: AWC }), 0.5);
    assert.equal(waterRisk01({ depletion: AWC, raw: RAW, awc: AWC }), 1);
  });
  it("underWaterStress true solo da RAW in su", () => {
    assert.equal(underWaterStress({ depletion: 99, raw: RAW, awc: AWC }), false);
    assert.equal(underWaterStress({ depletion: 100, raw: RAW, awc: AWC }), true);
  });
  it("waterStressVector produce un rischio01 coerente e usa Ky della coltura", () => {
    const v = waterStressVector({ depletion: 150, raw: RAW, awc: AWC }, "mais");
    assert.equal(v.category, "idrico");
    assert.ok(v.rischio01 > 0.5 && v.rischio01 <= 1);
    assert.equal(cropKy("mais"), 1.25);
  });
});

describe("runDssEngine — composizione unificata", () => {
  it("unisce vettori patologici e idrico; il complessivo è il massimo", () => {
    const olivo = cropModuleById("olivo");
    assert.ok(olivo, "modulo olivo presente");
    // Serie che innesca l'occhio di pavone (bagnatura+temp mite) su più giorni.
    const series: DssWeatherDay[] = Array.from({ length: 4 }, (_, i) => ({
      data: `2026-04-0${i + 1}`,
      tMin: 12,
      tMax: 20,
      rhMean: 85,
      rain: 1,
      leafWetnessHours: 16,
    }));
    const out = runDssEngine(olivo!, series, undefined, {
      depletion: 180,
      raw: RAW,
      awc: AWC,
    });
    // C'è il vettore idrico + i vettori patologici dell'olivo.
    assert.ok(out.vettori.some((v) => v.category === "idrico"));
    assert.ok(out.vettori.some((v) => v.category === "fitopatologico"));
    const maxVettori = Math.max(...out.vettori.map((v) => v.rischio01));
    assert.equal(out.rischioComplessivo01, maxVettori);
    assert.ok(out.rischioComplessivo01 > 0);
  });

  it("senza stato idrico non aggiunge il vettore idrico", () => {
    const vite = cropModuleById("vite");
    const out = runDssEngine(vite!, [], undefined);
    assert.equal(out.vettori.every((v) => v.category === "fitopatologico"), true);
  });
});
