import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { isAllowedPluginManifestUrl } from "@geolibre/core";
import {
  CHECK_GROUPS,
  CORE_CHECKS,
  a1AgriculturalActivity,
  b3Gaec6SoilCover,
  runCheck,
  resolveParameters,
  type CheckInput,
  type CheckSpec,
} from "@agrogea/tools";
import {
  complianceRegistry,
  registerComplianceCheck,
  resetComplianceRegistry,
  unregisterComplianceCheck,
} from "../apps/agro-field-suite/src/modules/compliance/compliance-registry";
import {
  REPORT_DISCLAIMER,
  buildComplianceReport,
  reportFilename,
} from "../apps/agro-field-suite/src/modules/compliance/compliance-report";
import { minDistanceToLayerM } from "../apps/agro-field-suite/src/modules/compliance/geo-compliance";
import type { Plot } from "../packages/agro-core/src/types";
import { useAgroStore } from "../packages/agro-core/src/index";

/**
 * Modulo Compliance lato applicazione: il punto di innesto dei plugin, il
 * calcolo geometrico della BCAA 4 e il report esportabile.
 */

const NOW = "2026-09-01T00:00:00.000Z";

function plot(): Plot {
  return {
    id: "plot-1",
    tenant_id: "tenant-1",
    company_id: "company-1",
    user_plot_name: "Campo del Pozzo",
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 5,
    last_ndvi_mean: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [11, 43],
          [11.001, 43],
          [11.001, 43.001],
          [11, 43.001],
          [11, 43],
        ],
      ],
    },
    irrigation_type: null,
    planting_year: null,
    historical_notes: null,
    metadata: {},
    source_id: null,
    nuts_code: null,
    reference_unit_type: null,
    validity_year: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };
}

describe("modulo compliance / innesto dei plugin", () => {
  beforeEach(() => resetComplianceRegistry());

  it("parte dal catalogo del core e NON carica alcun plugin", () => {
    // In questa fase il sistema di plugin non si implementa: c'è solo la
    // giuntura. Un sistema di plugin a metà è peggio di nessun sistema.
    const registry = complianceRegistry();
    const ids = registry.list().map((s) => s.id);
    assert.ok(ids.includes("a1_agricultural_activity"));
    assert.ok(ids.includes("organic_inputs"));
    for (const id of ids) {
      assert.equal(registry.sourceOf(id), "core", `${id} non è del core`);
    }
  });

  it("accetta una scheda di plugin e la sa rimuovere allo scarico", () => {
    const fromPlugin: CheckSpec = { ...b3Gaec6SoilCover, id: "consortium_docg_rule" };
    registerComplianceCheck(fromPlugin);
    assert.equal(complianceRegistry().sourceOf("consortium_docg_rule"), "plugin");
    assert.equal(unregisterComplianceCheck("consortium_docg_rule"), true);
    assert.equal(complianceRegistry().get("consortium_docg_rule"), null);
  });

  it("un plugin non può rimpiazzare una scheda del core né rimuoverla", () => {
    assert.throws(
      () => registerComplianceCheck({ ...a1AgriculturalActivity }),
      /duplicata/,
    );
    assert.throws(() => unregisterComplianceCheck("a1_agricultural_activity"), /core/);
  });

  it("la regola di schema dei manifest è quella di GeoLibre, non una nostra", () => {
    // Da un manifest si arriva a codice scaricato ed eseguito: la regola è già
    // applicata dal dialogo Impostazioni e dal caricamento di un progetto, e il
    // modulo compliance vi si appoggia invece di inventarne una parallela.
    assert.equal(isAllowedPluginManifestUrl("https://plugin.example/manifest.json"), true);
    assert.equal(isAllowedPluginManifestUrl("http://localhost:5173/manifest.json"), true);
    assert.equal(isAllowedPluginManifestUrl("http://plugin.example/manifest.json"), false);
    assert.equal(isAllowedPluginManifestUrl("non-un-url"), false);
  });
});

describe("modulo compliance / distanza dal reticolo idrografico (BCAA 4)", () => {
  it("misura in metri la distanza dal corso d'acqua più vicino", () => {
    // Il quadrato del test è largo circa 81 m in longitudine a 43° di
    // latitudine; il corso d'acqua corre 0,0005° più a est, cioè ~40 m.
    const distance = minDistanceToLayerM(plot().geometry, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [11.0015, 42.999],
              [11.0015, 43.002],
            ],
          },
        },
      ],
    });
    assert.ok(distance != null);
    assert.ok(distance > 35 && distance < 45, `distanza inattesa: ${distance}`);
  });

  it("un layer senza geometrie utili non produce una distanza inventata", () => {
    // Assenza di dato, non distanza infinita: la scheda la tratta come "non
    // decidibile" invece che come conformità.
    assert.equal(
      minDistanceToLayerM(plot().geometry, { type: "FeatureCollection", features: [] }),
      null,
    );
  });
});

