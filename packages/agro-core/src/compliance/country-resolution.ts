/**
 * Country Resolution — risoluzione centralizzata del codice paese (`country_code`)
 * che governa regole burocratiche, cataloghi e adapter di export del tenant.
 *
 * Due sorgenti, in ordine di autorevolezza:
 *   1. **Anagrafica (primaria):** il paese impostato nell'indirizzo legale
 *      dell'azienda (`Company.paese`, ISO 3166-1 alpha-2).
 *   2. **Validazione spaziale (cross-check):** le coordinate reali dei poligoni
 *      degli appezzamenti. Se i campi cadono fuori dai confini nazionali
 *      dell'indirizzo, si emette un alert e/o si aggiorna il contesto normativo
 *      del singolo sotto-appezzamento. Include il rilevamento rapido di
 *      coordinate invertite (lat/lon scambiate), causa comune di drift.
 *
 * Modulo **PURO**: nessun DOM/React, nessun accesso DB (accetta geometrie
 * GeoJSON, non righe di tabella). Sopravvive intatto al rename dello schema e
 * resta testabile sotto `node --test`.
 */
import type { MultiPolygon, Polygon } from "geojson";
import { boundingBox, centroid } from "../geo/area";

/**
 * Codici paese supportati dagli adapter regionali (ISO 3166-1 alpha-2), più il
 * fallback internazionale `EU` per i tenant fuori dai paesi con adapter dedicato
 * (usa il Base Adapter: CSV ISO standard).
 */
export type CountryCode = "IT" | "ES" | "FR" | "EU";

/** Codici con un adapter nazionale dedicato (non il solo Base internazionale). */
export const SUPPORTED_COUNTRIES: readonly CountryCode[] = ["IT", "ES", "FR"];

/** Fallback usato quando né anagrafica né coordinate determinano un paese noto. */
export const DEFAULT_COUNTRY: CountryCode = "EU";

type Bbox = readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

/**
 * Bounding box nazionali approssimati in EPSG:4326 (lon/lat). Pensati per un
 * controllo di appartenenza rapido (point-in-bbox), non per confini esatti: un
 * paese può avere più riquadri (territori non contigui, es. Canarie, Corsica).
 * Sono volutamente generosi per non generare falsi positivi ai confini.
 */
const COUNTRY_BBOXES: Record<Exclude<CountryCode, "EU">, readonly Bbox[]> = {
  // Penisola + isole maggiori (Sicilia, Sardegna).
  IT: [[6.6, 35.3, 18.8, 47.1]],
  // Penisola iberica + Baleari, e a parte le Isole Canarie.
  ES: [
    [-9.6, 35.8, 4.4, 43.9],
    [-18.3, 27.5, -13.3, 29.5],
  ],
  // Francia metropolitana + Corsica.
  FR: [[-5.3, 41.2, 9.7, 51.2]],
};

function inBbox(lon: number, lat: number, box: Bbox): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/** True se il punto (lon, lat) cade in uno qualsiasi dei riquadri del paese. */
export function pointInCountry(
  lon: number,
  lat: number,
  code: Exclude<CountryCode, "EU">,
): boolean {
  return COUNTRY_BBOXES[code].some((box) => inBbox(lon, lat, box));
}

/**
 * Paese il cui bounding box contiene il punto (lon, lat), o `null` se nessuno
 * dei paesi supportati lo contiene. In caso di sovrapposizione vince l'ordine di
 * {@link SUPPORTED_COUNTRIES} (deterministico).
 */
export function detectCountryAtPoint(
  lon: number,
  lat: number,
): Exclude<CountryCode, "EU"> | null {
  for (const code of SUPPORTED_COUNTRIES) {
    if (code !== "EU" && pointInCountry(lon, lat, code)) return code;
  }
  return null;
}

/** Normalizza una stringa paese (alpha-2, nome o vuoto) in {@link CountryCode}. */
export function normalizeCountryCode(raw: string | null | undefined): CountryCode | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "IT" || v === "ITALIA" || v === "ITALY") return "IT";
  if (v === "ES" || v === "ESPAÑA" || v === "ESPANA" || v === "SPAIN") return "ES";
  if (v === "FR" || v === "FRANCIA" || v === "FRANCE") return "FR";
  if (v === "EU" || v === "INT" || v === "INTERNATIONAL") return "EU";
  return null;
}

/** Sorgente che ha determinato il codice paese risolto. */
export type CountrySource = "address" | "coordinates" | "default";

/** Esito del cross-check spaziale di un singolo appezzamento. */
export interface PlotCountryCheck {
  /** Identificativo opaco dell'appezzamento (passato dal chiamante). */
  plotId: string;
  /** Paese rilevato dalle coordinate, o `null` se fuori dai paesi noti. */
  detected: Exclude<CountryCode, "EU"> | null;
  /** True se il punto cade dentro il paese dichiarato in anagrafica. */
  matchesDeclared: boolean;
  /**
   * True se le coordinate sembrano invertite (lat/lon scambiate): il punto è
   * fuori dal paese dichiarato così com'è, ma vi rientrerebbe scambiando gli assi.
   */
  swappedCoordinates: boolean;
}

/** Geometria di un appezzamento con il suo id, input del cross-check. */
export interface PlotGeometry {
  plotId: string;
  geometria: Polygon | MultiPolygon;
}

/** Esito complessivo della risoluzione del paese del tenant. */
export interface CountryResolution {
  /** Codice paese che governa regole/cataloghi/export. */
  countryCode: CountryCode;
  /** Da dove proviene il codice risolto. */
  source: CountrySource;
  /** Paese dell'anagrafica (se impostato e valido). */
  declared: CountryCode | null;
  /** Cross-check per appezzamento (vuoto se non sono passate geometrie). */
  checks: PlotCountryCheck[];
  /**
   * Avvisi informativi per la UI (i18n key + parametri), es. campi fuori
   * confine o coordinate invertite. Vuoto = nessuna anomalia.
   */
  warnings: CountryWarning[];
}

