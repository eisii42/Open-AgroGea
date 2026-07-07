import type {
  Feature,
  FeatureCollection,
  Geometry,
  Position,
} from "geojson";
import { geojsonToShapefileZip } from "../../modules/vra/shapefile";

/**
 * Filiera di esportazione vettoriale universale (Modulo 4). Serializzatori PURI
 * (solo stringhe/byte, testabili sotto Node) verso i formati GIS della filiera:
 *   * GeoJSON — interscambio universale;
 *   * KML — Google Earth / visualizzatori;
 *   * GPX — tracce/waypoint per ricevitori GNSS da campo;
 *   * Shapefile (.zip) — trattori/terminali legacy (riusa il writer VRA);
 *   * CSV alfanumerico — attributi (riusa il writer della tabella attributi).
 *
 * Import e parsing MASSIVO dei formati binari restano al motore DuckDB Spatial
 * (ST_Read via OGR): questi serializzatori coprono solo il lato export, senza
 * dipendenze pesanti aggiuntive (priorità peso bundle).
 */

export type ExportFormat = "geojson" | "kml" | "gpx" | "csv" | "shapefile";

export interface ExportArtifact {
  filename: string;
  /** Contenuto pronto per un Blob (stringa XML/CSV/JSON o byte dello zip). */
  blobPart: BlobPart;
  mime: string;
}

const NS_KML = "http://www.opengis.net/kml/2.2";
const NS_GPX = "http://www.topografix.com/GPX/1/1";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function num(n: number): string {
  return Number.isFinite(n) ? String(n) : "0";
}

