/**
 * Normalizzazione dei timestamp che arrivano dal data plane locale.
 *
 * PGlite deserializza le colonne `timestamptz`/`date` in oggetti **`Date`**,
 * non nelle stringhe ISO che i tipi di dominio dichiarano (`TreatmentLog.
 * executed_at: string`, `FieldOperationSession.start_time: string`, …). I tipi
 * descrivono il contratto di SERIALIZZAZIONE (outbox, export, payload di sync),
 * non ciò che il driver restituisce in memoria: una row appena riletta dal DB
 * porta `Date`, la stessa row appena costruita in TS porta `string`.
 *
 * Conseguenza pratica: qualunque codice che tocchi un timestamp letto dal DB
 * deve tollerare ENTRAMBE le forme. `value.slice(0, 10)` esplode su un `Date`
 * e `Date.parse(dateObject)` "funziona" solo per coercizione via `toString()`,
 * perdendo i millisecondi. Il resto della codebase se la cava passando sempre
 * da `new Date(value)` (vedi `LogbookPanel`, `expiryStatus`); questi helper
 * rendono quella convenzione esplicita, condivisa e testata.
 */

/** Timestamp come può presentarsi a runtime: stringa ISO o `Date` del driver. */
export type TimestampLike = string | Date | null | undefined;

/**
 * `Date` valida, o `null` per input assente/non parsabile. Mai lanciante: un
 * timestamp corrotto non deve poter far cadere un render.
 */
export function toDate(value: TimestampLike): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Millisecondi epoch, o `null` se il timestamp non è utilizzabile. */
export function toEpochMs(value: TimestampLike): number | null {
  return toDate(value)?.getTime() ?? null;
}

/** Stringa ISO completa (forma canonica di serializzazione), o `null`. */
export function toIsoString(value: TimestampLike): string | null {
  return toDate(value)?.toISOString() ?? null;
}

/**
 * Giorno nel formato `YYYY-MM-DD` atteso dai validatori PAN, ricavato dai
 * componenti **LOCALI** della data: il "giorno dell'operazione" di un registro
 * agronomico è quello dell'operatore, non quello UTC (alle 01:00 di un fuso
 * positivo `toISOString()` darebbe il giorno precedente). Stessa scelta, e
 * stessa motivazione, di `expiryStatus` nel Magazzino.
 */
export function toIsoDay(value: TimestampLike): string | null {
  const date = toDate(value);
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
