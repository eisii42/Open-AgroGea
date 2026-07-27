/**
 * Helper di conversione dei timestamp, per i confini in cui la forma del value
 * non è garantita.
 *
 * NON servono per le rows lette dal data plane locale: quelle sono già
 * normalizzate in uscita dal DAL (vedi `db/row-mapping.ts`), quindi un
 * `TreatmentLog.executed_at` è davvero la stringa ISO che il tipo dichiara.
 * Restano utili dove il value arriva da FUORI quel confine — input di form,
 * payload importati, parametri di funzioni pure che accettano più forme — e
 * dove serve derivare un giorno o dei millisecondi senza ripetere lo stesso
 * `new Date(...)` difensivo ovunque.
 *
 * Nessuno lancia: un timestamp malformato ritorna `null`, non fa cadere un
 * render.
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
