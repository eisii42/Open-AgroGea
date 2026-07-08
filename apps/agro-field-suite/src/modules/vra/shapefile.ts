/**
 * Encoder Shapefile (ESRI) puro per poligoni: generate `.shp`, `.shx`, `.dbf`
 * (+ `.prj` WGS84) e li impacchetta in un `.zip` via fflate. Serve l'export VRA
 * "legacy" per i terminali che non leggono ISOXML.
 *
 * Nessuna dipendenza pesante (solo fflate, già nel monorepo). Pura e testabile:
 * accetta una FeatureCollection di Polygon/MultiPolygon e ritorna i byte dello zip.
 */
import { zipSync } from "fflate";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

const SHAPE_TYPE_POLYGON = 5;

interface Record {
  /** Anelli del poligono (Polygon → suoi anelli; MultiPolygon → tutti gli anelli). */
  rings: number[][][];
  box: [number, number, number, number];
}

interface CampoDbf {
  /** Chiave originale nelle properties della feature. */
  chiave: string;
  /** Nome del field DBF (ASCII ≤ 10, maiuscolo). */
  name: string;
  tipo: "N" | "C";
  lunghezza: number;
  decimali: number;
}

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

function ringsDaFeature(feature: Feature): number[][][] {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === "Polygon") return (g as Polygon).coordinates;
  if (g.type === "MultiPolygon")
    return (g as MultiPolygon).coordinates.flat();
  return [];
}

function boxDaRings(rings: number[][][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

/** Schema DBF dedotto dalle proprietà: numeri → N(19,6), stringhe → C(64). */
function dedussiSchema(features: Feature[]): CampoDbf[] {
  const tipi = new Map<string, "N" | "C">();
  for (const f of features) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      if (tipi.has(k)) continue;
      tipi.set(k, typeof v === "number" ? "N" : "C");
    }
  }
  return [...tipi].map(([chiave, tipo]) => ({
    chiave,
    // I nomi dei campi DBF sono ≤ 10 caratteri ASCII maiuscoli.
    name: chiave.replace(/[^a-z0-9_]/gi, "_").slice(0, 10).toUpperCase(),
    tipo,
    lunghezza: tipo === "N" ? 19 : 64,
    decimali: tipo === "N" ? 6 : 0,
  }));
}

function writeAscii(dv: DataView, offset: number, testo: string, lunghezza: number): void {
  for (let i = 0; i < lunghezza; i += 1) {
    dv.setUint8(offset + i, i < testo.length ? testo.charCodeAt(i) & 0xff : 0);
  }
}

function buildShpShx(records: Record[]): { shp: Uint8Array; shx: Uint8Array } {
  // Lunghezza contenuto record (in word da 16 bit).
  const contentWords = records.map((r) => {
    const numParts = r.rings.length;
    const numPoints = r.rings.reduce((n, ring) => n + ring.length, 0);
    return (44 + numParts * 4 + numPoints * 16) / 2;
  });

  const shpBytes = 100 + contentWords.reduce((n, w) => n + 8 + w * 2, 0);
  const shp = new ArrayBuffer(shpBytes);
  const sd = new DataView(shp);
  const shx = new ArrayBuffer(100 + records.length * 8);
  const xd = new DataView(shx);

  const overall = boxDaRings(records.flatMap((r) => r.rings));

  // Header comune (shp e shx).
  for (const [dv, totBytes] of [
    [sd, shpBytes] as const,
    [xd, 100 + records.length * 8] as const,
  ]) {
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, totBytes / 2, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, SHAPE_TYPE_POLYGON, true);
    dv.setFloat64(36, overall[0], true);
    dv.setFloat64(44, overall[1], true);
    dv.setFloat64(52, overall[2], true);
    dv.setFloat64(60, overall[3], true);
  }

  let off = 100;
  let shxRecordOffsetWords = 50; // primo record dopo l'header (100 byte = 50 word).
  records.forEach((r, i) => {
    const numParts = r.rings.length;
    const numPoints = r.rings.reduce((n, ring) => n + ring.length, 0);

    // Record header (.shp).
    sd.setInt32(off, i + 1, false); // numero record (1-based)
    sd.setInt32(off + 4, contentWords[i], false);
    let c = off + 8;
    sd.setInt32(c, SHAPE_TYPE_POLYGON, true);
    sd.setFloat64(c + 4, r.box[0], true);
    sd.setFloat64(c + 12, r.box[1], true);
    sd.setFloat64(c + 20, r.box[2], true);
    sd.setFloat64(c + 28, r.box[3], true);
    sd.setInt32(c + 36, numParts, true);
    sd.setInt32(c + 40, numPoints, true);
    let partStart = 0;
    let p = c + 44;
    for (const ring of r.rings) {
      sd.setInt32(p, partStart, true);
      partStart += ring.length;
      p += 4;
    }
    for (const ring of r.rings)
      for (const [x, y] of ring) {
        sd.setFloat64(p, x, true);
        sd.setFloat64(p + 8, y, true);
        p += 16;
      }

    // Index (.shx).
    xd.setInt32(100 + i * 8, shxRecordOffsetWords, false);
    xd.setInt32(100 + i * 8 + 4, contentWords[i], false);
    shxRecordOffsetWords += 4 + contentWords[i]; // 4 word = header record (8 byte)

    off += 8 + contentWords[i] * 2;
  });

  return { shp: new Uint8Array(shp), shx: new Uint8Array(shx) };
}

