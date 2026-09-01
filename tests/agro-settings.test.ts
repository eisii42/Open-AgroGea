import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DASHBOARD_MODULE_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_MAP_ZOOM_LIMITS,
  MAP_ZOOM_CEILING,
  MAP_ZOOM_FLOOR,
  type DashboardModuleId,
  formatArea,
  formatYield,
  loadDashboardLayout,
  loadUnits,
  mergeDashboardLayout,
  normalizeMapZoomLimits,
} from "../packages/agro-core/src/field/settings";

describe("mergeDashboardLayout", () => {
  it("returns the full default set for empty/null input", () => {
    const cfg = mergeDashboardLayout(null);
    assert.deepEqual(Object.keys(cfg).sort(), [...DASHBOARD_MODULE_IDS].sort());
    assert.deepEqual(cfg, DEFAULT_DASHBOARD_LAYOUT);
  });

  it("overrides only known boolean keys and ignores unknown ones", () => {
    const cfg = mergeDashboardLayout({
      panelNdvi: false,
      mapMeasure: false,
      bogusKey: true,
      panelVra: "yes", // non-boolean: ignorato, resta il default
    });
    assert.equal(cfg.panelNdvi, false);
    assert.equal(cfg.mapMeasure, false);
    assert.equal(cfg.panelVra, DEFAULT_DASHBOARD_LAYOUT.panelVra);
    assert.equal((cfg as Record<string, unknown>).bogusKey, undefined);
  });

  it("backfills newly added modules with their default (forward-compatible)", () => {
    // Una config legacy che conosce solo un flag: gli altri ereditano il default.
    const cfg = mergeDashboardLayout({ panelQuaderno: false });
    assert.equal(cfg.panelQuaderno, false);
    for (const id of DASHBOARD_MODULE_IDS) {
      if (id === "panelQuaderno") continue;
      assert.equal(cfg[id], DEFAULT_DASHBOARD_LAYOUT[id], `manca default per ${id}`);
    }
  });
});

describe("module visibility predicate", () => {
  // Riproduce il gating usato da sidebar/command palette: una voce è visibile
  // se non ha flag, oppure se il suo flag è active nel layout.
  const visible = (
    layout: Record<DashboardModuleId, boolean>,
    flag?: DashboardModuleId,
  ) => !flag || layout[flag];

  it("disabling every module keeps only flagless items, never throws", () => {
    const allOff = Object.fromEntries(
      DASHBOARD_MODULE_IDS.map((id) => [id, false]),
    ) as Record<DashboardModuleId, boolean>;

    // Voci senza flag (es. strumenti di disegno) restano sempre visibili.
    assert.equal(visible(allOff, undefined), true);
    // Ogni voce con flag risulta nascosta, senza eccezioni.
    for (const id of DASHBOARD_MODULE_IDS) {
      assert.equal(visible(allOff, id), false);
    }
  });
});

describe("formatArea", () => {
  it("formats hectares by default", () => {
    assert.equal(formatArea(12.3456, "ha"), "12.35 ha");
  });
  it("converts to acres", () => {
    assert.equal(formatArea(1, "ac"), "2.47 ac");
  });
  it("returns an em dash for null/NaN", () => {
    assert.equal(formatArea(null, "ha"), "—");
    assert.equal(formatArea(Number.NaN, "ha"), "—");
  });
});

describe("formatYield", () => {
  it("converts kilograms to quintals, tonnes and kg", () => {
    assert.equal(formatYield(1000, "q"), "10.00 q");
    assert.equal(formatYield(1000, "t"), "1.00 t");
    assert.equal(formatYield(1000, "kg"), "1000.00 kg");
  });
  it("returns an em dash for null", () => {
    assert.equal(formatYield(null, "q"), "—");
  });
});

describe("load* fallbacks without localStorage", () => {
  it("loadDashboardLayout falls back to defaults in a non-DOM env", () => {
    assert.deepEqual(loadDashboardLayout(), DEFAULT_DASHBOARD_LAYOUT);
  });
  it("loadUnits falls back to the metric default", () => {
    assert.deepEqual(loadUnits(), { area: "ha", yield: "q", water: "mm" });
  });
});

/**
 * Limiti di zoom della mappa (default 13–17, modificabili in Impostazioni):
 * l'invariante `min <= max` non è cosmetica — un intervallo invertito farebbe
 * alzare `minZoom` sopra `maxZoom` e la vista resterebbe incastrata.
 */
describe("normalizeMapZoomLimits", () => {
  it("senza preferenze salvate usa il default 13–17", () => {
    assert.deepEqual(normalizeMapZoomLimits(null), DEFAULT_MAP_ZOOM_LIMITS);
    assert.deepEqual(normalizeMapZoomLimits(undefined), { min: 13, max: 17 });
    assert.deepEqual(normalizeMapZoomLimits({}), { min: 13, max: 17 });
  });

  it("clampa agli estremi ammessi e arrotonda a interi", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: -5, max: 99 }), {
      min: MAP_ZOOM_FLOOR,
      max: MAP_ZOOM_CEILING,
    });
    assert.deepEqual(normalizeMapZoomLimits({ min: 12.4, max: 18.6 }), {
      min: 12,
      max: 19,
    });
  });

  it("raddrizza un intervallo invertito invece di lasciarlo passare", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: 18, max: 14 }), {
      min: 14,
      max: 18,
    });
  });

  it("un valore non numerico ricade sul suo default, senza toccare l'altro", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: "abc", max: 20 }), {
      min: 13,
      max: 20,
    });
  });
});
