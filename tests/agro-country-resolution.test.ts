import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Polygon } from "geojson";
import {
  detectCountryAtPoint,
  hasCountryBbox,
  normalizeCountryCode,
  resolveCountry,
  resolvePerPlotCountry,
  type PlotGeometry,
} from "../packages/agro-core/src/compliance/country-resolution";
import {
  ISO_3166_1_ALPHA_2,
  isIsoAlpha2,
} from "../packages/agro-core/src/compliance/iso-3166";

/** Quadratino ~0.02° attorno a [lon, lat]: il suo centroid è [lon, lat]. */
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
  it("un field transfrontaliero è regolato dal paese in cui ricade", () => {
    const perPlot = resolvePerPlotCountry("IT", [
      plot("it", ...ROMA),
      plot("fr", ...PARIS),
    ]);
    assert.equal(perPlot.get("it"), "IT");
    assert.equal(perPlot.get("fr"), "FR");
  });

  it("un field fuori da ogni paese noto eredita il paese del tenant", () => {
    const perPlot = resolvePerPlotCountry("IT", [plot("sea", -40, 20)]);
    assert.equal(perPlot.get("sea"), "IT");
  });
});

describe("iso-3166 / invarianti dell'elenco", () => {
  // L'elenco è DATO scritto a mano: queste guardie servono a chi lo modificherà.
  it("non contiene duplicati ed è ordinato", () => {
    const codes = [...ISO_3166_1_ALPHA_2];
    assert.equal(new Set(codes).size, codes.length, "codice duplicato");
    assert.deepEqual(codes, [...codes].sort(), "elenco non ordinato");
  });

  it("contiene solo coppie di lettere maiuscole", () => {
    const bad = ISO_3166_1_ALPHA_2.filter((c) => !/^[A-Z]{2}$/.test(c));
    assert.deepEqual(bad, []);
  });

  it("non include la sentinella EU né i codici user-assigned", () => {
    // Se EU entrasse nell'elenco, la sentinella del fallback internazionale
    // colliderebbe con un paese vero e normalizeCountryCode perderebbe senso.
    assert.equal(isIsoAlpha2("EU"), false);
    for (const reserved of ["AA", "ZZ", "XK", "QM"]) {
      assert.equal(isIsoAlpha2(reserved), false, reserved);
    }
  });

  it("copre i mercati del catalogo particelle", () => {
    for (const code of ["IT", "ES", "FR", "NL", "DE", "AT", "SI"]) {
      assert.equal(isIsoAlpha2(code), true, code);
    }
  });
});

// Amsterdam: paese ISO valido, ma senza bounding box in COUNTRY_BBOXES.
const AMSTERDAM: [number, number] = [4.9, 52.37];

describe("country-resolution / paesi oltre quelli con adapter dedicato", () => {
  it("accetta qualunque codice ISO assegnato in anagrafica", () => {
    assert.equal(normalizeCountryCode("NL"), "NL");
    assert.equal(normalizeCountryCode("de"), "DE");
    assert.equal(normalizeCountryCode(" pt "), "PT");
  });

  it("continua a respingere ciò che non è un paese", () => {
    // Codici user-assigned: non sono paesi, sono refusi o segnaposto.
    assert.equal(normalizeCountryCode("ZZ"), null);
    assert.equal(normalizeCountryCode("AA"), null);
    assert.equal(normalizeCountryCode("XK"), null);
    assert.equal(normalizeCountryCode("ITA"), null);
  });

  it("distingue i paesi verificabili da quelli soltanto validi", () => {
    assert.equal(hasCountryBbox("IT"), true);
    assert.equal(hasCountryBbox("NL"), false);
    assert.equal(hasCountryBbox("EU"), false);
    assert.equal(hasCountryBbox(null), false);
  });

  it("un'azienda olandese risolve NL dall'anagrafica, senza falsi allarmi", () => {
    const r = resolveCountry({
      addressCountry: "NL",
      plots: [plot("a", ...AMSTERDAM)],
    });
    assert.equal(r.countryCode, "NL");
    assert.equal(r.source, "address");
    // Il cross-check si astiene: niente riquadro NL, quindi nessuna conclusione.
    assert.equal(r.checks[0].matchesDeclared, false);
    assert.equal(r.checks[0].detected, null);
    assert.deepEqual(r.warnings, []);
  });

  it("un field in un paese senza riquadro eredita il paese del tenant", () => {
    const perPlot = resolvePerPlotCountry("NL", [plot("nl", ...AMSTERDAM)]);
    assert.equal(perPlot.get("nl"), "NL");
  });

  it("il cross-check resta pieno per i paesi con riquadro noto", () => {
    // Regressione: allargare CountryCode non deve spegnere l'avviso dove il
    // riquadro c'è — azienda IT con un campo ad Amsterdam.
    const r = resolveCountry({
      addressCountry: "IT",
      plots: [plot("a", ...AMSTERDAM)],
    });
    assert.equal(r.countryCode, "IT");
    const w = r.warnings.find(
      (x) => x.key === "compliance.warning.plotsOutsideCountry",
    );
    assert.ok(w, "atteso warning plotsOutsideCountry");
    assert.equal(w?.params?.count, 1);
    // Nessun paese rilevato: NL non ha riquadro, quindi il detected resta vuoto.
    assert.equal(w?.params?.detected, "—");
  });
});
