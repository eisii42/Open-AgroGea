import { PGlite, types } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL, AGRO_LOCAL_SCHEMA_VERSION } from "./schema";

/**
 * Parser di tipo per le columns `numeric` (OID 1700). Postgres/PGlite le
 * serializza come STRINGA per preservare la precisione arbitraria; ma il nostro
 * modello (area_ha, last_ndvi_mean, declared_area_ha, output_value DSS) le
 * tipizza come `number` e ne fa aritmetica / `toFixed`. Senza questo parser una
 * `area_ha` letta tornava "1.2345" e `area.toFixed()` mandava in crash (schermo
 * bianco). Le superfici/NDVI stanno largamente nel range sicuro del double JS.
 */
const NUMERIC_PARSERS = {
  [types.NUMERIC]: (value: string | null) =>
    value == null ? null : Number(value),
};

/**
 * Gestione delle istanze PGlite locali: un database isolato per tenant, così
 * un agronomo che gestisce più companies non può mai mescolarne i dati e lo
 * sblocco offline (PIN/biometria) apre solo l'istanza del tenant associato.
 *
 * Persistenza: IndexedDB (`idb://`) sia nel browser sia nella WebView Tauri.
 * Il backup grezzo si ottiene con `dumpTenantDb` (vedi sotto), che usa il
 * meccanismo nativo di PGlite per serializzare l'intero dataDir.
 */

const instances = new Map<string, Promise<PGlite>>();

export function tenantDataDir(tenantId: string): string {
  // Prefisso fisso: rende riconoscibili (ed enumerabili) i DB AgroGea
  // accanto agli altri usi di IndexedDB della webview.
  return `idb://agrogea-${tenantId}`;
}

async function createTenantDb(tenantId: string): Promise<PGlite> {
  const db = new PGlite(tenantDataDir(tenantId), { parsers: NUMERIC_PARSERS });
  await db.exec(AGRO_LOCAL_SCHEMA_SQL);
  await db.query(
    `insert into agro_meta (key, value)
     values ('schema_version', $1), ('tenant_id', $2)
     on conflict (key) do update set value = excluded.value`,
    [String(AGRO_LOCAL_SCHEMA_VERSION), tenantId],
  );
  return db;
}

/**
 * Apre (o riusa) l'istanza PGlite del tenant, applicando lo schema al primo
 * avvio. Concorrenza-sicura: chiamate parallele condividono la stessa promise.
 */
export function openTenantDb(tenantId: string): Promise<PGlite> {
  let instance = instances.get(tenantId);
  if (!instance) {
    instance = createTenantDb(tenantId).catch((error) => {
      // Un'apertura fallita non deve avvelenare la cache.
      instances.delete(tenantId);
      throw error;
    });
    instances.set(tenantId, instance);
  }
  return instance;
}

export async function closeTenantDb(tenantId: string): Promise<void> {
  const instance = instances.get(tenantId);
  if (!instance) return;
  instances.delete(tenantId);
  const db = await instance;
  await db.close();
}

/**
 * Backup grezzo: serializza l'intero dataDir PGlite in un archivio (formato
 * nativo PGlite, ricaricabile con `new PGlite({ loadDataDir })`).
 */
export async function dumpTenantDb(tenantId: string): Promise<Blob> {
  const db = await openTenantDb(tenantId);
  return db.dumpDataDir();
}

// Ordine parent → child: il dump si reload rispettando le foreign key
// (products→companies, product_lots→products, activity_products→treatment_logs+lots).
const SQL_DUMP_TABLES = [
  "companies",
  "crops",
  "plots_registry",
  "plots_campaign",
  "treatment_logs",
  "products",
  "product_lots",
  "activity_products",
  "sync_outbox",
] as const;

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) {
    const items = value.map((item) => sqlLiteral(item)).join(", ");
    return `ARRAY[${items}]`;
  }
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Dump SQL standard (INSERT) leggibile e riusabile con psql/pg_restore su un
 * qualsiasi PostgreSQL: è l'esportazione "portabile" richiesta all'utente,
 * complementare al backup binario di `dumpTenantDb`.
 */
export async function exportSqlDump(tenantId: string): Promise<string> {
  const db = await openTenantDb(tenantId);
  const parts: string[] = [
    `-- AgroGea SQL dump · tenant ${tenantId} · ${new Date().toISOString()}`,
    "begin;",
  ];
  for (const table of SQL_DUMP_TABLES) {
    const result = await db.query<Record<string, unknown>>(
      `select * from ${table} order by 1`,
    );
    if (result.rows.length === 0) continue;
    const columns = Object.keys(result.rows[0]);
    parts.push(`\n-- ${table} (${result.rows.length} rows)`);
    for (const row of result.rows) {
      const values = columns.map((column) => sqlLiteral(row[column]));
      parts.push(
        `insert into ${table} (${columns.join(", ")}) values (${values.join(", ")});`,
      );
    }
  }
  parts.push("commit;");
  return parts.join("\n");
}