// ---------------------------------------------------------------------------
// CSV alfanumerico (attributi)
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Cella CSV quotata in base al separatore effettivo (`,` o `;`). */
function csvCellSep(value: unknown, sep: string): string {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const reSpeciale = new RegExp(`["\r\n${sep}]`);
  return reSpeciale.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serializza gli attributi di una FeatureCollection in CSV (geometria esclusa). */
export function geojsonToCsv(fc: FeatureCollection): string {
  const chiavi = new Set<string>();
  for (const f of fc.features) {
    for (const k of Object.keys(f.properties ?? {})) chiavi.add(k);
  }
  const colonne = [...chiavi];
  const intestazione = ["feature_id", ...colonne];
  const righe = fc.features.map((f, i) => {
    const props = f.properties ?? {};
    return [String(f.id ?? i), ...colonne.map((c) => props[c])]
      .map(csvCell)
      .join(",");
  });
  return [intestazione.map(csvCell).join(","), ...righe].join("\n");
}

/** BOM UTF-8: forza Excel (locale IT/ES) a leggere il file come UTF-8. */
export const BOM_UTF8 = "﻿";

export interface OpzioniCsvLocalizzato {
  /** Separatore di campo (default `;`, atteso dai locale europei). */
  separatore?: string;
  /** Antepone il BOM UTF-8 (default true). */
  bom?: boolean;
}

/**
 * Variante LOCALIZZATA del CSV per Excel europeo: separatore `;` e BOM UTF-8 di
 * default, così accenti e celle restano corretti senza import wizard. Non
 * sostituisce {@link geojsonToCsv} (CSV standard a virgola per l'interscambio).
 */
export function geojsonToCsvLocalizzato(
  fc: FeatureCollection,
  opzioni: OpzioniCsvLocalizzato = {},
): string {
  const sep = opzioni.separatore ?? ";";
  const chiavi = new Set<string>();
  for (const f of fc.features) {
    for (const k of Object.keys(f.properties ?? {})) chiavi.add(k);
  }
  const colonne = [...chiavi];
  const intestazione = ["feature_id", ...colonne];
  const righe = fc.features.map((f, i) => {
    const props = f.properties ?? {};
    return [String(f.id ?? i), ...colonne.map((c) => props[c])]
      .map((v) => csvCellSep(v, sep))
      .join(sep);
  });
  const corpo = [
    intestazione.map((v) => csvCellSep(v, sep)).join(sep),
    ...righe,
  ].join("\r\n");
  return (opzioni.bom ?? true ? BOM_UTF8 : "") + corpo;
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

/** Coordinate KML "lon,lat[,alt]" separate da spazi. */
function kmlCoords(positions: Position[]): string {
  return positions.map((p) => `${num(p[0])},${num(p[1])},0`).join(" ");
}

function kmlGeometry(geom: Geometry): string {
  switch (geom.type) {
    case "Point":
      return `<Point><coordinates>${kmlCoords([geom.coordinates])}</coordinates></Point>`;
    case "MultiPoint":
      return `<MultiGeometry>${geom.coordinates
        .map((c) => `<Point><coordinates>${kmlCoords([c])}</coordinates></Point>`)
        .join("")}</MultiGeometry>`;
    case "LineString":
      return `<LineString><coordinates>${kmlCoords(geom.coordinates)}</coordinates></LineString>`;
    case "MultiLineString":
      return `<MultiGeometry>${geom.coordinates
        .map(
          (l) =>
            `<LineString><coordinates>${kmlCoords(l)}</coordinates></LineString>`,
        )
        .join("")}</MultiGeometry>`;
    case "Polygon":
      return kmlPolygon(geom.coordinates);
    case "MultiPolygon":
      return `<MultiGeometry>${geom.coordinates
        .map((poly) => kmlPolygon(poly))
        .join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${geom.geometries
        .map((g) => kmlGeometry(g))
        .join("")}</MultiGeometry>`;
    default:
      return "";
  }
}

function kmlPolygon(rings: Position[][]): string {
  const [outer, ...inner] = rings;
  const boundary = (ring: Position[], tag: string) =>
    `<${tag}><LinearRing><coordinates>${kmlCoords(ring)}</coordinates></LinearRing></${tag}>`;
  return (
    `<Polygon>${boundary(outer ?? [], "outerBoundaryIs")}` +
    inner.map((r) => boundary(r, "innerBoundaryIs")).join("") +
    `</Polygon>`
  );
}

function kmlExtendedData(props: Record<string, unknown> | null): string {
  const entries = Object.entries(props ?? {});
  if (entries.length === 0) return "";
  const data = entries
    .map(
      ([k, v]) =>
        `<Data name="${escapeXml(k)}"><value>${escapeXml(
          v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
        )}</value></Data>`,
    )
    .join("");
  return `<ExtendedData>${data}</ExtendedData>`;
}

function kmlPlacemark(feature: Feature, index: number): string {
  if (!feature.geometry) return "";
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const nome = props.plot_name ?? props.name ?? props.nome ?? `Feature ${index + 1}`;
  return (
    `<Placemark><name>${escapeXml(String(nome))}</name>` +
    kmlExtendedData(props) +
    kmlGeometry(feature.geometry) +
    `</Placemark>`
  );
}

/** Serializza una FeatureCollection in KML 2.2. */
export function geojsonToKml(fc: FeatureCollection, nome = "AgroGea"): string {
  const placemarks = fc.features.map((f, i) => kmlPlacemark(f, i)).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="${NS_KML}"><Document><name>${escapeXml(nome)}</name>` +
    placemarks +
    `</Document></kml>`
  );
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

function gpxName(feature: Feature, index: number): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const nome = props.plot_name ?? props.name ?? props.nome ?? `Feature ${index + 1}`;
  return escapeXml(String(nome));
}

function gpxWpt(pos: Position, nome: string): string {
  return `<wpt lat="${num(pos[1])}" lon="${num(pos[0])}"><name>${nome}</name></wpt>`;
}

function gpxTrkseg(positions: Position[]): string {
  return `<trkseg>${positions
    .map((p) => `<trkpt lat="${num(p[1])}" lon="${num(p[0])}"/>`)
    .join("")}</trkseg>`;
}

/** Segmenti di traccia da una geometria lineare/poligonale (anelli esterni). */
function gpxSegments(geom: Geometry): string[] {
  switch (geom.type) {
    case "LineString":
      return [gpxTrkseg(geom.coordinates)];
    case "MultiLineString":
      return geom.coordinates.map((l) => gpxTrkseg(l));
    case "Polygon":
      return geom.coordinates.map((ring) => gpxTrkseg(ring));
    case "MultiPolygon":
      return geom.coordinates.flatMap((poly) =>
        poly.map((ring) => gpxTrkseg(ring)),
      );
    default:
      return [];
  }
}

/**
 * Serializza una FeatureCollection in GPX 1.1: i punti diventano waypoint, le
 * geometrie lineari/poligonali diventano tracce (gli anelli dei poligoni sono
 * segmenti di traccia, poiché GPX non ha un tipo poligono).
 */
export function geojsonToGpx(fc: FeatureCollection, creator = "AgroGea"): string {
  const parts: string[] = [];
  fc.features.forEach((feature, i) => {
    const geom = feature.geometry;
    if (!geom) return;
    const nome = gpxName(feature, i);
    if (geom.type === "Point") {
      parts.push(gpxWpt(geom.coordinates, nome));
    } else if (geom.type === "MultiPoint") {
      for (const c of geom.coordinates) parts.push(gpxWpt(c, nome));
    } else {
      const segs = gpxSegments(geom);
      if (segs.length > 0) {
        parts.push(`<trk><name>${nome}</name>${segs.join("")}</trk>`);
      }
    }
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="${NS_GPX}">` +
    parts.join("") +
    `</gpx>`
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Estensione/mime per formato. */
const META: Record<ExportFormat, { ext: string; mime: string }> = {
  geojson: { ext: "geojson", mime: "application/geo+json" },
  kml: { ext: "kml", mime: "application/vnd.google-earth.kml+xml" },
  gpx: { ext: "gpx", mime: "application/gpx+xml" },
  csv: { ext: "csv", mime: "text/csv;charset=utf-8" },
  shapefile: { ext: "zip", mime: "application/zip" },
};

/** Serializza la FeatureCollection nel formato richiesto. */
export function serializzaVettoriale(
  fc: FeatureCollection,
  format: ExportFormat,
  baseName: string,
): ExportArtifact {
  const meta = META[format];
  const suffix = format === "shapefile" ? "_shapefile" : "";
  const filename = `${baseName}${suffix}.${meta.ext}`;
  let blobPart: BlobPart;
  switch (format) {
    case "geojson":
      blobPart = JSON.stringify(fc);
      break;
    case "kml":
      blobPart = geojsonToKml(fc, baseName);
      break;
    case "gpx":
      blobPart = geojsonToGpx(fc, baseName);
      break;
    case "csv":
      blobPart = geojsonToCsv(fc);
      break;
    case "shapefile":
      blobPart = geojsonToShapefileZip(fc, baseName) as BlobPart;
      break;
  }
  return { filename, blobPart, mime: meta.mime };
}

/**
 * Unisce i GeoJSON di più layer in un'unica FeatureCollection, marcando ogni
 * feature col layer di provenienza (`__layer`) per la tracciabilità nell'export
 * cumulativo della configurazione aziendale.
 */
export function combinaLayer(
  layers: Array<{ id: string; name?: string; geojson?: FeatureCollection | null }>,
): FeatureCollection {
  const features: Feature[] = [];
  for (const layer of layers) {
    const fc = layer.geojson;
    if (!fc || !Array.isArray(fc.features)) continue;
    for (const f of fc.features) {
      features.push({
        ...f,
        properties: {
          __layer: layer.name ?? layer.id,
          ...(f.properties ?? {}),
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Scarica un artefatto via `<a download>` (funziona nella webview Tauri). */
export function downloadArtifact(artifact: ExportArtifact): void {
  const blob = new Blob([artifact.blobPart], { type: artifact.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = artifact.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
