import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Feature, Polygon } from "geojson";
import {
  areaHectares,
  classifyGeometry,
  geometryHasCoordinates,
  geometryFamily,
  normalizeGeometry,
  pickEditedFeature,
  sameGeometryFamily,
} from "../packages/agro-core/src/geo/area";

/**
 * Copre la stabilità di tipo dell'editing geometrico dell'agro-field-suite:
 *   * `geometryFamily`/`sameGeometryFamily` collassano single/multi e separano
 *     poligoni, linee e punti;
 *   * `pickEditedFeature` sceglie, tra gli sketch del GeoEditor, la feature
 *     della famiglia in modifica — ignorando le maniglie-vertice (Point) che il
 *     GeoEditor aggiunge mentre si modifica una linea/poligono. È la regressione
 *     alla radice del bug: una linea che durante l'editing collassava in un
 *     poligono fantasma (con relativo crash + corruzione del sync).
 */

function feat(geometry: Feature["geometry"]): Feature {
  return { type: "Feature", properties: {}, geometry };
}

const line = feat({
  type: "LineString",
  coordinates: [
    [0, 0],
    [1, 1],
    [2, 0],
  ],
});
const vertexHandle = feat({ type: "Point", coordinates: [1, 1] });
const polygon = feat({
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ],
  ],
});

describe("geometryFamily / sameGeometryFamily", () => {
  it("collassa single e multi nella stessa famiglia", () => {
    assert.equal(geometryFamily("Polygon"), "polygon");
    assert.equal(geometryFamily("MultiPolygon"), "polygon");
    assert.equal(geometryFamily("LineString"), "line");
    assert.equal(geometryFamily("MultiLineString"), "line");
    assert.equal(geometryFamily("Point"), "point");
    assert.equal(geometryFamily("MultiPoint"), "point");
  });

  it("tipi non spaziali → null", () => {
    assert.equal(geometryFamily("GeometryCollection"), null);
  });

  it("classifyGeometry delega a geometryFamily", () => {
    assert.equal(classifyGeometry(line.geometry), "line");
    assert.equal(classifyGeometry(polygon.geometry), "polygon");
    assert.equal(classifyGeometry(vertexHandle.geometry), "point");
  });

  it("sameGeometryFamily distingue le famiglie e respinge il drift", () => {
    assert.equal(sameGeometryFamily("LineString", "MultiLineString"), true);
    assert.equal(sameGeometryFamily("LineString", "Polygon"), false);
    assert.equal(sameGeometryFamily("Point", "LineString"), false);
    // Un lato non spaziale non combacia mai (niente bozza da una collection).
    assert.equal(sameGeometryFamily("GeometryCollection", "GeometryCollection"), false);
  });
});

describe("pickEditedFeature", () => {
  it("ignora la maniglia-vertice Point quando si modifica una linea", () => {
    // Ordine deliberato: la maniglia Point è in testa, come capita col GeoEditor.
    const picked = pickEditedFeature([vertexHandle, line], "LineString");
    assert.equal(picked?.geometry.type, "LineString");
  });

  it("non promuove un poligono fantasma a bozza di una linea", () => {
    // Se il GeoEditor avesse erroneamente chiuso la linea in un poligono, la
    // feature poligonale NON deve essere scelta come bozza della linea.
    const picked = pickEditedFeature([polygon], "LineString");
    // Nessun match di famiglia → fallback alla prima feature; la guardia in
    // updateGeometryDraft scarta poi comunque il drift di tipo.
    assert.equal(picked?.geometry.type, "Polygon");
    assert.equal(
      sameGeometryFamily(picked!.geometry.type, "LineString"),
      false,
    );
  });

  it("sceglie il poligono in modifica ignorando le maniglie", () => {
    const picked = pickEditedFeature([vertexHandle, polygon], "Polygon");
    assert.equal(picked?.geometry.type, "Polygon");
  });

  it("collezione vuota → undefined", () => {
    assert.equal(pickEditedFeature([], "Point"), undefined);
  });
});

