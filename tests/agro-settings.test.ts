import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DASHBOARD_MODULE_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardModuleId,
  formatArea,
  formatYield,
  loadDashboardLayout,
  loadUnits,
  mergeDashboardLayout,
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
  // se non ha flag, oppure se il suo flag è attivo nel layout.
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
