/**
 * Country Resolution — risoluzione centralizzata del codice paese (`country_code`)
 * che governa regole burocratiche, cataloghi e adapter di export del tenant.
 *
 * Due sorgenti, in ordine di autorevolezza:
 *   1. **Anagrafica (primaria):** il paese impostato nell'indirizzo legale
 *      dell'azienda (`Company.paese`, ISO 3166-1 alpha-2).
 *   2. **Validazione spaziale (cross-check):** le coordinate reali dei poligoni
 *      degli plots. Se i campi cadono fuori dai confini nazionali
 *      dell'indirizzo, si emette un alert e/o si update il contesto normativo
 *      del singolo sotto-plot. Include il rilevamento rapido di
 *      coordinate invertite (lat/lon scambiate), causa comune di drift.
 *
 * Modulo **PURO**: nessun DOM/React, nessun accesso DB (accetta geometrie
 * GeoJSON, non rows di tabella). Sopravvive intatto al rename dello schema e
 * resta testabile sotto `node --test`.
 *
 * ## Tre insiemi di paesi, deliberatamente distinti
 *
 * Finora coincidevano tutti e tre in `IT|ES|FR`, quindi una sola unione bastava.
 * Con l'acquisizione delle particelle da fonti pubbliche europee un'azienda può
 * avere campi in un paese di cui non conosciamo né i confini né la burocrazia, e
 * i tre concetti divergono:
 *
 *   * {@link CountryCode} — **dove può stare un'azienda**: qualunque paese reale
 *     (ISO 3166-1 alpha-2), più la sentinella `EU` del fallback internazionale.
 *   * {@link CountryWithBbox} — **dove sappiamo verificare le coordinate**: i
 *     paesi di cui abbiamo il bounding box. Fuori da qui il cross-check spaziale
 *     si ASTIENE, non accusa (vedi {@link checkPlotCountry}).
 *   * {@link SUPPORTED_COUNTRIES} — **dove sappiamo produrre gli export
 *     normativi**: i paesi con un adapter nazionale dedicato.
 *
 * Tenerli separati è ciò che impedisce a un'azienda olandese di ricevere un
 * avviso "campi fuori dal paese dichiarato" solo perché non abbiamo (ancora) il
 * riquadro dei Paesi Bassi.
 */
import { type IsoAlpha2, isIsoAlpha2 } from "@agrogea/parcel";
import type { MultiPolygon, Polygon } from "geojson";
import { boundingBox, centroid } from "../geo/area";

/**
 * Paese di un'azienda: qualunque codice ISO 3166-1 alpha-2 assegnato, più `EU`
 * come fallback internazionale (nessun adapter nazionale dedicato → Base
 * Adapter, CSV ISO standard). `EU` non è un codice assegnato, quindi non
 * collide mai con un paese reale.
 */
export type CountryCode = IsoAlpha2 | "EU";

/**
 * Codici con un adapter nazionale dedicato di EXPORT (non il solo Base
 * internazionale). NON è l'insieme dei paesi in cui un'azienda può operare:
 * quello è {@link CountryCode}.
 */
export const SUPPORTED_COUNTRIES: readonly CountryCode[] = ["IT", "ES", "FR"];

/** Fallback usato quando né anagrafica né coordinate determinano un paese noto. */
export const DEFAULT_COUNTRY: CountryCode = "EU";

type Bbox = readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

/**
 * Paesi di cui conosciamo il bounding box, in ordine di precedenza: a parità di
 * sovrapposizione fra riquadri vince il primo, il che rende
 * {@link detectCountryAtPoint} deterministico. Aggiungere un paese qui obbliga
 * ad aggiungerne il riquadro a {@link COUNTRY_BBOXES} (lo impone il tipo).
 */
export const COUNTRIES_WITH_BBOX = ["IT", "ES", "FR"] as const;

/** Paese di cui sappiamo verificare l'appartenenza di un punto. */
export type CountryWithBbox = (typeof COUNTRIES_WITH_BBOX)[number];

/**
 * Bounding box nazionali approssimati in EPSG:4326 (lon/lat). Pensati per un
 * controllo di appartenenza rapido (point-in-bbox), non per confini esatti: un
 * paese può avere più riquadri (territori non contigui, es. Canarie, Corsica).
 * Sono volutamente generosi per non generare falsi positivi ai confini.
 *
 * Il `Record` è ESAUSTIVO su {@link CountryWithBbox}, non su {@link CountryCode}:
 * la copertura resta completa per i paesi che dichiariamo di saper verificare,
 * invece di diventare silenziosamente parziale su 249 codici.
 */