describe("normalizeGeometry + areaHectares", () => {
  // Anello quadrato valido (~1.2 ha), chiuso e annidato correttamente.
  const ringChiuso: number[][] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
    [0, 0],
  ];

  it("riavvolge un Polygon con coordinate piatte (depth da LineString)", () => {
    // Il caso del bug: type Polygon ma coordinate di profondità 2 (anello nudo).
    const malformato = {
      type: "Polygon",
      coordinates: ringChiuso,
    } as unknown as Polygon;
    const fixed = normalizeGeometry(malformato);
    assert.equal(fixed.type, "Polygon");
    // Ora la profondità è corretta: coordinates[0] è l'anello, [0][0] la posizione.
    assert.ok(Array.isArray(fixed.coordinates[0]));
    assert.ok(Array.isArray(fixed.coordinates[0][0]));
    assert.equal(typeof fixed.coordinates[0][0][0], "number");
    // E l'area torna positiva e plausibile (~1.24 ha), non negativa/garbage.
    assert.ok(areaHectares(fixed) > 0);
  });

  it("lascia invariato un Polygon già ben formato e ne chiude l'anello", () => {
    const valido: Polygon = { type: "Polygon", coordinates: [ringChiuso] };
    const fixed = normalizeGeometry(valido);
    assert.deepEqual(fixed.coordinates, [ringChiuso]);
  });

  it("chiude un anello non chiuso", () => {
    const aperto: Polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]]],
    };
    const fixed = normalizeGeometry(aperto);
    const ring = fixed.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  });

  it("riavvolge un MultiPolygon con depth da singolo poligono", () => {
    const malformato = {
      type: "MultiPolygon",
      coordinates: [ringChiuso], // depth 3 invece di 4
    } as unknown as import("geojson").MultiPolygon;
    const fixed = normalizeGeometry(malformato);
    assert.equal(fixed.type, "MultiPolygon");
    assert.ok(areaHectares(fixed) > 0);
  });

  it("tronca le coordinate 3D a 2D (rimuove la Z)", () => {
    // Caso reale: Geoman su terreno/globo emette [lng,lat,z]; la colonna PostGIS
    // è 2D → «Geometry has Z dimensions but column does not». Va troncato.
    const z3d = {
      type: "Polygon",
      coordinates: [[[0, 0, 5], [0.001, 0, 5], [0.001, 0.001, 5], [0, 0, 5]]],
    } as unknown as Polygon;
    const fixed = normalizeGeometry(z3d);
    for (const ring of fixed.coordinates) {
      for (const pos of ring) assert.equal(pos.length, 2);
    }
    assert.ok(areaHectares(fixed) > 0);
  });

  it("tronca la Z anche su Point e LineString", () => {
    const pt = normalizeGeometry({
      type: "Point",
      coordinates: [9, 45, 120],
    } as unknown as import("geojson").Point);
    assert.deepEqual(pt.coordinates, [9, 45]);
    const ln = normalizeGeometry({
      type: "LineString",
      coordinates: [[0, 0, 1], [1, 1, 2]],
    } as unknown as import("geojson").LineString);
    assert.deepEqual(ln.coordinates, [[0, 0], [1, 1]]);
  });

  it("lancia su poligono irrecuperabile (anello degenere)", () => {
    const degenere = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 1]]],
    } as unknown as Polygon;
    assert.throws(() => normalizeGeometry(degenere));
  });

  it("areaHectares è sempre ≥ 0 anche su anello a verso orario", () => {
    const cw: Polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]]],
    };
    assert.ok(areaHectares(cw) > 0);
  });

  it("areaHectares NON lancia su geometria con coordinate undefined → 0", () => {
    // Caso reale del crash: Geoman emette {type:"Polygon"} senza coordinates
    // durante il drag. Prima lanciava TypeError → schermata bianca.
    const incompleto = { type: "Polygon" } as unknown as Polygon;
    assert.equal(areaHectares(incompleto), 0);
    const vuoto = { type: "Polygon", coordinates: [] } as unknown as Polygon;
    assert.equal(areaHectares(vuoto), 0);
  });
});

describe("geometryHasCoordinates", () => {
  it("false su coordinate assenti o vuote, true su geometria completa", () => {
    assert.equal(
      geometryHasCoordinates({ type: "Polygon" } as never),
      false,
    );
    assert.equal(
      geometryHasCoordinates({ type: "Polygon", coordinates: [] } as never),
      false,
    );
    assert.equal(
      geometryHasCoordinates({ type: "Point", coordinates: [9, 45] }),
      true,
    );
    assert.equal(
      geometryHasCoordinates({
        type: "Polygon",
        coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
      }),
      true,
    );
  });
});
