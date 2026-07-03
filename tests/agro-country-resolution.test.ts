import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Polygon } from "geojson";
import {
  detectCountryAtPoint,
  normalizeCountryCode,
  resolveCountry,
  resolvePerPlotCountry,
  type PlotGeometry,
} from "../packages/agro-core/src/compliance/country-resolution";

/** Quadratino ~0.02° attorno a [lon, lat]: il suo centroide è [lon, lat]. */
function squareAt(lon: number, lat: number): Polygon {
  const d = 0.01;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ],
    ],
  };
}

function plot(id: string, lon: number, lat: number): PlotGeometry {
  return { plotId: id, geometria: squareAt(lon, lat) };
}

const ROMA: [number, number] = [12.5, 41.9];
const MADRID: [number, number] = [-3.7, 40.4];
const PARIS: [number, number] = [2.35, 48.85];
const TENERIFE: [number, number] = [-16.5, 28.3];

describe("country-resolution / detection di base", () => {
  it("riconosce i paesi supportati dalle coordinate", () => {
    assert.equal(detectCountryAtPoint(...ROMA), "IT");
    assert.equal(detectCountryAtPoint(...MADRID), "ES");
    assert.equal(detectCountryAtPoint(...PARIS), "FR");
    // Canarie: secondo riquadro della Spagna.
    assert.equal(detectCountryAtPoint(...TENERIFE), "ES");
  });

  it("ritorna null fuori dai paesi noti (es. mar aperto)", () => {
    assert.equal(detectCountryAtPoint(-40, 20), null);
  });

  it("normalizza codici e nomi paese", () => {
    assert.equal(normalizeCountryCode("it"), "IT");
    assert.equal(normalizeCountryCode("Italia"), "IT");
    assert.equal(normalizeCountryCode("España"), "ES");
    assert.equal(normalizeCountryCode("FRANCE"), "FR");
    assert.equal(normalizeCountryCode("international"), "EU");
    assert.equal(normalizeCountryCode(""), null);
    assert.equal(normalizeCountryCode(null), null);
    assert.equal(normalizeCountryCode("ZZ"), null);
  });
});

describe("country-resolution / risoluzione primaria (anagrafica)", () => {
  it("l'indirizzo legale è la sorgente autorevole", () => {
    const r = resolveCountry({
      addressCountry: "ES",
      plots: [plot("a", ...MADRID)],
    });
    assert.equal(r.countryCode, "ES");
    assert.equal(r.source, "address");
    assert.equal(r.warnings.length, 0);
  });

  it("indirizzo valido vince anche se i campi sono altrove (con warning)", () => {
    const r = resolveCountry({
      addressCountry: "IT",
      plots: [plot("a", ...PARIS)],
    });
    assert.equal(r.countryCode, "IT");
    assert.equal(r.source, "address");
    const w = r.warnings.find((x) => x.key === "compliance.warning.plotsOutsideCountry");
    assert.ok(w, "atteso warning plotsOutsideCountry");
    assert.equal(w?.params?.count, 1);
    assert.equal(w?.params?.detected, "FR");
  });
});

describe("country-resolution / cross-check spaziale", () => {
  it("senza indirizzo deriva il paese dalle coordinate (maggioranza)", () => {
    const r = resolveCountry({
      addressCountry: null,
      plots: [plot("a", ...MADRID), plot("b", ...MADRID), plot("c", ...PARIS)],
    });
    assert.equal(r.countryCode, "ES");
    assert.equal(r.source, "coordinates");
    assert.ok(
      r.warnings.some((x) => x.key === "compliance.warning.addressCoordsMismatch"),
    );
  });

  it("rileva coordinate invertite (lat/lon scambiate)", () => {
    // Roma con assi scambiati: [lat, lon] invece di [lon, lat].
    const r = resolveCountry({
      addressCountry: "IT",
      plots: [plot("a", ROMA[1], ROMA[0])],
    });
    const check = r.checks[0];
    assert.equal(check.matchesDeclared, false);
    assert.equal(check.swappedCoordinates, true);
    assert.ok(
      r.warnings.some((x) => x.key === "compliance.warning.swappedCoordinates"),
    );
  });

  it("nessuna sorgente → fallback default con warning", () => {
    const r = resolveCountry({ addressCountry: null, plots: [] });
    assert.equal(r.countryCode, "EU");
    assert.equal(r.source, "default");
    assert.ok(
      r.warnings.some((x) => x.key === "compliance.warning.noCountryResolved"),
    );
  });
});

describe("country-resolution / contesto per sotto-appezzamento", () => {
  it("un campo transfrontaliero è regolato dal paese in cui ricade", () => {
    const perPlot = resolvePerPlotCountry("IT", [
      plot("it", ...ROMA),
      plot("fr", ...PARIS),
    ]);
    assert.equal(perPlot.get("it"), "IT");
    assert.equal(perPlot.get("fr"), "FR");
  });

  it("un campo fuori da ogni paese noto eredita il paese del tenant", () => {
    const perPlot = resolvePerPlotCountry("IT", [plot("sea", -40, 20)]);
    assert.equal(perPlot.get("sea"), "IT");
  });
});
