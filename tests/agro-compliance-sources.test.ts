import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_EXG_THRESHOLD,
  excessGreen,
  resolvesFeature,
  vegetatedShare,
} from "@agrogea/tools";
import {
  hornSlopeDegrees,
  slopeStatistics,
} from "../apps/agro-field-suite/src/modules/compliance/terrain-dem";
import {
  buildOverpassQuery,
  overpassToGeoJson,
} from "../apps/agro-field-suite/src/modules/compliance/osm-water-network";
import { resolutionMeters } from "../apps/agro-field-suite/src/modules/compliance/orthophoto-loader";

/**
 * Le fonti che il modulo Normativa si procura da sé: pendenza dal DEM
 * (BCAA 5), reticolo idrografico da OpenStreetMap (BCAA 4) e ortofoto caricata
 * dall'utente (BCAA 8).
 *
 * Sono le tre che hanno tolto altrettante schede dallo stato di "non decidibile
 * per mancanza di dati", e ognuna ha un punto in cui sbagliare silenziosamente
 * sarebbe facile: un'unità di misura, una geometria troncata, una risoluzione
 * in gradi scambiata per metri.
 */

describe("fonti / pendenza dal DEM (BCAA 5)", () => {
  /** Griglia 5×5 con un piano inclinato costante lungo x. */
  function ramp(dzPerCell: number): Float32Array {
    const values = new Float32Array(25);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) values[row * 5 + col] = col * dzPerCell;
    }
    return values;
  }

  it("un piano a 45 gradi dà 45 gradi", () => {
    // Dislivello uguale al passo della cella: la pendenza è esattamente 45°.
    const stats = slopeStatistics(
      hornSlopeDegrees({
        values: ramp(30),
        width: 5,
        height: 5,
        cellX: 30,
        cellY: 30,
      }),
    );
    assert.ok(stats);
    assert.ok(Math.abs(stats.mean - 45) < 0.001, `atteso 45, ottenuto ${stats.mean}`);
  });

  it("un terreno piatto non inventa pendenza", () => {
    const stats = slopeStatistics(
      hornSlopeDegrees({
        values: new Float32Array(25),
        width: 5,
        height: 5,
        cellX: 30,
        cellY: 30,
      }),
    );
    assert.equal(stats?.mean, 0);
    assert.equal(stats?.max, 0);
  });

  it("il passo della cella conta: raddoppiarlo dimezza la tangente", () => {
    // È l'errore che si fa scambiando gradi per metri, e produrrebbe pendenze
    // di ordini di grandezza sbagliati.
    const fine = slopeStatistics(
      hornSlopeDegrees({ values: ramp(30), width: 5, height: 5, cellX: 30, cellY: 30 }),
    );
    const coarse = slopeStatistics(
      hornSlopeDegrees({ values: ramp(30), width: 5, height: 5, cellX: 60, cellY: 60 }),
    );
    assert.ok(fine && coarse);
    assert.ok(coarse.mean < fine.mean);
    assert.ok(Math.abs(Math.tan((coarse.mean * Math.PI) / 180) - 0.5) < 0.001);
  });

  it("le celle di bordo restano NaN invece di fingere un valore", () => {
    // Horn consuma un anello: su una finestra 3×3 solo la cella centrale ha
    // tutti e otto i vicini.
    const slopes = hornSlopeDegrees({
      values: ramp(30).slice(0, 9),
      width: 3,
      height: 3,
      cellX: 30,
      cellY: 30,
    });
    assert.equal(slopes.filter((v) => Number.isFinite(v)).length, 1);
  });

  it("senza celle valide non produce statistiche", () => {
    assert.equal(
      slopeStatistics(
        hornSlopeDegrees({
          values: new Float32Array(4),
          width: 2,
          height: 2,
          cellX: 30,
          cellY: 30,
        }),
      ),
      null,
    );
  });
});

