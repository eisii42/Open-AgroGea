import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARCEL_SCHEMA_VERSION,
  REFERENCE_UNIT_TYPES,
  isManualParcel,
  isReferenceUnitType,
  isSourcedParcel,
  parcelGeometry,
  type ManualParcel,
  type Parcel,
  type SourcedParcel,
} from "@agrogea/parcel";
import type { Polygon } from "geojson";

/**
 * Contratto `Parcel` (@agrogea/parcel): guardie, discriminazione dell'unione e
 * precedenza della geometria rettificata. Il pacchetto è di soli tipi e funzioni
 * pure — nessun DB, nessuna rete.
 */

/** Quadratino ~0.02° attorno a [lon, lat]. */
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

const SOURCE_GEOMETRY = squareAt(4.9, 52.37);
const EDITED_GEOMETRY = squareAt(4.91, 52.38);

/** Particella acquisita dal pilota olandese (BRP Gewaspercelen, PDOK). */
function sourcedParcel(overrides: Partial<SourcedParcel> = {}): SourcedParcel {
  return {
    id: "6f1b0d24-0a3f-4a9c-9f1e-2f0b7c5d8e10",
    geometry: SOURCE_GEOMETRY,
    editedGeometry: null,
    referenceUnitType: "agricultural_parcel",
    country: "NL",
    nutsCode: "NL",
    eligibleArea: null,
    declaredArea: 2.4312,
    validityYear: 2025,
    nationalCropCode: "265",
    hcatCode: null,
    farmFields: [],
    retrievedAt: "2026-09-01T08:00:00.000Z",
    sourceId: "NL.BRP.2025.123456",
    originalGeometry: SOURCE_GEOMETRY,
    originalCrs: "EPSG:28992",
    sourceName: "BRP Gewaspercelen (INSPIRE geharmoniseerd)",
    sourceUrl: "https://service.pdok.nl/rvo/gewaspercelen-geharmoniseerd/wfs/v1_0",
    license: { id: "CC0-1.0", attribution: "RVO / PDOK" },
    ...overrides,
  };
}

/** Particella digitalizzata a mano: nessuna provenienza esterna. */
function manualParcel(overrides: Partial<ManualParcel> = {}): ManualParcel {
  return {
    id: "9c2e5a17-4b8d-4f30-8a61-77d0c4e9b512",
    geometry: SOURCE_GEOMETRY,
    editedGeometry: null,
    referenceUnitType: "manual",
    country: "IT",
    nutsCode: "ITI1",
    eligibleArea: null,
    declaredArea: null,
    validityYear: null,
    nationalCropCode: null,
    hcatCode: null,
    farmFields: [],
    retrievedAt: "2026-09-01T08:00:00.000Z",
    sourceId: null,
    originalGeometry: null,
    originalCrs: null,
    sourceName: null,
    sourceUrl: null,
    license: null,
    ...overrides,
  };
}

describe("parcel / discriminazione dell'unione", () => {
  it("riconosce una particella acquisita da una fonte", () => {
    const parcel: Parcel = sourcedParcel();
    assert.equal(isSourcedParcel(parcel), true);
    assert.equal(isManualParcel(parcel), false);
  });

  it("riconosce una particella disegnata a mano", () => {
    const parcel: Parcel = manualParcel();
    assert.equal(isManualParcel(parcel), true);
    assert.equal(isSourcedParcel(parcel), false);
  });

  it("la guardia restringe il tipo: la provenienza è leggibile senza cast", () => {
    const parcel: Parcel = sourcedParcel();
    // Il valore del test è nel TIPO: fuori dalla guardia `parcel.license` non
    // sarebbe accessibile senza un cast, e `npm run typecheck` fallirebbe.
    if (isSourcedParcel(parcel)) {
      assert.equal(parcel.license.id, "CC0-1.0");
      assert.equal(parcel.license.attribution, "RVO / PDOK");
      assert.equal(parcel.originalCrs, "EPSG:28992");
      assert.equal(parcel.sourceId, "NL.BRP.2025.123456");
    } else {
      assert.fail("attesa una particella con provenienza");
    }
  });

  it("una particella manuale dichiara l'assenza di provenienza con null espliciti", () => {
    const parcel = manualParcel();
    // Forma uniforme del record: i campi ci sono e valgono null, non mancano.
    // È ciò che tiene stabile il documento di scambio fra i due casi.
    assert.equal(parcel.sourceId, null);
    assert.equal(parcel.license, null);
    assert.equal(parcel.originalCrs, null);
    assert.equal(parcel.originalGeometry, null);
    assert.ok("sourceName" in parcel);
    assert.ok("sourceUrl" in parcel);
  });
});

describe("parcel / geometria efficace", () => {
  it("senza rettifica vince la geometria della fonte", () => {
    assert.deepEqual(parcelGeometry(sourcedParcel()), SOURCE_GEOMETRY);
  });

  it("con rettifica vince quella dell'utente", () => {
    const parcel = sourcedParcel({ editedGeometry: EDITED_GEOMETRY });
    assert.deepEqual(parcelGeometry(parcel), EDITED_GEOMETRY);
  });

  it("la rettifica non cancella mai la geometria della fonte", () => {
    // Tracciabilità: dopo una correzione si deve poter ancora dire che cosa
    // dichiarava la fonte, altrimenti la provenienza è persa.
    const parcel = sourcedParcel({ editedGeometry: EDITED_GEOMETRY });
    assert.deepEqual(parcel.geometry, SOURCE_GEOMETRY);
    assert.deepEqual(parcel.originalGeometry, SOURCE_GEOMETRY);
  });

  it("vale per le particelle manuali come per le altre", () => {
    const parcel = manualParcel({ editedGeometry: EDITED_GEOMETRY });
    assert.deepEqual(parcelGeometry(parcel), EDITED_GEOMETRY);
  });
});

describe("parcel / vocabolario", () => {
  it("REFERENCE_UNIT_TYPES copre i tipi del contratto senza duplicati", () => {
    const types = [...REFERENCE_UNIT_TYPES];
    assert.equal(new Set(types).size, types.length);
    assert.deepEqual(types, [
      "cadastral_parcel",
      "physical_block",
      "farmer_parcel",
      "agricultural_parcel",
      "manual",
    ]);
  });

  it("isReferenceUnitType accetta i tipi noti e respinge il resto", () => {
    for (const type of REFERENCE_UNIT_TYPES) {
      assert.equal(isReferenceUnitType(type), true, type);
    }
    for (const bogus of ["parcel", "appezzamento", "", null, undefined, 3, {}]) {
      assert.equal(isReferenceUnitType(bogus), false, String(bogus));
    }
  });

  it("la versione del contratto è un semver", () => {
    assert.match(PARCEL_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
