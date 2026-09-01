import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DASHBOARD_MODULE_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_MAP_ZOOM_LIMITS,
  MAP_ZOOM_CEILING,
  MAP_ZOOM_CHOICES,
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
 * Limiti di zoom della mappa. 13 e 17 sono gli estremi ASSOLUTI: l'utente può
 * stringere l'intervallo, mai allargarlo oltre. L'invariante `min <= max` non è
 * cosmetica — un intervallo invertito farebbe alzare `minZoom` sopra `maxZoom`
 * e la vista resterebbe incastrata.
 */
describe("normalizeMapZoomLimits", () => {
  it("gli estremi assoluti sono 13 e 17, e sono anche il default", () => {
    assert.equal(MAP_ZOOM_FLOOR, 13);
    assert.equal(MAP_ZOOM_CEILING, 17);
    assert.deepEqual(DEFAULT_MAP_ZOOM_LIMITS, { min: 13, max: 17 });
  });

  it("senza preferenze salvate usa l'intervallo pieno 13–17", () => {
    assert.deepEqual(normalizeMapZoomLimits(null), DEFAULT_MAP_ZOOM_LIMITS);
    assert.deepEqual(normalizeMapZoomLimits(undefined), { min: 13, max: 17 });
    assert.deepEqual(normalizeMapZoomLimits({}), { min: 13, max: 17 });
  });

  it("il selettore propone solo i valori ammessi", () => {
    assert.deepEqual([...MAP_ZOOM_CHOICES], [13, 14, 15, 16, 17]);
  });

  it("un intervallo più stretto dei limiti è lecito e viene rispettato", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: 15, max: 16 }), {
      min: 15,
      max: 16,
    });
  });

  it("nessuno può allargare l'intervallo oltre 13–17", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: -5, max: 99 }), {
      min: 13,
      max: 17,
    });
    // Anche un valore salvato quando i limiti erano più larghi viene riportato
    // dentro: il clamp vale in lettura, non solo sull'input del selettore.
    assert.deepEqual(normalizeMapZoomLimits({ min: 8, max: 20 }), {
      min: 13,
      max: 17,
    });
  });

  it("arrotonda a interi dentro l'intervallo", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: 14.4, max: 15.6 }), {
      min: 14,
      max: 16,
    });
  });

  it("raddrizza un intervallo invertito invece di lasciarlo passare", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: 16, max: 14 }), {
      min: 14,
      max: 16,
    });
  });

  it("un valore non numerico ricade sul suo default, senza toccare l'altro", () => {
    assert.deepEqual(normalizeMapZoomLimits({ min: "abc", max: 15 }), {
      min: 13,
      max: 15,
    });
  });
});