function formatValue(value: unknown, field: CampoDbf): string {
  if (field.tipo === "N") {
    const n = typeof value === "number" ? value : Number(value);
    const testo = Number.isFinite(n) ? n.toFixed(field.decimali) : "";
    return testo.slice(0, field.lunghezza).padStart(field.lunghezza, " ");
  }
  const testo = value == null ? "" : String(value);
  return testo.slice(0, field.lunghezza).padEnd(field.lunghezza, " ");
}

function buildDbf(features: Feature[], schema: CampoDbf[]): Uint8Array {
  const headerLength = 32 + schema.length * 32 + 1;
  const recordLength = 1 + schema.reduce((n, c) => n + c.lunghezza, 0);
  const totale = headerLength + features.length * recordLength + 1;
  const buf = new ArrayBuffer(totale);
  const dv = new DataView(buf);

  const now = new Date();
  dv.setUint8(0, 0x03);
  dv.setUint8(1, now.getFullYear() - 1900);
  dv.setUint8(2, now.getMonth() + 1);
  dv.setUint8(3, now.getDate());
  dv.setUint32(4, features.length, true);
  dv.setUint16(8, headerLength, true);
  dv.setUint16(10, recordLength, true);

  schema.forEach((field, i) => {
    const base = 32 + i * 32;
    writeAscii(dv, base, field.name, 11);
    dv.setUint8(base + 11, field.tipo.charCodeAt(0));
    dv.setUint8(base + 16, field.lunghezza);
    dv.setUint8(base + 17, field.decimali);
  });
  dv.setUint8(headerLength - 1, 0x0d); // terminatore descrittori

  let off = headerLength;
  for (const f of features) {
    dv.setUint8(off, 0x20); // record non cancellato
    off += 1;
    for (const field of schema) {
      writeAscii(
        dv,
        off,
        formatValue(f.properties?.[field.chiave], field),
        field.lunghezza,
      );
      off += field.lunghezza;
    }
  }
  dv.setUint8(totale - 1, 0x1a); // EOF
  return new Uint8Array(buf);
}

/**
 * Genera l'archivio ZIP Shapefile (.shp/.shx/.dbf/.prj) da una FeatureCollection
 * di poligoni. `nomeBase` è il name dei file dentro lo zip.
 */
export function geojsonToShapefileZip(
  fc: FeatureCollection,
  nomeBase = "vra",
): Uint8Array {
  const features = fc.features.filter(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  const records: Record[] = features.map((f) => {
    const rings = ringsDaFeature(f);
    return { rings, box: boxDaRings(rings) };
  });
  const schema = dedussiSchema(features);
  const { shp, shx } = buildShpShx(records);
  const dbf = buildDbf(features, schema);

  return zipSync({
    [`${nomeBase}.shp`]: shp,
    [`${nomeBase}.shx`]: shx,
    [`${nomeBase}.dbf`]: dbf,
    [`${nomeBase}.prj`]: new TextEncoder().encode(WGS84_PRJ),
  });
}