const COUNTRY_BBOXES: Record<CountryWithBbox, readonly Bbox[]> = {
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

/**
 * True se del paese conosciamo il bounding box, quindi il cross-check spaziale è
 * possibile. È il guardiano che separa "verificato fuori" da "non verificabile".
 */
export function hasCountryBbox(
  code: CountryCode | null | undefined,
): code is CountryWithBbox {
  return (
    code != null && (COUNTRIES_WITH_BBOX as readonly string[]).includes(code)
  );
}

/** True se il punto (lon, lat) cade in uno qualsiasi dei riquadri del paese. */
export function pointInCountry(
  lon: number,
  lat: number,
  code: CountryWithBbox,
): boolean {
  return COUNTRY_BBOXES[code].some((box) => inBbox(lon, lat, box));
}

/**
 * Paese il cui bounding box contiene il punto (lon, lat), o `null` se nessuno
 * dei paesi noti lo contiene. In caso di sovrapposizione vince l'ordine di
 * {@link COUNTRIES_WITH_BBOX} (deterministico).
 */
export function detectCountryAtPoint(
  lon: number,
  lat: number,
): CountryWithBbox | null {
  for (const code of COUNTRIES_WITH_BBOX) {
    if (pointInCountry(lon, lat, code)) return code;
  }
  return null;
}

/**
 * Normalizza una stringa paese (alpha-2, name o vuoto) in {@link CountryCode}.
 * Accetta qualunque codice ISO assegnato; gli alias per esteso restano solo per
 * i paesi con adapter nazionale dedicato, dove l'anagrafica storica può portare
 * il name scritto a mano. Ritorna `null` per ciò che non è un paese: stringa
 * vuota, refusi, codici user-assigned (`ZZ`, `AA`, `XA`–`XZ`).
 */
export function normalizeCountryCode(raw: string | null | undefined): CountryCode | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "ITALIA" || v === "ITALY") return "IT";
  if (v === "ESPAÑA" || v === "ESPANA" || v === "SPAIN") return "ES";
  if (v === "FRANCIA" || v === "FRANCE") return "FR";
  if (v === "EU" || v === "INT" || v === "INTERNATIONAL") return "EU";
  return isIsoAlpha2(v) ? v : null;
}

/** Sorgente che ha determinato il codice paese risolto. */
export type CountrySource = "address" | "coordinates" | "default";

/** Esito del cross-check spaziale di un singolo plot. */
export interface PlotCountryCheck {
  /** Identificativo opaco dell'appezzamento (passato dal chiamante). */
  plotId: string;
  /** Paese rilevato dalle coordinate, o `null` se fuori dai paesi noti. */
  detected: CountryWithBbox | null;
  /**
   * True se il punto cade dentro il paese dichiarato in anagrafica. Resta
   * `false` anche quando la verifica non è POSSIBILE (paese dichiarato di cui
   * non conosciamo il riquadro): significa "non verificato dentro", mai
   * "verificato fuori". Chi ne deriva un avviso deve prima interrogare
   * {@link hasCountryBbox} — vedi {@link resolveCountry}.
   */
  matchesDeclared: boolean;
  /**
   * True se le coordinate sembrano invertite (lat/lon scambiate): il punto è
   * fuori dal paese dichiarato così com'è, ma vi rientrerebbe scambiando gli assi.
   */
  swappedCoordinates: boolean;
}

/** Geometria di un plot con il suo id, input del cross-check. */
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
  /** Cross-check per plot (vuoto se non sono passate geometrie). */
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

/**
 * Cross-check di un singolo plot contro il paese dichiarato. Se del paese
 * dichiarato non conosciamo il riquadro, la verifica non viene tentata: entrambi
 * i flag restano `false` (nessuna conclusione), esattamente come quando non c'è
 * alcun paese dichiarato.
 */
export function checkPlotCountry(
  plot: PlotGeometry,
  declared: CountryCode | null,
): PlotCountryCheck {
  const [lon, lat] = centroid(plot.geometria);
  const detected = detectCountryAtPoint(lon, lat);
  const verifiable = hasCountryBbox(declared);
  const matchesDeclared = verifiable && pointInCountry(lon, lat, declared);
  // Inversione assi: fuori così com'è, ma dentro scambiando lon<->lat.
  const swappedCoordinates =
    verifiable && !matchesDeclared && pointInCountry(lat, lon, declared);
  return { plotId: plot.plotId, detected, matchesDeclared, swappedCoordinates };
}

/**
 * Risolve il `country_code` del tenant combinando l'anagrafica (primaria) e il
 * cross-check spaziale sulle geometrie degli plots.
 *
 * Logica:
 *   - se l'anagrafica indica un paese valido → è la sorgente autorevole;
 *   - altrimenti si tenta la rilevazione dalle coordinate (paese maggioritario
 *     fra gli plots);
 *   - altrimenti `fallback` (default {@link DEFAULT_COUNTRY}).
 *
 * In tutti i casi popola `checks`/`warnings` con le anomalie spaziali, così la
 * UI può alzare un alert o ricontestualizzare il singolo sotto-plot
 * senza cambiare il paese globale del tenant.
 */
export function resolveCountry(
  input: {
    /** Paese dell'indirizzo legale (ISO alpha-2 o name); `null` se assente. */
    addressCountry?: string | null;
    /** Geometrie degli plots per il cross-check (opzionale). */
    plots?: PlotGeometry[];
  },
  fallback: CountryCode = DEFAULT_COUNTRY,
): CountryResolution {
  const declared = normalizeCountryCode(input.addressCountry);
  const plots = input.plots ?? [];
  const checks = plots.map((p) => checkPlotCountry(p, declared));
  const warnings: CountryWarning[] = [];

  // Conteggio dei paesi rilevati dalle coordinate (per il voto di maggioranza).
  const tally = new Map<CountryWithBbox, number>();
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
  // Solo per i paesi di cui conosciamo il riquadro: senza bounding box non
  // possiamo affermare che un field sia "fuori", e l'avviso sarebbe un falso
  // positivo su OGNI azienda di un paese non ancora mappato.
  if (hasCountryBbox(declared)) {
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
 * Versione "per sotto-appezzamento": ritorna, per ciascun plot, il paese
 * che ne governa il contesto normativo. Un field fuori dal paese del tenant è
 * regolato dal paese in cui ricade davvero (se supportato), permettendo companies
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

/** Utility: bbox combinato di più plots (per inquadrare la mappa). */
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
