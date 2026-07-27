import type { PGlite, Results, Transaction } from "@electric-sql/pglite";

/**
 * Normalizzazione delle rows in USCITA dal data plane locale: rende VERI i tipi
 * di dominio.
 *
 * PGlite deserializza alcune colonne in forme diverse da quelle dichiarate dai
 * tipi TypeScript, e per due tipi molto comuni:
 *
 * | colonna       | OID  | restituito dal driver | dichiarato dai tipi |
 * |---------------|------|-----------------------|---------------------|
 * | `timestamptz` | 1184 | `Date`                | `string` (ISO)      |
 * | `date`        | 1082 | `Date` (mezzanotte UTC)| `string` (YYYY-MM-DD)|
 * | `numeric`     | 1700 | `string`              | `number`            |
 *
 * Il resto è già coerente (uuid/text → string, int/float8 → number, bool →
 * boolean, jsonb → oggetto, array → array), verificato empiricamente.
 *
 * Finché la conversione restava a carico dei chiamanti, ogni nuovo consumatore
 * doveva ricordarsene e i test che costruivano le rows in TypeScript non
 * potevano intercettare l'errore: `executed_at.slice(0, 10)` esplodeva su un
 * `Date`, `created_at.localeCompare(…)` pure, `Date.parse(dateObject)`
 * funzionava solo per coercizione perdendo i millisecondi, e una `numeric` letta
 * come stringa passava silenziosamente in confronti e somme sbagliate.
 *
 * La conversione avviene quindi UNA volta, qui, sulla base del `dataTypeID`
 * dichiarato dal driver per ogni colonna — non su un elenco di nomi di colonna
 * da tenere allineato allo schema a mano. Il wrapper di {@link
 * withRowNormalization} copre `db.query`, `db.transaction` e quindi anche
 * `tx.query`: nessun percorso di lettura può dimenticarsene.
 */

/** OID Postgres delle colonne che richiedono conversione. */
const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_NUMERIC = 1700;

/**
 * Giorno `YYYY-MM-DD` da una colonna `date`.
 *
 * Componenti **UTC**, non locali: PGlite restituisce una `date` come mezzanotte
 * UTC del giorno indicato. Leggerla con i componenti locali darebbe il giorno
 * PRECEDENTE in tutti i fusi a offset negativo (mezzanotte UTC del 27 è le 20:00
 * del 26 a New York) — una scadenza lotto sarebbe risultata anticipata di un
 * giorno per metà del mondo.
 */
function dateColumnToIsoDay(value: Date): string {
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

/** Converte un singolo value secondo l'OID della sua colonna. */
export function normalizeValue(value: unknown, dataTypeId: number): unknown {
  if (value == null) return value;
  switch (dataTypeId) {
    case OID_DATE:
      return value instanceof Date ? dateColumnToIsoDay(value) : value;
    case OID_TIMESTAMP:
    case OID_TIMESTAMPTZ:
      return value instanceof Date ? value.toISOString() : value;
    case OID_NUMERIC: {
      if (typeof value !== "string") return value;
      const parsed = Number(value);
      // `NaN`/`Infinity` sono valori leciti di una numeric Postgres: in quel
      // caso si preferisce lasciare la stringa originale piuttosto che
      // introdurre un NaN silenzioso nei calcoli.
      return Number.isFinite(parsed) ? parsed : value;
    }
    default:
      return value;
  }
}

/** Descrittore di colonna come lo espone il driver. */
interface ResultField {
  name: string;
  dataTypeID: number;
}

/**
 * Applica {@link normalizeValue} a tutte le rows di un result set. Ritorna le
 * rows originali quando non c'è nulla da convertire (nessun campo di tipo
 * interessato): il caso di gran lunga più frequente non paga alcuna copia.
 */
export function normalizeRows<T>(
  rows: T[],
  fields: ResultField[] | undefined,
): T[] {
  if (!fields || fields.length === 0 || rows.length === 0) return rows;
  const convertible = fields.filter(
    (f) =>
      f.dataTypeID === OID_DATE ||
      f.dataTypeID === OID_TIMESTAMP ||
      f.dataTypeID === OID_TIMESTAMPTZ ||
      f.dataTypeID === OID_NUMERIC,
  );
  if (convertible.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...(row as Record<string, unknown>) };
    for (const field of convertible) {
      if (field.name in out) {
        out[field.name] = normalizeValue(out[field.name], field.dataTypeID);
      }
    }
    return out as T;
  });
}

/** Result set con le rows già normalizzate. */
function normalizeResults<T>(results: Results<T>): Results<T> {
  const rows = normalizeRows(results.rows, results.fields);
  return rows === results.rows ? results : { ...results, rows };
}

/**
 * Avvolge una connessione/transazione in modo che ogni `query` restituisca
 * rows normalizzate. Il Proxy delega tutto il resto all'oggetto originale
 * (rebindato su di esso: PGlite usa campi privati, un `this` diverso
 * lancerebbe).
 */
function wrapQueryable<T extends PGlite | Transaction>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "query") {
        return async (...args: unknown[]) => {
          const results = await (
            obj.query as (...a: unknown[]) => Promise<Results<unknown>>
          )(...args);
          return normalizeResults(results);
        };
      }
      if (prop === "transaction" && "transaction" in obj) {
        return (callback: (tx: Transaction) => Promise<unknown>) =>
          (obj as PGlite).transaction((tx) => callback(wrapQueryable(tx)));
      }
      const value = Reflect.get(obj, prop, receiver === target ? obj : receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  }) as T;
}

/**
 * Connessione PGlite le cui letture rispettano i tipi di dominio dichiarati.
 * Applicata una sola volta nel costruttore di `AgroDalBase`, copre l'INTERO
 * DAL — sottoclassi, `rawQuery` e transazioni comprese.
 */
export function withRowNormalization(db: PGlite): PGlite {
  return wrapQueryable(db);
}
