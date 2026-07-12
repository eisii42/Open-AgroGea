/**
 * Costruttori SQL puri per il motore di analisi spaziale (DuckDB Spatial).
 *
 * Questo module NON importa `@duckdb/duckdb-wasm`: contiene solo logica di
 * stringa testabile sotto Node (`node --test`). Il runtime WASM, con le import
 * `?url` specifiche di Vite, vive in {@link ./SpatialAnalysisEngine}.
 */

/** Predicato topologico supportato da Spatial Join / Select by Location. */
export type SpatialPredicate =
  | "intersects"
  | "within"
  | "contains"
  | "touches"
  | "crosses"
  | "overlaps";

const PREDICATE_FN: Record<SpatialPredicate, string> = {
  intersects: "ST_Intersects",
  within: "ST_Within",
  contains: "ST_Contains",
  touches: "ST_Touches",
  crosses: "ST_Crosses",
  overlaps: "ST_Overlaps",
};

export function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Riduce un name arbitrario (name layer, name file drag-and-drop) a un
 * identificatore DuckDB sicuro. Le tabelle temporanee dell'overlay nascono da
 * input dell'utente, quindi va normalizzato prima di interpolarlo nel DDL.
 */
export function sanitizeTableName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const base = cleaned.length > 0 ? cleaned : "tabella";
  // Un identificatore SQL non può iniziare con una cifra.
  return /^[0-9]/.test(base) ? `t_${base}` : base;
}

/** Estensioni riconosciute, mappate sul reader DuckDB/Spatial appropriato. */
export type VectorReader = "st_read" | "read_parquet" | "st_read_osm";

export function readerForExtension(extension: string): VectorReader {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (ext === "parquet" || ext === "geoparquet") return "read_parquet";
  // Estratti OpenStreetMap: ST_ReadOSM legge il formato PBF nativo.
  if (ext === "pbf" || ext === "osm" || ext === "osm.pbf") return "st_read_osm";
  // geojson, json, shp, gpkg, kml, gml, fgb… tutto via il driver OGR di Spatial.
  return "st_read";
}

/** SELECT che materializza un file registrato in DuckDB come rows con geometria. */
export function vectorSourceSql(fileName: string, extension: string): string {
  const quoted = quoteSqlString(fileName);
  switch (readerForExtension(extension)) {
    case "read_parquet":
      return `SELECT * FROM read_parquet(${quoted})`;
    case "st_read_osm":
      return `SELECT * FROM ST_ReadOSM(${quoted})`;
    default:
      return `SELECT * FROM ST_Read(${quoted})`;
  }
}

/**
 * DDL idempotente che crea (o sostituisce) una tabella temporanea dell'overlay
 * a partire da una SELECT sorgente. `CREATE OR REPLACE` evita errori se lo
 * stesso file viene ricaricato col drag-and-drop.
 */
export function createTableAsSql(tableName: string, selectSql: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS ${selectSql}`;
}

export interface SpatialJoinOptions {
  /** Tabella "sinistra": le sue rows vengono conservate e arricchite. */
  leftTable: string;
  /** Tabella "destra": fornisce gli attributi da agganciare per intersezione. */
  rightTable: string;
  /** Colonna geometria di sinistra (default `geom`). */
  leftGeom?: string;
  /** Colonna geometria di destra (default `geom`). */
  rightGeom?: string;
  predicate?: SpatialPredicate;
  /** Colonne della tabella destra da riportare, con alias opzionale. */
  rightColumns?: { name: string; as?: string }[];
}

/**
 * Spatial Join: per ogni feature di `leftTable` aggancia gli attributi delle
 * feature di `rightTable` che soddisfano il predicato (default ST_Intersects).
 * Restituisce la geometria di sinistra come GeoJSON nella colonna `__geojson`,
 * pronta per essere riletta dall'engine.
 */
export function spatialJoinSql(options: SpatialJoinOptions): string {
  const {
    leftTable,
    rightTable,
    leftGeom = "geom",
    rightGeom = "geom",
    predicate = "intersects",
    rightColumns = [],
  } = options;
  const l = quoteIdentifier("l");
  const r = quoteIdentifier("r");
  const lGeom = `${l}.${quoteIdentifier(leftGeom)}`;
  const rGeom = `${r}.${quoteIdentifier(rightGeom)}`;
  const fn = PREDICATE_FN[predicate];
  const extra = rightColumns
    .map(
      ({ name, as }) =>
        `${r}.${quoteIdentifier(name)} AS ${quoteIdentifier(as ?? name)}`,
    )
    .join(", ");
  const projection = [`${l}.* EXCLUDE (${quoteIdentifier(leftGeom)})`]
    .concat(extra ? [extra] : [])
    .concat([`ST_AsGeoJSON(${lGeom}) AS ${quoteIdentifier("__geojson")}`])
    .join(", ");
  return (
    `SELECT ${projection} ` +
    `FROM ${quoteIdentifier(leftTable)} AS ${l} ` +
    `LEFT JOIN ${quoteIdentifier(rightTable)} AS ${r} ` +
    `ON ${fn}(${lGeom}, ${rGeom})`
  );
}

export interface SelectByLocationOptions {
  /** Tabella da filtrare. */
  targetTable: string;
  /** Tabella "maschera" rispetto a cui valutare il predicato. */
  maskTable: string;
  targetGeom?: string;
  maskGeom?: string;
  predicate?: SpatialPredicate;
}

/**
 * Select by Location: estrae le sole feature di `targetTable` che soddisfano il
 * predicato rispetto ad almeno una feature di `maskTable`. `EXISTS` evita la
 * duplicazione delle rows tipica di un join molti-a-molti.
 */
export function selectByLocationSql(options: SelectByLocationOptions): string {
  const {
    targetTable,
    maskTable,
    targetGeom = "geom",
    maskGeom = "geom",
    predicate = "intersects",
  } = options;
  const t = quoteIdentifier("t");
  const m = quoteIdentifier("m");
  const fn = PREDICATE_FN[predicate];
  return (
    `SELECT ${t}.* EXCLUDE (${quoteIdentifier(targetGeom)}), ` +
    `ST_AsGeoJSON(${t}.${quoteIdentifier(targetGeom)}) AS ${quoteIdentifier("__geojson")} ` +
    `FROM ${quoteIdentifier(targetTable)} AS ${t} ` +
    `WHERE EXISTS (SELECT 1 FROM ${quoteIdentifier(maskTable)} AS ${m} ` +
    `WHERE ${fn}(${t}.${quoteIdentifier(targetGeom)}, ${m}.${quoteIdentifier(maskGeom)}))`
  );
}
