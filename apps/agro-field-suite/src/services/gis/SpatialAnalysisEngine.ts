/**
 * SpatialAnalysisEngine — motore di analisi spaziale headless, lato client.
 *
 * Esegue overlay, spatial join e zonazione H3 interamente nel browser con
 * **DuckDB Spatial** (OLAP), leggendo i dati transazionali dal **PGlite** del
 * tenant (OLTP). Il PGlite locale di AgroGea NON ha PostGIS (la geometria è
 * GeoJSON in `jsonb`, vedi packages/agro-core/src/db/schema.ts): tutto il lavoro
 * spaziale pesante è quindi delegato qui, senza dipendere da server esterni.
 *
 * Le import `?url` di DuckDB-WASM sono specifiche di Vite, perciò questo module
 * gira solo a runtime. La logica pura (costruttori SQL) è in ./spatial-sql,
 * dove può essere testata sotto Node.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  createTableAsSql,
  sanitizeTableName,
  selectByLocationSql,
  type SelectByLocationOptions,
  spatialJoinSql,
  type SpatialJoinOptions,
  quoteIdentifier,
  quoteSqlString,
  vectorSourceSql,
} from "./spatial-sql";

const GEOJSON_COLUMN = "__geojson";

// Stessi bundle del caricatore desktop (apps/geolibre-desktop/src/lib/
// duckdb-vector-loader.ts): worker ES + wasm serviti come asset locali, così la
// build Tauri funziona al 100% offline.
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbWasmMvp, mainWorker: mvpWorker },
  eh: { mainModule: duckdbWasmEh, mainWorker: ehWorker },
};

/** Vista strutturale minima del PGlite del tenant (evita di accoppiare i tipi). */
interface PgliteLike {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** File vettoriale massivo caricato via drag-and-drop e tenuto in DuckDB. */
export interface VectorFileInput {
  name: string;
  extension: string;
  data: Uint8Array;
  /** File accessori (es. .dbf/.shx/.prj di uno Shapefile). */
  siblingFiles?: { name: string; data: Uint8Array }[];
}

interface DuckDbRow {
  toJSON?: () => Record<string, unknown>;
  [key: string]: unknown;
}

function rowsFromResult(result: { toArray: () => DuckDbRow[] }) {
  return result
    .toArray()
    .map((row) =>
      typeof row.toJSON === "function" ? row.toJSON() : { ...row },
    );
}

export class SpatialAnalysisEngine {
  private static shared: SpatialAnalysisEngine | null = null;

  private dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
  private spatialPromise: Promise<void> | null = null;

  /** Istanza condivisa per tutta l'app (un solo worker/WASM in memoria). */
  static instance(): SpatialAnalysisEngine {
    SpatialAnalysisEngine.shared ??= new SpatialAnalysisEngine();
    return SpatialAnalysisEngine.shared;
  }

  private getDatabase(): Promise<duckdb.AsyncDuckDB> {
    this.dbPromise ??= (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const worker = new Worker(bundle.mainWorker!, { type: "module" });
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await db.open({});
      return db;
    })().catch((error) => {
      this.dbPromise = null;
      throw error;
    });
    return this.dbPromise;
  }

  /** Installa e load l'estensione spatial una volta sola per istanza DB. */
  private async ensureSpatial(
    connection: duckdb.AsyncDuckDBConnection,
  ): Promise<void> {
    this.spatialPromise ??= (async () => {
      await connection.query("INSTALL spatial");
      await connection.query("LOAD spatial");
    })();
    try {
      await this.spatialPromise;
    } catch (error) {
      this.spatialPromise = null;
      throw error;
    }
  }

  private async withConnection<T>(
    task: (connection: duckdb.AsyncDuckDBConnection) => Promise<T>,
  ): Promise<T> {
    const db = await this.getDatabase();
    const connection = await db.connect();
    try {
      await this.ensureSpatial(connection);
      return await task(connection);
    } finally {
      await connection.close();
    }
  }

