import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import {
  buildLegenda,
  buildPrintSvg,
  spezza,
} from "../apps/agro-field-suite/src/modules/print/print-layout";

function layer(over: Partial<GeoLibreLayer>): GeoLibreLayer {
  return {
    id: "l",
    name: "Layer",
    type: "geojson",
    source: { type: "geojson" },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {},
    geojson: { type: "FeatureCollection", features: [] },
    sourcePath: "agrogea://l",
    ...over,
  } as GeoLibreLayer;
}

describe("buildLegenda", () => {
  it("keeps visible data layers and reads their colour", () => {
    const legenda = buildLegenda([
      layer({ id: "a", name: "Appezzamenti", style: { ...DEFAULT_LAYER_STYLE, fillColor: "#11aa22" } }),
      layer({ id: "hidden", name: "Nascosto", visible: false }),
      layer({ id: "sk", name: "Sketch", sourcePath: "geoeditor://sketches" }),
      layer({ id: "bm", name: "Basemap", metadata: { basemap: true } }),
    ]);
    assert.deepEqual(
      legenda.map((v) => v.id),
      ["a"],
    );
    assert.equal(legenda[0].colore, "#11aa22");
  });
});

describe("buildPrintSvg", () => {
  const svg = buildPrintSvg({
    title: "Vigna Nuova",
    note: "Domanda PSR 2026",
    legenda: [
      { id: "a", name: "Appezzamenti", colore: "#11aa22" },
      { id: "b", name: "POI", colore: "#1f6feb" },
    ],
    mostraScala: true,
    scalaTesto: "200 m",
    mostraNord: true,
    mostraLogo: true,
    mappaDataUrl: "data:image/png;base64,AAAA",
  });

  it("is an SVG carrying title, legend, scale, north, logo and the map image", () => {
    assert.match(svg, /^<svg /);
    assert.match(svg, /Vigna Nuova/);
    assert.match(svg, /Appezzamenti/);
    assert.match(svg, /POI/);
    assert.match(svg, /Scala 200 m/);
    assert.match(svg, />N</);
    assert.match(svg, /AgroGea/);
    assert.match(svg, /href="data:image\/png;base64,AAAA"/);
    assert.match(svg, /Domanda PSR 2026/);
  });

  it("shows a placeholder when no map image is provided", () => {
    const out = buildPrintSvg({
      title: "T",
      legenda: [],
      mostraScala: false,
      mostraNord: false,
      mostraLogo: false,
    });
    assert.match(out, /Anteprima mappa non available/);
    assert.match(out, /Nessun layer visibile/);
  });

  it("escapes user text to keep the SVG well-formed", () => {
    const out = buildPrintSvg({
      title: 'Campo <b> & "x"',
      legenda: [],
      mostraScala: false,
      mostraNord: false,
      mostraLogo: false,
    });
    assert.match(out, /Campo &lt;b&gt; &amp; &quot;x&quot;/);
  });
});

describe("spezza", () => {
  it("wraps text without splitting words", () => {
    assert.deepEqual(spezza("uno due tre quattro", 8), [
      "uno due",
      "tre",
      "quattro",
    ]);
  });
});