describe("fonti / reticolo idrografico da OpenStreetMap (BCAA 4)", () => {
  it("la query cerca OLTRE il bbox dell'appezzamento", () => {
    // Un corso d'acqua appena fuori dal poligono è esattamente quello da cui
    // misurare la fascia tampone: cercare solo dentro non troverebbe nulla.
    const query = buildOverpassQuery([11.2, 43.5, 11.21, 43.51], { padDeg: 0.005 });
    assert.match(query, /43\.495,11\.195,43\.515,11\.215/);
    assert.match(query, /waterway/);
    assert.match(query, /out geom;/);
  });

  it("i tipi di corso d'acqua sono un parametro, non una costante", () => {
    // Quali fattispecie siano "corso d'acqua" lo decide la norma regionale.
    const query = buildOverpassQuery([11, 43, 11.01, 43.01], {
      waterwayTypes: ["river", "canal"],
    });
    assert.match(query, /\^\(river\|canal\)\$/);
    assert.ok(!query.includes("ditch"));
  });

  it("converte le way OSM in LineString con la provenienza", () => {
    const fc = overpassToGeoJson([
      {
        type: "way",
        id: 42,
        tags: { waterway: "stream", name: "Borro Cepparello" },
        geometry: [
          { lat: 43.5, lon: 11.2 },
          { lat: 43.51, lon: 11.21 },
        ],
      },
    ]);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].geometry.type, "LineString");
    // lon/lat, non lat/lon: invertirli è l'errore classico del GeoJSON.
    assert.deepEqual(
      (fc.features[0].geometry as { coordinates: number[][] }).coordinates[0],
      [11.2, 43.5],
    );
    // L'attribuzione ODbL viaggia con il dato: è una condizione della licenza.
    assert.equal(fc.features[0].properties?.["source"], "OpenStreetMap");
    assert.equal(fc.features[0].properties?.["license"], "ODbL 1.0");
  });

  it("scarta le way troncate dal bbox, che non sono linee", () => {
    const fc = overpassToGeoJson([
      { type: "way", id: 1, geometry: [{ lat: 43.5, lon: 11.2 }] },
      { type: "way", id: 2 },
    ]);
    assert.equal(fc.features.length, 0);
  });
});

describe("fonti / ortofoto (BCAA 8)", () => {
  it("Excess Green separa il verde dal suolo", () => {
    // Vegetazione: verde dominante. Suolo nudo: rosso dominante.
    assert.ok(excessGreen(50, 150, 50) > DEFAULT_EXG_THRESHOLD);
    assert.ok(excessGreen(160, 120, 90) < DEFAULT_EXG_THRESHOLD);
  });

  it("è indifferente alla scala e all'illuminazione", () => {
    // La normalizzazione cromatica elimina l'intensità: lo stesso colore in
    // ombra e in pieno sole dà lo stesso indice.
    assert.ok(Math.abs(excessGreen(50, 150, 50) - excessGreen(25, 75, 25)) < 1e-9);
  });

  it("un pixel nero non ha colore, e lo dice", () => {
    assert.ok(Number.isNaN(excessGreen(0, 0, 0)));
  });

  it("la quota vegetata conta solo i pixel della maschera", () => {
    const red = [50, 160, 50, 160];
    const green = [150, 120, 150, 120];
    const blue = [50, 90, 50, 90];
    assert.equal(vegetatedShare(red, green, blue), 0.5);
    assert.equal(vegetatedShare(red, green, blue, { mask: [1, 1, 0, 0] }), 0.5);
    assert.equal(vegetatedShare(red, green, blue, { mask: [1, 0, 1, 0] }), 1);
  });

  it("senza pixel validi non restituisce una quota", () => {
    // Zero su zero non è zero: è "non si sa".
    assert.equal(vegetatedShare([], [], []), null);
    assert.equal(vegetatedShare([0], [0], [0]), null);
  });

  it("servono tre pixel sull'elemento per considerarlo risolto", () => {
    // Una siepe di 2 m chiede almeno ~67 cm di risoluzione.
    assert.equal(resolvesFeature(0.2, 2), true);
    assert.equal(resolvesFeature(0.66, 2), true);
    assert.equal(resolvesFeature(1, 2), false);
    assert.equal(resolvesFeature(10, 2), false);
    assert.equal(resolvesFeature(0, 2), false);
  });

  it("la risoluzione in GRADI non si scambia per metri", () => {
    // Un GeoTIFF geografico dichiara 0.000002°: letto come metri sembrerebbe
    // due micron, e l'ortofoto risulterebbe un milione di volte più fine.
    const inDegrees = resolutionMeters(0.000002, 43.5, true);
    assert.ok(inDegrees > 0.1 && inDegrees < 0.2, `ottenuto ${inDegrees}`);
  });

  it("una risoluzione PROIETTATA piccola resta quella che è", () => {
    // È il caso che conta: un'ortofoto a 20 cm in UTM dichiara 0.2, che è
    // piccolo quanto un valore in gradi. Dedurre l'unità dal valore la
    // trasformerebbe in 16 km di cella, e la BCAA 8 direbbe il contrario del
    // vero. L'unità la decide il sistema di riferimento, non la grandezza.
    assert.equal(resolutionMeters(0.2, 43.5, false), 0.2);
    assert.equal(resolutionMeters(-10, 43.5, false), 10);
  });
});