describe("modulo compliance / report esportabile", () => {
  function results(): CheckInput extends never ? never : ReturnType<typeof runCheck>[] {
    const points = Array.from({ length: 8 }, (_, i) => ({
      date: new Date(Date.parse("2026-03-01T00:00:00.000Z") + i * 10 * 86_400_000).toISOString(),
      sceneId: `S2_${i}`,
      collection: "sentinel-2-l2a",
      gsdM: 10,
      cloudCoverPct: 5,
      validPixels: 400,
      values: { ndvi: [0.75, 0.8, 0.82, 0.3, 0.45, 0.6, 0.65, 0.7][i] },
    }));
    const input: CheckInput = {
      plot: { id: "plot-1", name: "Campo del Pozzo", areaHa: 5 },
      campaignYear: 2026,
      country: "IT",
      series: { plotId: "plot-1", points },
      campaigns: [],
      operations: [],
      layers: { available: [], intersects: [], minDistanceToWaterM: null },
      terrain: null,
      parameters: resolveParameters(a1AgriculturalActivity),
      now: NOW,
    };
    return [runCheck(a1AgriculturalActivity, input)];
  }

  it("il disclaimer è un campo del documento, non una nota della schermata", () => {
    // Il file viene inoltrato, allegato, riaperto fra due anni: la natura del
    // documento deve viaggiare con lui.
    const raw = buildComplianceReport({
      plot: plot(),
      companyName: "Azienda Test",
      campaignYear: 2026,
      results: results(),
      generatedAt: NOW,
    });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.disclaimer, REPORT_DISCLAIMER);
    assert.match(parsed.disclaimer, /NON è un controllo ufficiale/);
    assert.match(parsed.disclaimer, /AMS/);
  });

  it("ogni esito nel file si dichiara autovalutazione", () => {
    const parsed = JSON.parse(
      buildComplianceReport({
        plot: plot(),
        companyName: null,
        campaignYear: 2026,
        results: results(),
        generatedAt: NOW,
      }),
    );
    for (const check of parsed.checks) {
      assert.equal(check.assessment, "self_assessment");
    }
  });

  it("il file porta scene, parametri e incertezza, non il solo verdetto", () => {
    // Un giudizio che non si può contestare non serve a chi lo riceve.
    const parsed = JSON.parse(
      buildComplianceReport({
        plot: plot(),
        companyName: null,
        campaignYear: 2026,
        results: results(),
        generatedAt: NOW,
      }),
    );
    const check = parsed.checks[0];
    assert.ok(check.scenes.length > 0);
    assert.ok(check.parameters.length > 0);
    assert.ok(check.confidence.factors.length > 0);
    assert.ok(check.series.points.length > 0);
  });

  it("la sintesi conta tutti e quattro gli esiti, 'non decidibile' compreso", () => {
    const parsed = JSON.parse(
      buildComplianceReport({
        plot: plot(),
        companyName: null,
        campaignYear: 2026,
        results: results(),
        generatedAt: NOW,
      }),
    );
    assert.deepEqual(Object.keys(parsed.summary).sort(), [
      "attention",
      "compliant",
      "non_compliant",
      "undecidable",
    ]);
  });

  it("il nome del file dice che cos'è e a quale annata si riferisce", () => {
    assert.equal(
      reportFilename(plot(), 2026),
      "autovalutazione-compliance_campo-del-pozzo_2026.json",
    );
  });
});

describe("modulo compliance / navigazione: il modulo ha il suo appezzamento", () => {
  beforeEach(() => {
    useAgroStore.setState({
      openPanels: [],
      panelMode: "floating",
      complianceGroup: "eligibility",
      compliancePlotId: null,
      selectedPlotId: "plot-selezionato-sulla-mappa",
    });
  });

  it("aprire una famiglia di schede apre il pannello già su quella voce", () => {
    useAgroStore.getState().openComplianceGroup("conditionality");
    const state = useAgroStore.getState();
    assert.equal(state.complianceGroup, "conditionality");
    assert.ok(state.openPanels.includes("compliance-monitor"));
  });

  it("NON tocca l'appezzamento selezionato sulla mappa", () => {
    // È il vincolo che tiene separati i due gesti: il click sulla mappa apre il
    // Quaderno di Campagna e deve continuare a farlo. La valutazione normativa
    // ha il proprio appezzamento, scelto dal pannello.
    useAgroStore.getState().openComplianceGroup("organic");
    assert.equal(
      useAgroStore.getState().selectedPlotId,
      "plot-selezionato-sulla-mappa",
    );

    useAgroStore.getState().setCompliancePlotId("plot-della-normativa");
    const state = useAgroStore.getState();
    assert.equal(state.compliancePlotId, "plot-della-normativa");
    assert.equal(state.selectedPlotId, "plot-selezionato-sulla-mappa");
  });

  it("riaprire la stessa famiglia non duplica il pannello", () => {
    const { openComplianceGroup } = useAgroStore.getState();
    openComplianceGroup("transversal");
    openComplianceGroup("transversal");
    assert.equal(
      useAgroStore.getState().openPanels.filter((p) => p === "compliance-monitor")
        .length,
      1,
    );
  });

  it("ogni scheda del catalogo dichiara la propria famiglia", () => {
    // La famiglia è un campo della scheda, non un prefisso dell'id da
    // interpretare: una scheda di plugin deve dire dove va.
    const groups = new Set(CORE_CHECKS.map((s) => s.group));
    assert.deepEqual(
      [...groups].sort(),
      ["conditionality", "ecoSchemes", "eligibility", "organic", "transversal"],
    );
    for (const spec of CORE_CHECKS) {
      assert.ok(CHECK_GROUPS.includes(spec.group), `${spec.id}: famiglia ignota`);
    }
  });

  it("ogni famiglia della sidebar ha almeno una scheda", () => {
    // Una voce di menù che apre una lista vuota è un vicolo cieco.
    for (const group of CHECK_GROUPS) {
      assert.ok(
        CORE_CHECKS.some((s) => s.group === group),
        `la famiglia ${group} non ha schede`,
      );
    }
  });
});
