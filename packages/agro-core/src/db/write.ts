import { v4 as uuidv4 } from "uuid";

/**
 * Helper condivisi di scrittura del DAL: serializzazione row → SQL e
 * costruzione dell'upsert idempotente. Unico punto in cui si generate la
 * clausola `on conflict (id) do update`, usata da scritture con outbox,
 * ingestioni local-only e applicazione delle rows remote.
 */

export type Row = Record<string, unknown>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function getDeviceId(): string {
  const KEY = "agrogea.device_id";
  try {
    let id = globalThis.localStorage?.getItem(KEY);
    if (!id) {
      id = uuidv4();
      globalThis.localStorage?.setItem(KEY, id);
    }
    return id;
  } catch {
    return "device-sconosciuto";
  }
}

export function columnsAndValues(row: Row): {
  columns: string[];
  placeholders: string;
  values: unknown[];
} {
  const columns = Object.keys(row);
  return {
    columns,
    placeholders: columns.map((_, i) => `$${i + 1}`).join(", "),
    values: columns.map((column) => {
      const value = row[column];
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? JSON.stringify(value)
        : value;
    }),
  };
}

/**
 * SQL di upsert per id: `insert … on conflict (id) do update` su tutte le
 * columns tranne chiavi e `created_at`. Con `lww: true` l'update è condizionato
 * a `updated_at` non più recente in locale (Last-Write-Wins del pull remoto).
 */
export function upsertSql(
  tabella: string,
  row: Row,
  options: { lww?: boolean } = {},
): { sql: string; values: unknown[] } {
  const { columns, placeholders, values } = columnsAndValues(row);
  const updates = columns
    .filter((c) => !["id", "tenant_id", "created_at"].includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  const guard = options.lww
    ? `\n         where ${tabella}.updated_at <= excluded.updated_at`
    : "";
  return {
    sql: `insert into ${tabella} (${columns.join(", ")})
       values (${placeholders})
       on conflict (id) do update set ${updates}${guard}`,
    values,
  };
}
