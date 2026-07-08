import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Plot, SoilSample } from "@agrogea/core";
import {
  fractionsFromTexture,
  normalizeFractions,
  saxtonRawlsSoilParameters,
  saxtonRawls,
} from "@agrogea/tools";
import {
  aggregaTessitura,
  frazioniDaCampione,
  frazioniDaProprieta,
  parametriDaMetadata,
  parametersFromManualSoil,
  SUOLO_FRANCO_DEFAULT,
} from "../apps/agro-field-suite/src/modules/soil/SoilDataResolver";

/**
 * Validazione dell'engine pedotransfer (Saxton-Rawls) e dei mapper puri del
 * SoilDataResolver: tessitura → frazioni → θFC/θPWP, aggregazione soilSamples,
 * fallback da metadata. La parte spaziale (DuckDB) è IO e non è coperta qui.
 */

describe("fractionsFromTexture — classi multilingue e fallback", () => {
  it("riconosce le classi USDA in IT/EN/ES", () => {
    const argilloso = fractionsFromTexture("argilloso");
    const clay = fractionsFromTexture("clay");
    const arcilloso = fractionsFromTexture("arcilloso");
    assert.ok(argilloso && clay && arcilloso);
    assert.equal(argilloso!.argilla, clay!.argilla);
    assert.equal(argilloso!.argilla, arcilloso!.argilla);
    // l'argilloso è dominato dall'argilla
    assert.ok(argilloso!.argilla > argilloso!.sabbia);
  });

  it("normalizza separatori e accenti (franco-sabbioso)", () => {
    const a = fractionsFromTexture("Franco-Sabbioso");
    const b = fractionsFromTexture("franco sabbioso");
    assert.deepEqual(a, b);
    assert.ok(a && a.sabbia > a.argilla);
  });

  it("ricade sull'euristica a keyword per etichette composte", () => {
    const fr = fractionsFromTexture("terreno prevalentemente argilloso e limoso");
    assert.ok(fr);
    const somma = fr!.sabbia + fr!.limo + fr!.argilla;
    assert.ok(Math.abs(somma - 1) < 1e-9);
    assert.ok(fr!.argilla > 0 && fr!.limo > 0);
  });

  it("restituisce null per stringhe non pedologiche o vuote", () => {
    assert.equal(fractionsFromTexture(""), null);
    assert.equal(fractionsFromTexture("xyz123"), null);
    assert.equal(fractionsFromTexture(null), null);
  });
});

describe("normalizeFractions — percentuali a frazioni", () => {
  it("normalizza percentuali a somma 1", () => {
    const fr = normalizeFractions(50, 30, 20);
    assert.ok(fr);
    assert.ok(Math.abs(fr!.sabbia - 0.5) < 1e-9);
    assert.ok(Math.abs(fr!.sabbia + fr!.limo + fr!.argilla - 1) < 1e-9);
  });

  it("restituisce null se tutte nulle", () => {
    assert.equal(normalizeFractions(0, 0, 0), null);
  });
});

describe("saxtonRawls — sanità fisica θFC/θPWP", () => {
  it("FC > PWP e dentro i limiti fisici, per ogni tessitura", () => {
    for (const classe of ["sabbioso", "franco", "argilloso"]) {
      const fr = fractionsFromTexture(classe)!;
      const { fieldCapacity, wiltingPoint } = saxtonRawls(fr);
      assert.ok(fieldCapacity > wiltingPoint, `${classe}: FC>PWP`);
      assert.ok(wiltingPoint > 0 && fieldCapacity < 0.6, `${classe}: bounds`);
    }
  });

  it("l'argilla trattiene più acqua disponibile/residua della sabbia", () => {
    const sabbia = saxtonRawls(fractionsFromTexture("sabbioso")!);
    const argilla = saxtonRawls(fractionsFromTexture("argilloso")!);
    // l'argilla ha PWP nettamente più alto della sabbia (acqua più legata)
    assert.ok(argilla.wiltingPoint > sabbia.wiltingPoint);
    assert.ok(argilla.fieldCapacity > sabbia.fieldCapacity);
  });

  it("più sostanza organica aumenta la ritenzione", () => {
    const fr = fractionsFromTexture("franco")!;
    const povero = saxtonRawls(fr, 0.5);
    const ricco = saxtonRawls(fr, 5);
    assert.ok(ricco.fieldCapacity >= povero.fieldCapacity);
  });
});

describe("saxtonRawlsSoilParameters — composizione SoilParameters", () => {
  it("applica i default e gli override di profondità/depletion", () => {
    const fr = fractionsFromTexture("franco")!;
    const base = saxtonRawlsSoilParameters(fr);
    assert.equal(base.rootDepth, 0.8);
    assert.equal(base.depletionFraction, 0.5);

    const custom = saxtonRawlsSoilParameters(fr, {
      profonditaRadiciM: 1.2,
      depletionFraction: 0.4,
    });
    assert.equal(custom.rootDepth, 1.2);
    assert.equal(custom.depletionFraction, 0.4);
    assert.ok(custom.fieldCapacity > custom.wiltingPoint);
  });
});

describe("frazioniDaProprieta — feature custom e soilSamples", () => {
  it("preferisce le percentuali esplicite (multi spelling)", () => {
    const fr = frazioniDaProprieta({ sand: 60, silt: 30, clay: 10 });
    assert.ok(fr);
    assert.ok(Math.abs(fr!.sabbia - 0.6) < 1e-9);
  });

  it("ricade sulla classe tessiturale testuale", () => {
    const fr = frazioniDaProprieta({ texture: "clay loam" });
    assert.ok(fr);
    assert.ok(fr!.argilla > 0.2);
  });

  it("EC_a da sola non determina la tessitura (null)", () => {
    assert.equal(frazioniDaProprieta({ eca: 35, ecadeep: 40 }), null);
  });
});

