import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Appezzamento,
  CampoCampagna,
  Raccolta,
  RegistroTrattamento,
} from "@agrogea/core";
import {
  buildSianCsv,
  COLONNE_SIAN,
  filtraTrattamentiSian,
  raccolteToOperazioni,
  risolviColonne,
} from "../apps/agro-field-suite/src/lib/sianExport";

function app(id: string, nome: string): Appezzamento {
  return {
    id,
    tenant_id: "t",
    company_id: "az",
    user_plot_name: nome,
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 2,
    last_ndvi_mean: null,
    geometry: { type: "Polygon", coordinates: [] },
    irrigation_type: null,
    planting_year: null,
    historical_notes: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  };
}

function tratt(
  id: string,
  plot_id: string | null,
  executed_at: string,
  tipo: RegistroTrattamento["operation_type"] = "phytosanitary",
): RegistroTrattamento {
  return {
    id,
    tenant_id: "t",
    company_id: "az",
    plot_id,
    plot_campaign_id: plot_id ? `cc-${plot_id}` : null,
    operation_type: tipo,
    product_name: "Rame",
    registration_number: null,
    dose_value: 1,
    dose_unit: "kg/ha",
    total_quantity: 2,
    target_disease: null,
    operator_name: null,
    machinery_equipment: null,
    active_substance: null,
    water_volume_l: null,
    operator_tax_code: null,
    license_number: null,
    fertilizer_type: null,
    npk_ratio: null,
    executed_at,
    reentry_interval_h: null,
    safety_period_days: null,
    weather_conditions: null,
    note: null,
    created_at: executed_at,
    updated_at: executed_at,
    deleted_at: null,
  };
}

