/**
 * Parser CSV minimale (RFC4180-ish), scritto ad-hoc per restare 100% offline
 * (nessuna dipendenza npm) e condiviso da tutti gli import dell'app (mezzi,
 * prodotti di magazzino).
 *
 * Gestisce campi tra virgolette — con separatore e a-capo incorporati, `""`
 * come escape della virgoletta — CRLF/LF, il BOM UTF-8 che Excel antepone al
 * file e il separatore `;` degli export Excel in locale italiano.
 */

/** Separatori riconosciuti, in ordine di verifica. */
const DELIMITERS = [";", ",", "\t"] as const;

export type CsvDelimiter = (typeof DELIMITERS)[number];

export interface CsvDocument {
  /** Righe come celle grezze (stringhe), intestazione inclusa. */
  rows: string[][];
  /** Separatore riconosciuto: serve a interpretare i decimali (vedi csvNumber). */
  delimiter: CsvDelimiter;
}

/** Toglie il BOM UTF-8: senza, la prima intestazione non combacia mai. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Separatore del file: quello che compare più spesso nella PRIMA riga fuori
 * dalle virgolette. Un'intestazione di una sola colonna non ne ha nessuno e
 * ricade sulla virgola, che non cambia nulla nel risultato.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let best: CsvDelimiter = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === delimiter && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Analizza il testo CSV. Il separatore si riconosce dall'intestazione, salvo
 * indicarlo esplicitamente. Le righe completamente vuote sono scartate.
 */
export function parseCsv(text: string, forced?: CsvDelimiter): CsvDocument {
  const source = stripBom(text);
  const delimiter = forced ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return {
    rows: rows.filter((r) => !(r.length === 1 && r[0].trim() === "")),
    delimiter,
  };
}

/** Intestazione normalizzata (minuscola, senza spazi) → indice di colonna. */
export function csvHeaderIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

/** Cella trimmata (stringa vuota se la colonna manca o la riga è più corta). */
export function csvCell(cells: string[], column: number | undefined): string {
  return column != null && column >= 0 && column < cells.length
    ? cells[column].trim()
    : "";
}

/**
 * Numero da una cella. Con separatore `;` (l'export Excel in italiano) la
 * virgola è il separatore DECIMALE e il punto quello delle migliaia; con `,`
 * come separatore di colonna il decimale può essere solo il punto. Restituisce
 * `null` per cella vuota e `NaN` per un valore non numerico, così il chiamante
 * distingue "assente" da "sbagliato".
 */
export function csvNumber(
  raw: string,
  delimiter: CsvDelimiter,
): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const normalized =
    delimiter === ","
      ? value.replace(/\s/g, "")
      : value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}