  /** Esegue SQL arbitrario e restituisce le rows normalizzate. */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    return this.withConnection(async (connection) =>
      rowsFromResult(await connection.query(sql)),
    );
  }

  /**
   * Registra una FeatureCollection come tabella DuckDB con colonna geometria
   * `geom`. È la via con cui i dati PGlite (GeoJSON) e i risultati intermedi
   * entrano nel motore analitico.
   */
  async registerGeoJson(
    tableName: string,
    collection: FeatureCollection,
  ): Promise<string> {
    const table = sanitizeTableName(tableName);
    const file = `__agro_${table}.geojson`;
    return this.withConnection(async (connection) => {
      const db = await this.getDatabase();
      await db.registerFileText(file, JSON.stringify(collection));
      try {
        await connection.query(
          createTableAsSql(table, `SELECT * FROM ST_Read(${quoteSqlString(file)})`),
        );
      } finally {
        await dropFilesQuietly(db, [file]);
      }
      return table;
    });
  }

  /**
   * Legge le rows di una tabella PGlite del tenant (con geometria GeoJSON in
   * una colonna `jsonb`) e le registra come tabella DuckDB. Ponte OLTP→OLAP.
   *
   * @param pg          Istanza PGlite del tenant (vedi openTenantDb).
   * @param source.table       Tabella sorgente (es. `plots`).
   * @param source.geomColumn  Colonna geometria GeoJSON (es. `geometria`).
   * @param source.where       Filtro opzionale (già sanificato dal chiamante).
   */
  async registerFromPglite(
    pg: PgliteLike,
    source: {
      table: string;
      geomColumn: string;
      where?: string;
      destTable?: string;
    },
  ): Promise<string> {
    const { rows } = await pg.query(
      `select * from ${quoteIdentifier(source.table)}` +
        (source.where ? ` where ${source.where}` : ""),
    );
    const collection = rowsToFeatureCollection(rows, source.geomColumn);
    return this.registerGeoJson(source.destTable ?? source.table, collection);
  }

  /**
   * Carica un file vettoriale massivo (GeoJSON/Shapefile/GeoParquet/OSM PBF) in
   * una tabella DuckDB temporanea per overlay fulminei. Pensato per il
   * drag-and-drop di estratti catastali o OSM.
   */
  async loadVectorFile(file: VectorFileInput): Promise<string> {
    const table = sanitizeTableName(file.name.replace(/\.[^.]+$/, ""));
    return this.withConnection(async (connection) => {
      const db = await this.getDatabase();
      const registered = [file.name, ...(file.siblingFiles ?? []).map((s) => s.name)];
      await db.registerFileBuffer(file.name, file.data);
      for (const sibling of file.siblingFiles ?? []) {
        await db.registerFileBuffer(sibling.name, sibling.data);
      }
      try {
        await connection.query(
          createTableAsSql(table, vectorSourceSql(file.name, file.extension)),
        );
      } finally {
        await dropFilesQuietly(db, registered);
      }
      return table;
    });
  }

  /**
   * Carica un file vettoriale (Shapefile/GeoParquet/OSM PBF/…) e lo restituisce
   * come FeatureCollection, pronta per essere registrata come layer nel Layer
   * Store di GeoLibre (Add Data). Il reader Spatial materializza la geometria
   * nella colonna `geom`, riconvertita qui in GeoJSON.
   */
  async loadVectorFileAsFeatureCollection(
    file: VectorFileInput,
  ): Promise<FeatureCollection> {
    const table = await this.loadVectorFile(file);
    const sql =
      `SELECT * EXCLUDE (${quoteIdentifier("geom")}), ` +
      `ST_AsGeoJSON(${quoteIdentifier("geom")}) AS ${quoteIdentifier(GEOJSON_COLUMN)} ` +
      `FROM ${quoteIdentifier(table)}`;
    return rowsGeoJsonColumnToFeatureCollection(await this.query(sql));
  }

  /** Spatial Join: arricchisce le feature di sinistra con gli attributi destri. */
  async spatialJoin(options: SpatialJoinOptions): Promise<FeatureCollection> {
    const rows = await this.query(spatialJoinSql(options));
    return rowsGeoJsonColumnToFeatureCollection(rows);
  }

  /** Select by Location: filtra una tabella in base alla relazione con una maschera. */
  async selectByLocation(
    options: SelectByLocationOptions,
  ): Promise<FeatureCollection> {
    const rows = await this.query(selectByLocationSql(options));
    return rowsGeoJsonColumnToFeatureCollection(rows);
  }

  /** Rilascia il worker DuckDB. La prossima query ricrea l'istanza. */
  async dispose(): Promise<void> {
    const promise = this.dbPromise;
    this.dbPromise = null;
    this.spatialPromise = null;
    if (promise) {
      const db = await promise.catch(() => null);
      await db?.terminate();
    }
  }
}

async function dropFilesQuietly(
  db: duckdb.AsyncDuckDB,
  fileNames: string[],
): Promise<void> {
  try {
    await db.dropFiles(fileNames);
  } catch {
    // I file possono non essere mai stati creati: drop best-effort.
  }
}

/** Costruisce una FeatureCollection da rows PGlite con geometria GeoJSON jsonb. */
function rowsToFeatureCollection(
  rows: Record<string, unknown>[],
  geomColumn: string,
): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const rawGeom = row[geomColumn];
    const geometry = parseGeometry(rawGeom);
    if (!geometry) continue;
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === geomColumn) continue;
      properties[key] = value;
    }
    features.push({ type: "Feature", geometry, properties });
  }
  return { type: "FeatureCollection", features };
}

function parseGeometry(raw: unknown): Geometry | null {
  if (raw == null) return null;
  // PGlite restituisce il jsonb già parsato; un driver diverso può dare testo.
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (value && typeof value === "object" && "type" in value) {
    return value as Geometry;
  }
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Rilegge la colonna __geojson dei risultati di join in una FeatureCollection. */
function rowsGeoJsonColumnToFeatureCollection(
  rows: Record<string, unknown>[],
): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const geometry = parseGeometry(row[GEOJSON_COLUMN]);
    if (!geometry) continue;
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === GEOJSON_COLUMN) continue;
      properties[key] = value;
    }
    features.push({ type: "Feature", geometry, properties });
  }
  return { type: "FeatureCollection", features };
}
