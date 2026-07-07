import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plot } from "@agrogea/core";
import {
  summaryCalibration,
  coloreRischioDss,
  costruisciOverlayDss,
  livelloRischioDss,
  rampaRischioDss,
  type FieldSummary,
  summarizeFieldRisk,
} from "../apps/agro-field-suite/src/modules/dss/dss-overlay";

/**
 * Sintesi spaziale del risk DSS (Modulo 3): punteggio bilanciato per coltura,
 * rampa cromatica e costruzione dell'overlay coropletico.
 */

const CAL = summaryCalibration("vite", "piena");

describe("summarizeFieldRisk", () => {
  it("è in [0,1] e cresce con lo stress idrico", () => {
    const basso = summarizeFieldRisk(
      { stressIdrico01: 0.1, rischioPatologico01: 0.1, ndvi: 0.8 },
      CAL,
    );
    const alto = summarizeFieldRisk(
      { stressIdrico01: 0.9, rischioPatologico01: 0.1, ndvi: 0.8 },
      CAL,
    );
    assert.ok(basso >= 0 && basso <= 1);
    assert.ok(alto > basso, "più stress ⇒ più risk");
  });

  it("NDVI alto (vigore pieno) abbassa il risk rispetto a NDVI basso", () => {
    const vigoroso = summarizeFieldRisk(
      { stressIdrico01: 0.3, rischioPatologico01: 0.3, ndvi: 0.85 },
      CAL,
    );
    const stentato = summarizeFieldRisk(
      { stressIdrico01: 0.3, rischioPatologico01: 0.3, ndvi: 0.3 },
      CAL,
    );
    assert.ok(stentato > vigoroso);
  });

  it("gestisce NDVI/suolo assenti rinormalizzando i pesi (resta in [0,1])", () => {
    const v = summarizeFieldRisk(
      { stressIdrico01: 0.5, rischioPatologico01: 0.5, ndvi: null },
      CAL,
    );
    assert.ok(v >= 0 && v <= 1);
    // Con soli stress+patologie a 0.5 il punteggio è ~0.5.
    assert.ok(Math.abs(v - 0.5) < 1e-9);
  });

  it("il deficit di azoto alza il risk", () => {
    const senza = summarizeFieldRisk(
      { stressIdrico01: 0.2, rischioPatologico01: 0.2, ndvi: 0.7 },
      CAL,
    );
    const carente = summarizeFieldRisk(
      { stressIdrico01: 0.2, rischioPatologico01: 0.2, ndvi: 0.7, azoto: 2 },
      CAL,
    );
    assert.ok(carente > senza);
  });
});

describe("calibrazione per coltura", () => {
  it("usa la banda NDVI della phase e cambia i pesi tra colture", () => {
    const vite = summaryCalibration("vite", "piena");
    const mais = summaryCalibration("mais", "piena");
    assert.deepEqual(vite.ndviAtteso, [0.6, 0.85]);
    // Il mais (seminativo) pesa di più lo stress idrico della vite.
    assert.ok(mais.pesoStress > vite.pesoStress);
  });
  it("la rampa per coltura ha 3 stop verde→giallo→rosso", () => {
    const r = rampaRischioDss("vite");
    assert.equal(r.length, 3);
    assert.equal(r[0][1], "#1a9850");
    assert.equal(r[2][1], "#d73027");
    assert.ok(r[0][0] < r[1][0] && r[1][0] < r[2][0], "soglie crescenti");
  });
});

describe("coloreRischioDss / livelloRischioDss", () => {
  it("mappa il punteggio su verde/giallo/rosso secondo la rampa", () => {
    const r = rampaRischioDss("vite");
    assert.equal(coloreRischioDss(0, r), "#1a9850"); // verde
    assert.equal(coloreRischioDss(1, r), "#d73027"); // rosso
  });
  it("etichetta i tre livelli", () => {
    assert.equal(livelloRischioDss(0.1), "ottimale");
    assert.equal(livelloRischioDss(0.5), "allerta");
    assert.equal(livelloRischioDss(0.8), "critico");
  });
});

function apz(id: string): Plot {
  return {
    id,
    tenant_id: "t",
    company_id: "c",
    user_plot_name: `P-${id}`,
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 1,
    last_ndvi_mean: null,
    geometry: {
      type: "Polygon",
      coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    },
    irrigation_type: null,
    planting_year: null,
    metadata: {},
    created_at: "",
    updated_at: "",
    deleted_at: null,
  };
}

describe("costruisciOverlayDss", () => {
  it("colora gli appezzamenti con sintesi e omette gli altri", () => {
    const appezzamenti = [apz("a"), apz("b"), apz("c")];
    const sintesi = new Map<string, FieldSummary>([
      ["a", { rischio01: 0.05 }],
      ["c", { rischio01: 0.9 }],
    ]);
    const fc = costruisciOverlayDss(appezzamenti, sintesi, rampaRischioDss("vite"));
    assert.equal(fc.features.length, 2); // b è omesso (niente sintesi)
    const a = fc.features.find((f) => f.properties?.id === "a");
    const c = fc.features.find((f) => f.properties?.id === "c");
    assert.equal(a?.properties?.livello, "ottimale");
    assert.equal(c?.properties?.livello, "critico");
    assert.ok(typeof a?.properties?.fillColor === "string");
  });
});
