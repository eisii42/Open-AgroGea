import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANY_TRANSFER_FORMAT,
  COMPANY_TRANSFER_VERSION,
  CompanyTransferError,
  TRANSFER_SCHEMA_VERSION,
  documentSchemaVersion,
  emptyCompanySnapshot,
  migrateTransferDocument,
  parseCompanyTransfer,
  planPlotImport,
  serializeCompanySnapshot,
  type Company,
  type CompanySnapshot,
  type Plot,
  type PlotBundle,
} from "@agrogea/core";
import type { Polygon } from "geojson";

/**
 * Formato di scambio v2: `schemaVersion` di primo livello, migrazione dai file
 * v1 già in circolazione, cancello sulle versioni future e import idempotente e
 * non distruttivo.
 */

const GEOMETRY: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [5.1, 51.44],
      [5.11, 51.44],
      [5.11, 51.45],
      [5.1, 51.44],
    ],
  ],
};

const EXPORTED_AT = "2026-09-01T08:00:00.000Z";

function company(): Company {
  return {
    id: "company-1",
    tenant_id: "tenant-1",
    business_name: "Azienda di prova",
    national_company_id: null,
    vat_number: null,
    legal_form: null,
    address: null,
    city: null,
    province: null,
    region: null,
    postal_code: null,
    country: "NL",
    email: null,
    pec: null,
    sdi_code: null,
    centroid: null,
    certifications: [],
    operator_certifications: [],
    farm_file_id: null,
    paying_agency: null,
    contact_name: null,
    contact_role: null,
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
  };
}

function plot(overrides: Partial<Plot> = {}): Plot {
  return {
    id: "plot-1",
    tenant_id: "tenant-1",
    company_id: "company-1",
    user_plot_name: "Campo dei Mais",
    cadastral_sheet: null,
    cadastral_parcel: null,
    area_ha: 2.4312,
    last_ndvi_mean: null,
    geometry: GEOMETRY,
    irrigation_type: null,
    planting_year: null,
    historical_notes: null,
    source_id: "BRP.2025.45247317",
    nuts_code: "NL",
    reference_unit_type: "agricultural_parcel",
    validity_year: 2025,
    metadata: {
      parcel: {
        origin: "parcel-adoption",
        sourceName: "BRP Gewaspercelen (INSPIRE geharmoniseerd)",
        license: { id: "CC0-1.0", attribution: "RVO / PDOK" },
        originalCrs: "EPSG:4258",
      },
    },
    created_at: EXPORTED_AT,
    updated_at: EXPORTED_AT,
    deleted_at: null,
    ...overrides,
  };
}

function bundle(overrides: Partial<Plot> = {}): PlotBundle {
  return {
    plot: plot(overrides),
    campaigns: [],
    treatments: [],
    soilSamples: [],
    harvests: [],
  };
}

function snapshot(): CompanySnapshot {
  return { ...emptyCompanySnapshot(company()), plots: [bundle()] };
}

/** Documento v1: nessun `schemaVersion`, nessun campo di provenienza. */
function v1Document(): Record<string, unknown> {
  const { geometry, ...plotNoGeom } = plot();
  const {
    source_id: _s,
    nuts_code: _n,
    reference_unit_type: _r,
    validity_year: _v,
    ...v1Plot
  } = plotNoGeom;
  return {
    type: "FeatureCollection",
    agrogea: {
      format: COMPANY_TRANSFER_FORMAT,
      version: 1,
      exportedAt: EXPORTED_AT,
      company: company(),
      crops: [],
      unassigned: { treatments: [], soilSamples: [], harvests: [] },
    },
    features: [
      {
        type: "Feature",
        geometry,
        properties: {
          kind: "plot",
          plot: v1Plot,
          campaigns: [],
          treatments: [],
          soilSamples: [],
          harvests: [],
        },
      },
    ],
  };
}

describe("scambio v2 / versione dichiarata", () => {
  it("l'export porta schemaVersion alla radice del documento", () => {
    const doc = serializeCompanySnapshot(snapshot(), { exportedAt: EXPORTED_AT });
    // Radice e non dentro `agrogea`: è una proprietà del FILE, e chi legge deve
    // poter decidere se sa leggerlo prima di interpretarne il contenuto.
    assert.equal(doc.schemaVersion, TRANSFER_SCHEMA_VERSION);
    assert.equal(doc.agrogea.version, COMPANY_TRANSFER_VERSION);
  });

  it("riconosce la versione di un file v1 che non la dichiarava", () => {
    assert.equal(documentSchemaVersion(v1Document()), "1.0.0");
    // Senza nemmeno `agrogea.version`: la v1 è l'unica cosa che poteva essere.
    assert.equal(documentSchemaVersion({ type: "FeatureCollection" }), "1.0.0");
  });

  it("legge la propria versione", () => {
    const doc = serializeCompanySnapshot(snapshot(), { exportedAt: EXPORTED_AT });
    assert.equal(documentSchemaVersion(doc), TRANSFER_SCHEMA_VERSION);
  });

  it("rifiuta un file che viene da una versione futura", () => {
    // Interpretare a metà un formato che non si conosce è peggio che fermarsi.
    assert.throws(
      () => parseCompanyTransfer({ ...v1Document(), schemaVersion: "99.0.0" }),
      (error: unknown) =>
        error instanceof CompanyTransferError &&
        /più recente|Aggiorna/.test(error.message),
    );
  });
});