function campione(over: Partial<SoilSample>): SoilSample {
  return {
    id: "c1",
    tenant_id: "t",
    company_id: "a",
    plot_id: "p",
    sampled_at: "2026-06-01T00:00:00Z",
    sampling_position: { type: "Point", coordinates: [11, 44] },
    depth_cm: 30,
    nitrogen: null,
    phosphorus: null,
    potassium: null,
    organic_matter: null,
    ph: null,
    texture: null,
    metadata: {},
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...over,
  };
}

describe("frazioniDaCampione / aggregaTessitura", () => {
  it("legge la tessitura dal field texture o dalle percentuali in metadata", () => {
    const daTexture = frazioniDaCampione(campione({ texture: "sandy loam" }));
    assert.ok(daTexture && daTexture.sabbia > daTexture.argilla);

    const daMeta = frazioniDaCampione(
      campione({ texture: null, metadata: { sabbia: 20, limo: 30, argilla: 50 } }),
    );
    assert.ok(daMeta && Math.abs(daMeta.argilla - 0.5) < 1e-9);
  });

  it("media frazioni e sostanza organica dei campioni validi", () => {
    const agg = aggregaTessitura([
      { frazioni: { sabbia: 0.6, limo: 0.3, argilla: 0.1 }, sostanzaOrganica: 2 },
      { frazioni: { sabbia: 0.4, limo: 0.3, argilla: 0.3 }, sostanzaOrganica: 4 },
    ]);
    assert.ok(agg);
    assert.equal(agg!.n, 2);
    assert.ok(Math.abs(agg!.frazioni.sabbia - 0.5) < 1e-9);
    assert.equal(agg!.sostanzaOrganica, 3);
  });

  it("aggrega null se la lista è vuota", () => {
    assert.equal(aggregaTessitura([]), null);
  });
});

describe("parametriDaMetadata — fallback Tier 3", () => {
  function plot(meta: Record<string, unknown>): Plot {
    return {
      id: "p1",
      tenant_id: "t",
      company_id: "a",
      user_plot_name: "Campo",
      cadastral_sheet: null,
      cadastral_parcel: null,
      area_ha: 2,
      last_ndvi_mean: null,
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      irrigation_type: null,
      planting_year: null,
      metadata: meta,
      created_at: "",
      updated_at: "",
      deleted_at: null,
    };
  }

  it("estrae i parametri completi dal metadata", () => {
    const p = parametriDaMetadata(
      plot({ parametri_suolo: { fieldCapacity: 0.33, wiltingPoint: 0.15 } }),
    );
    assert.ok(p);
    assert.equal(p!.fieldCapacity, 0.33);
    assert.equal(p!.rootDepth, SUOLO_FRANCO_DEFAULT.rootDepth);
  });

  it("null se il metadata non ha parametri soil completi", () => {
    assert.equal(parametriDaMetadata(plot({})), null);
    assert.equal(
      parametriDaMetadata(plot({ parametri_suolo: { fieldCapacity: 0.3 } })),
      null,
    );
  });
});

describe("parametersFromManualSoil — Tier 3 inserimento manuale", () => {
  function plotMeta(meta: Record<string, unknown>): Plot {
    return {
      id: "p2",
      tenant_id: "t",
      company_id: "a",
      user_plot_name: "Campo",
      cadastral_sheet: null,
      cadastral_parcel: null,
      area_ha: 2,
      last_ndvi_mean: null,
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      irrigation_type: null,
      planting_year: null,
      metadata: meta,
      created_at: "",
      updated_at: "",
      deleted_at: null,
    };
  }

  it("calcola θFC/θPWP via Saxton-Rawls dalla classe tessiturale manuale", () => {
    const p = parametersFromManualSoil(
      plotMeta({ suolo: { tessitura: "argilloso", sostanza_organica: 2 } }),
    );
    assert.ok(p);
    assert.ok(p!.fieldCapacity > p!.wiltingPoint);
    assert.equal(p!.rootDepth, SUOLO_FRANCO_DEFAULT.rootDepth);
  });

  it("usa le percentuali manuali e gli override profondità/depletion", () => {
    const p = parametersFromManualSoil(
      plotMeta({
        suolo: {
          sabbia: 30,
          limo: 30,
          argilla: 40,
          profondita_radici: 1.1,
          frazione_deplezione: 0.45,
        },
      }),
    );
    assert.ok(p);
    assert.equal(p!.rootDepth, 1.1);
    assert.equal(p!.depletionFraction, 0.45);
  });

  it("rispetta le costanti idrauliche dirette (utente esperto)", () => {
    const p = parametersFromManualSoil(
      plotMeta({ suolo: { capacita_campo: 0.34, punto_appassimento: 0.16 } }),
    );
    assert.ok(p);
    assert.equal(p!.fieldCapacity, 0.34);
    assert.equal(p!.wiltingPoint, 0.16);
  });

  it("null se non c'è composizione manuale utile", () => {
    assert.equal(parametersFromManualSoil(plotMeta({})), null);
    assert.equal(parametersFromManualSoil(plotMeta({ suolo: { ph: 6.5 } })), null);
  });
});
