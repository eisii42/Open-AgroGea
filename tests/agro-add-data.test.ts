import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estensioneFile,
  formatoDaNomeFile,
  isGeoJson,
  toFeatureCollection,
} from "../apps/agro-field-suite/src/modules/add-data/add-data";

describe("add-data · riconoscimento formato", () => {
  it("estrae l'estensione minuscola", () => {
    assert.equal(estensioneFile("Mappa.GeoJSON"), "geojson");
    assert.equal(estensioneFile("dati.tar.gz"), "gz");
    assert.equal(estensioneFile("senza-estensione"), "");
  });

  it("mappa le estensioni sui formati tracciati", () => {
    assert.equal(formatoDaNomeFile("zvn.geojson"), "geojson");
    assert.equal(formatoDaNomeFile("zone.json"), "geojson");
    assert.equal(formatoDaNomeFile("rese.csv"), "csv");
    assert.equal(formatoDaNomeFile("catasto.zip"), "shapefile");
    assert.equal(formatoDaNomeFile("particelle.shp"), "shapefile");
    assert.equal(formatoDaNomeFile("task.isoxml"), "isoxml");
    assert.equal(formatoDaNomeFile("task.xml"), "isoxml");
  });

  it("rifiuta i formati non riconosciuti", () => {
    assert.equal(formatoDaNomeFile("immagine.png"), null);
    assert.equal(formatoDaNomeFile("nessuna-estensione"), null);
  });

  it("isGeoJson è vero solo per geojson/json", () => {
    assert.equal(isGeoJson("a.geojson"), true);
    assert.equal(isGeoJson("a.json"), true);
    assert.equal(isGeoJson("a.zip"), false);
    assert.equal(isGeoJson("a.csv"), false);
  });
});

describe("add-data · normalizzazione FeatureCollection", () => {
  const point = {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [11, 43] },
    properties: {},
  };

  it("passa una FeatureCollection invariata", () => {
    const fc = { type: "FeatureCollection", features: [point] };
    assert.equal(toFeatureCollection(fc), fc);
  });

  it("avvolge una singola Feature in una FeatureCollection", () => {
    const out = toFeatureCollection(point);
    assert.equal(out?.type, "FeatureCollection");
    assert.equal(out?.features.length, 1);
  });

  it("ritorna null per input non GeoJSON", () => {
    assert.equal(toFeatureCollection({ foo: "bar" }), null);
    assert.equal(toFeatureCollection(null), null);
    assert.equal(toFeatureCollection("stringa"), null);
  });
});