/** Avviso strutturato, risolvibile in stringa dal layer i18n della UI. */
export interface CountryWarning {
  /** Chiave i18n (namespace `compliance`). */
  key:
    | "compliance.warning.noCountryResolved"
    | "compliance.warning.plotsOutsideCountry"
    | "compliance.warning.swappedCoordinates"
    | "compliance.warning.addressCoordsMismatch";
  /** Parametri di interpolazione per la stringa tradotta. */
  params?: Record<string, string | number>;
}

/** Cross-check di un singolo appezzamento contro il paese dichiarato. */
export function checkPlotCountry(
  plot: PlotGeometry,
  declared: CountryCode | null,
): PlotCountryCheck {
  const [lon, lat] = centroid(plot.geometria);
  const detected = detectCountryAtPoint(lon, lat);
  const matchesDeclared =
    declared != null && declared !== "EU" && pointInCountry(lon, lat, declared);
  // Inversione assi: fuori così com'è, ma dentro scambiando lon<->lat.
  const swappedCoordinates =
    !matchesDeclared &&
    declared != null &&
    declared !== "EU" &&
    pointInCountry(lat, lon, declared);
  return { plotId: plot.plotId, detected, matchesDeclared, swappedCoordinates };
}

/**
 * Risolve il `country_code` del tenant combinando l'anagrafica (primaria) e il
 * cross-check spaziale sulle geometrie degli appezzamenti.
 *
 * Logica:
 *   - se l'anagrafica indica un paese valido → è la sorgente autorevole;
 *   - altrimenti si tenta la rilevazione dalle coordinate (paese maggioritario
 *     fra gli appezzamenti);
 *   - altrimenti `fallback` (default {@link DEFAULT_COUNTRY}).
 *
 * In tutti i casi popola `checks`/`warnings` con le anomalie spaziali, così la
 * UI può alzare un alert o ricontestualizzare il singolo sotto-appezzamento
 * senza cambiare il paese globale del tenant.
 */
export function resolveCountry(
  input: {
    /** Paese dell'indirizzo legale (ISO alpha-2 o nome); `null` se assente. */
    addressCountry?: string | null;
    /** Geometrie degli appezzamenti per il cross-check (opzionale). */
    plots?: PlotGeometry[];
  },
  fallback: CountryCode = DEFAULT_COUNTRY,
): CountryResolution {
  const declared = normalizeCountryCode(input.addressCountry);
  const plots = input.plots ?? [];
  const checks = plots.map((p) => checkPlotCountry(p, declared));
  const warnings: CountryWarning[] = [];

  // Conteggio dei paesi rilevati dalle coordinate (per il voto di maggioranza).
  const tally = new Map<Exclude<CountryCode, "EU">, number>();
  for (const c of checks) {
    if (c.detected) tally.set(c.detected, (tally.get(c.detected) ?? 0) + 1);
  }
  const majority = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Avvisi spaziali (indipendenti dalla sorgente scelta).
  const swapped = checks.filter((c) => c.swappedCoordinates);
  if (swapped.length > 0) {
    warnings.push({
      key: "compliance.warning.swappedCoordinates",
      params: { count: swapped.length },
    });
  }
  if (declared && declared !== "EU") {
    const outside = checks.filter(
      (c) => !c.matchesDeclared && !c.swappedCoordinates,
    );
    if (outside.length > 0) {
      warnings.push({
        key: "compliance.warning.plotsOutsideCountry",
        params: {
          count: outside.length,
          country: declared,
          detected: majority ?? "—",
        },
      });
    }
  }

  // Selezione della sorgente.
  if (declared) {
    return { countryCode: declared, source: "address", declared, checks, warnings };
  }
  if (majority) {
    warnings.push({
      key: "compliance.warning.addressCoordsMismatch",
      params: { detected: majority },
    });
    return {
      countryCode: majority,
      source: "coordinates",
      declared: null,
      checks,
      warnings,
    };
  }
  warnings.push({ key: "compliance.warning.noCountryResolved" });
  return { countryCode: fallback, source: "default", declared: null, checks, warnings };
}

/**
 * Versione "per sotto-appezzamento": ritorna, per ciascun appezzamento, il paese
 * che ne governa il contesto normativo. Un campo fuori dal paese del tenant è
 * regolato dal paese in cui ricade davvero (se supportato), permettendo aziende
 * transfrontaliere. Usa il bounding box, quindi è rapido e privo di dipendenze.
 */
export function resolvePerPlotCountry(
  tenantCountry: CountryCode,
  plots: PlotGeometry[],
): Map<string, CountryCode> {
  const out = new Map<string, CountryCode>();
  for (const p of plots) {
    const [lon, lat] = centroid(p.geometria);
    const detected = detectCountryAtPoint(lon, lat);
    out.set(p.plotId, detected ?? tenantCountry);
  }
  return out;
}

/** Utility: bbox combinato di più appezzamenti (per inquadrare la mappa). */
export function plotsBoundingBox(
  plots: PlotGeometry[],
): [number, number, number, number] | null {
  if (plots.length === 0) return null;
  let [minLon, minLat, maxLon, maxLat] = boundingBox(plots[0].geometria);
  for (const p of plots.slice(1)) {
    const [a, b, c, d] = boundingBox(p.geometria);
    minLon = Math.min(minLon, a);
    minLat = Math.min(minLat, b);
    maxLon = Math.max(maxLon, c);
    maxLat = Math.max(maxLat, d);
  }
  return [minLon, minLat, maxLon, maxLat];
}
