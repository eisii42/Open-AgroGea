/**
 * Mappatura PURA dei file di interscambio del Fascicolo Aziendale Grafico
 * (SIAN/AGEA) sui record di `campi_campagna`. Nessuna dipendenza da DuckDB/DOM:
 * solo decodifica di attributi e geometrie, testabile sotto `node --test`.
 *
 * Gli shapefile ministeriali non hanno uno schema di colonne unico (variano per
 * Regione/portale CAA), quindi la decodifica avviene per ALIAS robusti e
 * case-insensitive, evitando input testuali liberi: si estraggono solo i codici
 * rigidi, l'allineamento con i controlli AGEA non va corrotto.
 */
import type { Geometry } from "geojson";

/** Attributi grezzi di una feature dello shapefile (colonne .dbf). */
export type SianProperties = Record<string, unknown>;

/** Esito della decodifica di una feature ministeriale. */
export interface SianCampoMappato {
  reference_parcel_external_id: string | null;
  agricultural_parcel_external_id: string | null;
  crop_external_code: string | null;
  variety_external_code: string | null;
  /** Superficie dichiarata in ettari (4 decimali). */
  superficie_ha: number;
  /** Geometria del campo (null per i CSV/XML di interscambio senza poligoni). */
  geometria: Geometry | null;
}

/** Alias accettati per ciascun campo (in ordine di priorità), normalizzati. */
const ALIAS = {
  isola: ["reference_parcel_external_id", "id_isola", "cod_isola", "isola", "n_isola", "nisola"],
  appezzamento: [
    "agricultural_parcel_external_id",
    "id_appezz",
    "cod_appez",
    "cod_app",
    "id_app",
    "appezz",
    "appezzamento",
    "n_appezz",
  ],
  coltura: [
    "crop_external_code",
    "cod_prod",
    "cod_coltura",
    "coltura",
    "prodotto",
    "cod_uso",
    "uso_suolo",
  ],
  varieta: ["variety_external_code", "cod_var", "cod_varieta", "varieta", "var"],
  superficie: [
    "superficie_ha",
    "sup_ha",
    "supha",
    "ettari",
    "ha",
    "sup_dich",
    "superficie",
    "sup",
    "area_ha",
  ],
  superficieMq: ["area_mq", "area_m2", "sup_mq", "shape_area", "area"],
} as const;

function normalizza(chiave: string): string {
  return chiave.trim().toLowerCase().replace(/[\s.]+/g, "_");
}

/** Indice case-insensitive delle properties (chiave normalizzata → valore). */
function indicizza(props: SianProperties): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(props)) map.set(normalizza(k), v);
  return map;
}

/** Primo valore non vuoto tra gli alias dati. */
function pick(idx: Map<string, unknown>, alias: readonly string[]): unknown {
  for (const a of alias) {
    const v = idx.get(a);
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function asCodice(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Converte un numero possibilmente in formato italiano (virgola decimale,
 * separatori di migliaia) in number. Ritorna null se non interpretabile.
 */
export function numeroItaliano(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (s === "") return null;
  // "1.234,56" → "1234.56"; "1234,56" → "1234.56"; "12.34" resta "12.34".
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Arrotonda a 4 decimali (precisione di `superficie_ha` NUMERIC(8,4)). */
function arrotonda4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Risolve la superficie in ettari: priorità alla superficie DICHIARATA in ha
 * negli attributi; in mancanza, converte un'eventuale area in m²; come ultima
 * spiaggia usa l'area geodetica fornita (già in ha). Mai negativa.
 */
export function risolviSuperficieHa(
  props: SianProperties,
  areaGeodeticaHa?: number | null,
): number {
  const idx = indicizza(props);
  const dichiarata = numeroItaliano(pick(idx, ALIAS.superficie));
  if (dichiarata != null && dichiarata > 0) return arrotonda4(dichiarata);
  const mq = numeroItaliano(pick(idx, ALIAS.superficieMq));
  if (mq != null && mq > 0) return arrotonda4(mq / 10000);
  if (areaGeodeticaHa != null && areaGeodeticaHa > 0) {
    return arrotonda4(areaGeodeticaHa);
  }
  return 0;
}

/**
 * Decodifica una singola feature ministeriale in un record di campo-campagna.
 * @param areaGeodeticaHa Area calcolata (ha) come fallback per la superficie.
 */
export function mapSianFeature(
  props: SianProperties,
  geometria: Geometry | null,
  areaGeodeticaHa?: number | null,
): SianCampoMappato {
  const idx = indicizza(props);
  return {
    reference_parcel_external_id: asCodice(pick(idx, ALIAS.isola)),
    agricultural_parcel_external_id: asCodice(pick(idx, ALIAS.appezzamento)),
    crop_external_code: asCodice(pick(idx, ALIAS.coltura)),
    variety_external_code: asCodice(pick(idx, ALIAS.varieta)),
    superficie_ha: risolviSuperficieHa(props, areaGeodeticaHa),
    geometria,
  };
}

/**
 * Parser CSV minimale per i file di interscambio CAA (separatore `;` o `,`,
 * virgolette RFC-4180). Puro: niente DOM. Ritorna una riga di properties per
 * record, pronta per {@link mapSianFeature}.
 */
export function parseCsvRows(testo: string): SianProperties[] {
  const linee = testo
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l !== "");
  if (linee.length < 2) return [];
  const sep =
    (linee[0].match(/;/g)?.length ?? 0) >= (linee[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = splitLine(linee[0]).map((h) => h.trim());
  return linee.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: SianProperties = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

/** Vista minima di un appezzamento esistente per l'abbinamento. */
export interface AppezzamentoEsistente {
  id: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Decide se un campo ministeriale corrisponde a un appezzamento FISICO già
 * presente: l'abbinamento avviene per identificativo SIAN dell'appezzamento
 * (memorizzato in `metadata.agricultural_parcel_external_id` al primo import). Ritorna l'id
 * fisico esistente, o null se va creato un nuovo appezzamento.
 */
export function abbinaAppezzamentoEsistente(
  campo: Pick<SianCampoMappato, "agricultural_parcel_external_id">,
  esistenti: AppezzamentoEsistente[],
): string | null {
  if (!campo.agricultural_parcel_external_id) return null;
  for (const a of esistenti) {
    const sianId = a.metadata?.["agricultural_parcel_external_id"];
    if (typeof sianId === "string" && sianId === campo.agricultural_parcel_external_id) {
      return a.id;
    }
  }
  return null;
}
