import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeatureCollection } from "geojson";
import {
  esSigpacAdapter,
  euBaseAdapter,
  frTelepacAdapter,
  getGisAdapter,
  itSianAdapter,
  mapFeatureCollectionWith,
} from "../apps/agro-field-suite/src/services/gis/AbstractGisParser";

describe("AbstractGisParser / selezione adapter per country_code", () => {
  it("mappa ogni paese al suo adapter, con fallback EU", () => {
    assert.equal(getGisAdapter("IT"), itSianAdapter);
    assert.equal(getGisAdapter("ES"), esSigpacAdapter);
    assert.equal(getGisAdapter("FR"), frTelepacAdapter);
    assert.equal(getGisAdapter("EU"), euBaseAdapter);
  });
});

describe("Adapter IT (SIAN/AGEA)", () => {
  it("decodifica Isola/Appezzamento e superficie dichiarata (formato IT)", () => {
    const p = itSianAdapter.mapFeature(
      { ID_ISOLA: "12", ID_APPEZZ: "3", COD_PROD: "060", SUP_HA: "1,5000" },
      null,
      null,
    );
    assert.equal(p.reference_parcel_external_id, "12");
    assert.equal(p.agricultural_parcel_external_id, "3");
    assert.equal(p.crop_external_code, "060");
    assert.equal(p.superficie_ha, 1.5);
  });
});

describe("Adapter ES (SIGPAC/SIEX)", () => {
  it("compone il reference da Provincia:Municipio:Poligono:Parcela e usa Recinto come agricultural", () => {
    const p = esSigpacAdapter.mapFeature(
      {
        PROVINCIA: "41",
        MUNICIPIO: "091",
        POLIGONO: "7",
        PARCELA: "23",
        RECINTO: "1",
        USO_SIGPAC: "TA",
        DN_SURFACE: "25000", // m² -> 2.5 ha
      },
      null,
      null,
    );
    assert.equal(p.reference_parcel_external_id, "41:091:7:23");
    assert.equal(p.agricultural_parcel_external_id, "1");
    assert.equal(p.crop_external_code, "TA");
    assert.equal(p.superficie_ha, 2.5);
  });
});

describe("Adapter FR (TelePAC/RPG)", () => {
  it("decodifica Îlot/Parcelle/Code culture e superficie in ettari", () => {
    const p = frTelepacAdapter.mapFeature(
      { NUM_ILOT: "5", NUM_PARCEL: "2", CODE_CULTU: "BTH", SURF_PARC: "3.20" },
      null,
      null,
    );
    assert.equal(p.reference_parcel_external_id, "5");
    assert.equal(p.agricultural_parcel_external_id, "2");
    assert.equal(p.crop_external_code, "BTH");
    assert.equal(p.superficie_ha, 3.2);
  });
});

describe("Adapter EU (base internazionale)", () => {
  it("legge gli identificativi LPIS già EU-agnostici", () => {
    const p = euBaseAdapter.mapFeature(
      {
        reference_parcel_external_id: "RP-1",
        agricultural_parcel_external_id: "AP-9",
        crop_external_code: "WHEAT",
        area_ha: "4",
      },
      null,
      null,
    );
    assert.equal(p.reference_parcel_external_id, "RP-1");
    assert.equal(p.agricultural_parcel_external_id, "AP-9");
    assert.equal(p.crop_external_code, "WHEAT");
    assert.equal(p.superficie_ha, 4);
  });

  it("ricade sull'area geodetica se la superficie non è negli attributi", () => {
    const p = euBaseAdapter.mapFeature({ crop_code: "X" }, null, 2.1234);
    assert.equal(p.superficie_ha, 2.1234);
  });
});

describe("mapFeatureCollectionWith", () => {
  it("mappa un'intera FeatureCollection con l'adapter dato", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { NUM_ILOT: "1", CODE_CULTU: "MIS", SURF_PARC: "1" },
        },
        {
          type: "Feature",
          geometry: null,
          properties: { NUM_ILOT: "2", CODE_CULTU: "BTH", SURF_PARC: "2" },
        },
      ],
    };
    const out = mapFeatureCollectionWith(fc, frTelepacAdapter);
    assert.equal(out.length, 2);
    assert.equal(out[0].reference_parcel_external_id, "1");
    assert.equal(out[1].crop_external_code, "BTH");
  });
});