function campo(
  plot_id: string,
  anno: number,
  over: Partial<CampoCampagna> = {},
): CampoCampagna {
  return {
    id: `cc-${plot_id}`,
    tenant_id: "t",
    plot_id,
    crop_id: `crop-${plot_id}`,
    campaign_year: anno,
    reference_parcel_external_id: "IS-1",
    agricultural_parcel_external_id: "AP-9",
    crop_external_code: "060",
    variety_external_code: "12",
    declared_area_ha: 2,
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

function raccolta(
  id: string,
  plot_id: string | null,
  harvested_at: string,
  over: Partial<Raccolta> = {},
): Raccolta {
  return {
    id,
    tenant_id: "t",
    company_id: "az",
    plot_id,
    plot_campaign_id: null,
    cultivar: "Sangiovese",
    destination_logistics: "Cantina Sociale",
    quantity_kg: 3200,
    harvested_at,
    geometry: null,
    notes: null,
    metadata: {},
    created_at: harvested_at,
    updated_at: harvested_at,
    deleted_at: null,
    ...over,
  };
}

const APPS = [app("a1", "Vigna Alta"), app("a2", "Campo Sud")];
const TRATT = [
  tratt("t1", "a1", "2026-03-10T08:00:00.000Z"),
  tratt("t2", "a2", "2026-05-20T08:00:00.000Z", "fertilization"),
  tratt("t3", null, "2026-06-01T08:00:00.000Z", "tillage"),
];

describe("filtraTrattamentiSian · temporale", () => {
  it("filtra per intervallo di date inclusivo", () => {
    const out = filtraTrattamentiSian(TRATT, APPS, {
      dal: "2026-05-01",
      al: "2026-05-31",
    });
    assert.deepEqual(out.map((t) => t.id), ["t2"]);
  });

  it("senza date restituisce tutto", () => {
    assert.equal(filtraTrattamentiSian(TRATT, APPS, {}).length, 3);
  });
});

describe("filtraTrattamentiSian · spaziale", () => {
  it("filtra per appezzamento ed esclude le operazioni intera azienda", () => {
    const out = filtraTrattamentiSian(TRATT, APPS, { appezzamentoIds: ["a1"] });
    assert.deepEqual(out.map((t) => t.id), ["t1"]);
  });

  it("può escludere le operazioni intera azienda", () => {
    const out = filtraTrattamentiSian(TRATT, APPS, {
      includiSenzaAppezzamento: false,
    });
    assert.deepEqual(out.map((t) => t.id).sort(), ["t1", "t2"]);
  });

  it("filtra per tipo di operazione", () => {
    const out = filtraTrattamentiSian(TRATT, APPS, {
      tipiOperazione: ["fertilization"],
    });
    assert.deepEqual(out.map((t) => t.id), ["t2"]);
  });
});

describe("buildSianCsv · struttura", () => {
  it("rispetta l'ordine e la selezione delle colonne", () => {
    const csv = buildSianCsv([TRATT[0]], APPS, {
      colonne: ["appezzamento", "data", "prodotto"],
      separatore: ";",
      includiIntestazioni: true,
      bom: true,
    });
    const [header, riga] = csv.split("\n");
    assert.equal(header, "Appezzamento;Data;Prodotto");
    assert.equal(riga, "Vigna Alta;2026-03-10;Rame");
  });

  it("onora il separatore e l'assenza di intestazioni", () => {
    const csv = buildSianCsv([TRATT[0]], APPS, {
      colonne: ["data", "prodotto"],
      separatore: ",",
      includiIntestazioni: false,
      bom: false,
    });
    assert.equal(csv, "2026-03-10,Rame");
  });

  it("quota le celle che contengono il separatore", () => {
    const conNote = { ...TRATT[0], note: "riga; con; separatore" };
    const csv = buildSianCsv([conNote], APPS, {
      colonne: ["note"],
      separatore: ";",
      includiIntestazioni: false,
      bom: false,
    });
    assert.equal(csv, '"riga; con; separatore"');
  });

  it("risolviColonne ignora gli id sconosciuti", () => {
    const cols = risolviColonne(["data", "inesistente", "prodotto"]);
    assert.deepEqual(cols.map((c) => c.id), ["data", "prodotto"]);
    assert.ok(COLONNE_SIAN.length >= cols.length);
  });
});

describe("buildSianCsv · riferimenti SIAN (join campi_campagna)", () => {
  it("popola i codici ministeriali dal join per plot_campaign_id", () => {
    const campi = [campo("a1", 2026)];
    const csv = buildSianCsv(
      [TRATT[0]],
      APPS,
      {
        colonne: [
          "reference_parcel_external_id",
          "agricultural_parcel_external_id",
          "crop_external_code",
          "campaign_year",
        ],
        separatore: ";",
        includiIntestazioni: true,
        bom: true,
      },
      campi,
    );
    const [header, riga] = csv.split("\n");
    assert.equal(
      header,
      "ID Isola SIAN;ID Appezzamento SIAN;Codice coltura SIAN;Anno campagna",
    );
    assert.equal(riga, "IS-1;AP-9;060;2026");
  });

  it("lascia vuoti i riferimenti senza campagna agganciata", () => {
    const csv = buildSianCsv(
      [TRATT[2]], // operazione intera azienda, plot_campaign_id null e plot_id null
      APPS,
      {
        colonne: ["tipo_operazione", "crop_external_code"],
        separatore: ";",
        includiIntestazioni: false,
        bom: false,
      },
      [campo("a1", 2026)],
    );
    // Tipo operazione in italiano (mai il codice interno "tillage"); ref vuoto.
    assert.equal(csv, "Lavorazione;");
  });

  it("FALLBACK: risolve i codici per appezzamento+anno se plot_campaign_id è null", () => {
    // Operazione su a1 senza aggancio diretto (es. semina auto-assegnata):
    // i codici SIAN vengono comunque dalla campagna del plot per quell'anno.
    const senzaAggancio = { ...tratt("t9", "a1", "2026-04-01T08:00:00.000Z"), plot_campaign_id: null };
    const csv = buildSianCsv(
      [senzaAggancio],
      APPS,
      {
        colonne: ["crop_external_code", "reference_parcel_external_id"],
        separatore: ";",
        includiIntestazioni: false,
        bom: false,
      },
      [campo("a1", 2026)],
    );
    assert.equal(csv, "060;IS-1");
  });

  it("il fallback preferisce la campagna APERTA su quella chiusa", () => {
    const chiusa = campo("a1", 2026, {
      id: "cc-old",
      crop_external_code: "999",
      closed_at: "2026-05-01T00:00:00.000Z",
    });
    const aperta = campo("a1", 2026, { id: "cc-new", crop_external_code: "060" });
    const op = { ...tratt("t10", "a1", "2026-07-01T08:00:00.000Z"), plot_campaign_id: null };
    const csv = buildSianCsv(
      [op],
      APPS,
      {
        colonne: ["crop_external_code"],
        separatore: ";",
        includiIntestazioni: false,
        bom: false,
      },
      [chiusa, aperta],
    );
    assert.equal(csv, "060");
  });
});

describe("buildSianCsv · tipo operazione localizzato", () => {
  it("default italiano leggibile, mai il codice interno", () => {
    const csv = buildSianCsv([TRATT[1]], APPS, {
      colonne: ["tipo_operazione"],
      separatore: ";",
      includiIntestazioni: false,
      bom: false,
    });
    assert.equal(csv, "Fertilizzazione");
  });

  it("la UI sovrascrive con la lingua attiva via contesto", () => {
    const csv = buildSianCsv(
      [TRATT[0]],
      APPS,
      { colonne: ["tipo_operazione"], separatore: ";", includiIntestazioni: false, bom: false },
      [],
      undefined,
      { resolveOperationType: (op) => (op === "phytosanitary" ? "Treatment" : op) },
    );
    assert.equal(csv, "Treatment");
  });
});

describe("raccolteToOperazioni · le raccolte rientrano nel QDCA", () => {
  it("mappa cultivar→prodotto, kg→quantità, destinazione e tipo harvest", () => {
    const ops = raccolteToOperazioni([
      raccolta("r1", "a1", "2026-09-15T08:00:00.000Z", {
        plot_campaign_id: "cc-a1",
      }),
    ]);
    assert.equal(ops.length, 1);
    const csv = buildSianCsv(
      ops,
      APPS,
      {
        colonne: ["tipo_operazione", "prodotto", "raccolta_kg", "destinazione", "crop_external_code"],
        separatore: ";",
        includiIntestazioni: false,
        bom: false,
      },
      [campo("a1", 2026)],
    );
    // Tipo "Raccolta", cultivar, kg, destinazione e codice SIAN dalla campagna.
    assert.equal(csv, "Raccolta;Sangiovese;3200;Cantina Sociale;060");
  });

  it("le colonne raccolta restano vuote sulle operazioni non-harvest", () => {
    const csv = buildSianCsv([TRATT[0]], APPS, {
      colonne: ["raccolta_kg", "destinazione"],
      separatore: ";",
      includiIntestazioni: false,
      bom: false,
    });
    assert.equal(csv, ";");
  });

  it("esclude le raccolte cancellate (tombstone)", () => {
    const ops = raccolteToOperazioni([
      raccolta("r1", "a1", "2026-09-15T08:00:00.000Z", {
        deleted_at: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    assert.equal(ops.length, 0);
  });
});