describe("scambio v2 / migrazione dai file v1", () => {
  it("importa un file v1 senza perdere dati", () => {
    const parsed = parseCompanyTransfer(v1Document());
    assert.equal(parsed.company.business_name, "Azienda di prova");
    assert.equal(parsed.plots.length, 1);
    assert.equal(parsed.plots[0].plot.user_plot_name, "Campo dei Mais");
    assert.deepEqual(parsed.plots[0].plot.geometry, GEOMETRY);
  });

  it("completa gli appezzamenti v1 con una provenienza vuota", () => {
    // Nei file v1 quei campi non esistevano: null è esattamente ciò che erano,
    // cioè appezzamenti senza provenienza pubblica.
    const parsed = parseCompanyTransfer(v1Document());
    const migrated = parsed.plots[0].plot;
    assert.equal(migrated.source_id, null);
    assert.equal(migrated.nuts_code, null);
    assert.equal(migrated.reference_unit_type, null);
    assert.equal(migrated.validity_year, null);
  });

  it("non tocca un documento già alla versione corrente", () => {
    const doc = serializeCompanySnapshot(snapshot(), { exportedAt: EXPORTED_AT });
    assert.equal(migrateTransferDocument(doc), doc);
  });

  it("lascia intatto ciò che il file già dichiarava", () => {
    // Il riempimento non deve mai sovrascrivere un valore presente.
    const doc = v1Document();
    const features = doc.features as { properties: { plot: Record<string, unknown> } }[];
    features[0].properties.plot.source_id = "GIA-PRESENTE";
    const parsed = parseCompanyTransfer(doc);
    assert.equal(parsed.plots[0].plot.source_id, "GIA-PRESENTE");
  });

  it("gli errori di forma restano errori di formato, non eccezioni grezze", () => {
    for (const bogus of [null, undefined, 42, "testo", []]) {
      assert.throws(() => parseCompanyTransfer(bogus), CompanyTransferError);
    }
  });
});

describe("scambio v2 / round-trip", () => {
  it("export → import → export produce un documento identico", () => {
    const first = serializeCompanySnapshot(snapshot(), { exportedAt: EXPORTED_AT });
    const reparsed = parseCompanyTransfer(JSON.parse(JSON.stringify(first)));
    const second = serializeCompanySnapshot(reparsed, { exportedAt: EXPORTED_AT });
    assert.deepEqual(second, first);
    // E anche byte per byte, che è ciò che vede davvero l'utente nel file.
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });

  it("il giro conserva la provenienza della particella", () => {
    const first = serializeCompanySnapshot(snapshot(), { exportedAt: EXPORTED_AT });
    const reparsed = parseCompanyTransfer(JSON.parse(JSON.stringify(first)));
    const restored = reparsed.plots[0].plot;
    assert.equal(restored.source_id, "BRP.2025.45247317");
    assert.equal(restored.nuts_code, "NL");
    assert.equal(restored.reference_unit_type, "agricultural_parcel");
    // La licenza sopravvive all'export: l'obbligo di attribuzione viaggia col
    // dato anche quando il file passa di mano.
    const provenance = restored.metadata.parcel as { license: { id: string } };
    assert.equal(provenance.license.id, "CC0-1.0");
  });

  it("un file v1 migrato riesporta stabilmente", () => {
    const parsed = parseCompanyTransfer(v1Document());
    const exported = serializeCompanySnapshot(parsed, { exportedAt: EXPORTED_AT });
    const again = serializeCompanySnapshot(
      parseCompanyTransfer(JSON.parse(JSON.stringify(exported))),
      { exportedAt: EXPORTED_AT },
    );
    assert.deepEqual(again, exported);
  });
});

describe("scambio v2 / import idempotente e non distruttivo", () => {
  it("un appezzamento mai visto è da creare", () => {
    const plan = planPlotImport([bundle()], []);
    assert.equal(plan.toCreate.length, 1);
    assert.equal(plan.conflicts.length, 0);
  });

  it("reimportare lo stesso backup non è un conflitto", () => {
    // Stesso id = stesso record: riscriverlo è idempotente e non perde nulla.
    const plan = planPlotImport([bundle()], [plot()]);
    assert.equal(plan.toUpdate.length, 1);
    assert.equal(plan.toCreate.length, 0);
    assert.equal(plan.conflicts.length, 0);
  });

  it("la stessa particella sotto un altro record è un conflitto", () => {
    // Sovrascrivere butterebbe via il quaderno di campagna di un appezzamento
    // che l'utente ha già lavorato: si chiede, non si decide.
    const incoming = bundle({ id: "plot-altro" });
    const plan = planPlotImport([incoming], [plot()]);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].existing.id, "plot-1");
    assert.equal(plan.toCreate.length, 0);
  });

  it("una particella di un altro nodo NUTS non è un conflitto", () => {
    const incoming = bundle({ id: "plot-altro", nuts_code: "DE1" });
    const plan = planPlotImport([incoming], [plot()]);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.toCreate.length, 1);
  });

  it("un appezzamento cancellato non blocca il reimport", () => {
    const incoming = bundle({ id: "plot-altro" });
    const plan = planPlotImport([incoming], [plot({ deleted_at: EXPORTED_AT })]);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.toCreate.length, 1);
  });

  it("i disegni a mano non entrano mai in conflitto fra loro", () => {
    // Nessuna provenienza, nessuna chiave: due disegni sullo stesso campo
    // restano due appezzamenti distinti.
    const manuale = bundle({
      id: "plot-manuale",
      source_id: null,
      nuts_code: null,
      reference_unit_type: "manual",
    });
    const plan = planPlotImport(
      [manuale],
      [plot({ id: "altro", source_id: null, nuts_code: null })],
    );
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.toCreate.length, 1);
  });
});
