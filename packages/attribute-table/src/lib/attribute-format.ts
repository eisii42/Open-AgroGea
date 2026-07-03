import type { GeoLibreLayer } from "@geolibre/core";
import type { FeatureCollection } from "geojson";

/**
 * Framework-free attribute formatting and export helpers shared by every host of
 * the attribute table. The pure value/name formatting and the Shapefile
 * field-name warnings used to live in the desktop app's `vector-export.ts`; they
 * are extracted here so the package owns them and hosts re-export them.
 *
 * Binary export (GeoParquet/GeoPackage/Shapefile) needs the host's Tauri/DuckDB
 * pipeline, so it is NOT implemented here: the host injects an
 * `exportVectorLayer` into the table. A pure GeoJSON/CSV download is provided for
 * light hosts that only need text export.
 */

/** Formats AttributeTable supports exporting to. Binary ones need a host impl. */
export type VectorExportFormat =
  | "geojson"
  | "csv"
  | "geoparquet"
  | "geopackage"
  | "shapefile";

/** Render an attribute value as the plain string used in CSV cells and inputs. */
export function formatAttributeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Turn a layer name into a filesystem-safe export base filename. */
export function sanitizeExportFileName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "layer";
}

function csvCell(value: unknown): string {
  const text = formatAttributeValue(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize a FeatureCollection's attributes to a CSV string. */
export function geojsonToCsv(geojson: FeatureCollection): string {
  const propertyKeys = new Set<string>();
  for (const feature of geojson.features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      propertyKeys.add(key);
    }
  }

  const orderedKeys = Array.from(propertyKeys);
  const headers = ["feature_id", ...orderedKeys];
  const rows = geojson.features.map((feature, index) => {
    const featureId = String(feature.id ?? index);
    const properties = feature.properties ?? {};
    const values = [featureId, ...orderedKeys.map((key) => properties[key])];
    return values.map(csvCell).join(",");
  });

  return [headers.map(csvCell).join(","), ...rows].join("\n");
}

// Shapefile holds one geometry family per file. Mirror the writer's grouping so
// the warning matches what actually happens on export.
type ShapefileFamily = "point" | "line" | "polygon";

function shapefileFamily(type: string): ShapefileFamily | null {
  switch (type) {
    case "Point":
    case "MultiPoint":
      return "point";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Polygon":
    case "MultiPolygon":
      return "polygon";
    default:
      return null;
  }
}

/**
 * Field-name limitations the Shapefile format will silently apply on export.
 * Returns a human-readable warning for any attribute name longer than 10
 * characters (which DBF truncates), for truncations that collide into the same
 * name, and when the layer mixes geometry types (extra families are dropped to
 * Null shapes). Empty when the layer is fully Shapefile-safe.
 */
export function shapefileFieldWarnings(geojson: FeatureCollection): string[] {
  const names = new Set<string>();
  for (const feature of geojson.features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      names.add(key);
    }
  }

  const fieldNames = Array.from(names);
  const longNames = fieldNames.filter((name) => name.length > 10);
  const warnings: string[] = [];
  if (longNames.length > 0) {
    warnings.push(
      `Shapefile truncates field names to 10 characters: ${longNames.join(", ")}`,
    );
  }

  // Normalise non-alphanumerics to "_" before truncating, exactly as the DBF
  // writer does, so collisions caused by character replacement are detected.
  const byTruncated = new Map<string, string[]>();
  for (const name of fieldNames) {
    const key = name.replace(/[^0-9A-Za-z_]/g, "_").slice(0, 10).toLowerCase();
    byTruncated.set(key, [...(byTruncated.get(key) ?? []), name]);
  }
  const collisions = Array.from(byTruncated.values()).filter(
    (group) => group.length > 1,
  );
  if (collisions.length > 0) {
    warnings.push(
      `Truncating to 10 characters produces duplicate field names: ${collisions
        .map((group) => group.join(", "))
        .join("; ")}`,
    );
  }

  // The writer locks the file to the first geometry's family; mixed or null
  // geometries become attribute-only Null shapes, which is silent data loss.
  let fileFamily: ShapefileFamily | null = null;
  for (const feature of geojson.features) {
    const family = feature.geometry
      ? shapefileFamily(feature.geometry.type)
      : null;
    if (family) {
      fileFamily = family;
      break;
    }
  }
  let demoted = 0;
  if (fileFamily !== null) {
    for (const feature of geojson.features) {
      const family = feature.geometry
        ? shapefileFamily(feature.geometry.type)
        : null;
      if (family && family !== fileFamily) demoted += 1;
    }
  }
  if (fileFamily !== null && demoted > 0) {
    warnings.push(
      `${demoted} feature(s) whose geometry differs from the ${fileFamily} ` +
        "type will be written without geometry (Shapefile allows one geometry " +
        "type per file).",
    );
  }
  return warnings;
}

/**
 * Source id of a geojson-render-mode vector layer created by the Add Vector
 * Layer control, or null. These layers hold their features in a MapLibre GeoJSON
 * source rather than in `layer.geojson`, so callers read the data back from the
 * map. Tiles-mode (DuckDB) vector layers are excluded.
 */
export function geojsonVectorSourceId(
  layer: GeoLibreLayer | undefined,
): string | null {
  if (
    !layer ||
    layer.type !== "geojson" ||
    layer.metadata.sourceKind !== "maplibre-gl-vector" ||
    layer.metadata.externalNativeLayer !== true
  ) {
    return null;
  }
  const sourceIds = layer.metadata.sourceIds;
  const sourceId = Array.isArray(sourceIds) ? sourceIds[0] : undefined;
  return typeof sourceId === "string" ? sourceId : null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Pure, dependency-free text export for GeoJSON and CSV via a browser download.
 * Works inside the Tauri webview (an `<a download>` click), so a light host can
 * pass this as `exportVectorLayer` for the text formats without pulling in the
 * DuckDB/Tauri binary-export pipeline. Returns the file name (never null — there
 * is no cancellable native dialog on this path).
 */
export async function downloadTextVectorLayer(
  geojson: FeatureCollection,
  format: "geojson" | "csv",
  baseName: string,
): Promise<string> {
  const isCsv = format === "csv";
  const content = isCsv
    ? geojsonToCsv(geojson)
    : JSON.stringify(geojson, null, 2);
  const filename = `${baseName}.${isCsv ? "csv" : "geojson"}`;
  triggerDownload(
    new Blob([content], {
      type: isCsv
        ? "text/csv;charset=utf-8"
        : "application/geo+json;charset=utf-8",
    }),
    filename,
  );
  return filename;
}
