import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeatureCollection } from "geojson";
import {
  ADD_DATA_ACCEPT,
  formatFromFileName,
} from "../apps/agro-field-suite/src/modules/add-data/add-data";
import {
  combinaLayer,
  geojsonToCsv,
  geojsonToGpx,
  geojsonToKml,
  serializzaVettoriale,
} from "../apps/agro-field-suite/src/services/gis/geo-export";

/**
 * Filiera import/export universale (Modulo 4): riconoscimento dei formati e
 * serializzatori puri verso KML/GPX/CSV + dispatcher.
 */

const PUNTO: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { plot_name: "Pozzo 1", profondita: 30 },
      geometry: { type: "Point", coordinates: [11.25, 43.77] },
    },
  ],
};

const POLIGONO: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { plot_name: "Vigna A", rischio01: 0.8 },
      geometry: {
        type: "Polygon",
        coordinates: [[[11, 43], [11, 44], [12, 44], [12, 43], [11, 43]]],
      },
    },
  ],
};

describe("riconoscimento formati (Add Data)", () => {
  it("riconosce kml e gpx oltre ai formati esistenti", () => {
    assert.equal(formatFromFileName("tracce.kml"), "kml");
    assert.equal(formatFromFileName("percorso.GPX"), "gpx");
    assert.equal(formatFromFileName("campi.geojson"), "geojson");
    assert.equal(formatFromFileName("zone.zip"), "shapefile");
    assert.equal(formatFromFileName("ignoto.xyz"), null);
  });
  it("l'attributo accept include .kml e .gpx", () => {
    assert.ok(ADD_DATA_ACCEPT.includes(".kml"));
    assert.ok(ADD_DATA_ACCEPT.includes(".gpx"));
  });
});

describe("geojsonToKml", () => {
  it("genera Placemark con geometria e attributi", () => {
    const kml = geojsonToKml(PUNTO);
    assert.ok(kml.includes("<kml"));
    assert.ok(kml.includes("<Placemark>"));
    assert.ok(kml.includes("<name>Pozzo 1</name>"));
    assert.ok(kml.includes("11.25,43.77,0"));
    assert.ok(kml.includes('<Data name="profondita">'));
  });
  it("serializza i poligoni con outerBoundaryIs", () => {
    const kml = geojsonToKml(POLIGONO);
    assert.ok(kml.includes("<Polygon>"));
    assert.ok(kml.includes("<outerBoundaryIs>"));
  });
});

describe("geojsonToGpx", () => {
  it("i punti diventano waypoint", () => {
    const gpx = geojsonToGpx(PUNTO);
    assert.ok(gpx.includes("<gpx"));
    assert.ok(gpx.includes('<wpt lat="43.77" lon="11.25">'));
  });
  it("i poligoni diventano tracce (trk/trkseg/trkpt)", () => {
    const gpx = geojsonToGpx(POLIGONO);
    assert.ok(gpx.includes("<trk>"));
    assert.ok(gpx.includes("<trkseg>"));
    assert.ok(gpx.includes('<trkpt lat="43" lon="11"/>'));
  });
});

describe("geojsonToCsv", () => {
  it("esporta gli attributi con intestazione, escapando virgole", () => {
    const csv = geojsonToCsv({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { nome: "A, con virgola", n: 1 },
          geometry: null,
        },
      ],
    });
    const [head, row] = csv.split("\n");
    assert.ok(head.includes("nome"));
    assert.ok(row.includes('"A, con virgola"'));
  });
});

describe("serializzaVettoriale (dispatcher)", () => {
  it("mappa extension/mime per ogni formato", () => {
    assert.equal(serializzaVettoriale(PUNTO, "geojson", "x").filename, "x.geojson");
    assert.equal(serializzaVettoriale(PUNTO, "kml", "x").filename, "x.kml");
    assert.equal(serializzaVettoriale(PUNTO, "gpx", "x").filename, "x.gpx");
    assert.equal(serializzaVettoriale(PUNTO, "csv", "x").filename, "x.csv");
    const shp = serializzaVettoriale(POLIGONO, "shapefile", "x");
    assert.equal(shp.filename, "x_shapefile.zip");
    assert.ok(shp.blobPart instanceof Uint8Array && shp.blobPart.length > 0);
  });
});

describe("combinaLayer", () => {
  it("unisce i layer e marca la provenienza in __layer", () => {
    const fc = combinaLayer([
      { id: "a", name: "Appezzamenti", geojson: POLIGONO },
      { id: "b", name: "POI", geojson: PUNTO },
      { id: "c", geojson: null },
    ]);
    assert.equal(fc.features.length, 2);
    assert.equal(fc.features[0].properties?.__layer, "Appezzamenti");
    assert.equal(fc.features[1].properties?.__layer, "POI");
  });
});
