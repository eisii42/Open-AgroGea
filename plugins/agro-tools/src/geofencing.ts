/**
 * Motore PURO del geofencing GPS della flow low-touch a bordo campo:
 * rilevamento dell'ingresso/uscita da un appezzamento con debounce a
 * permanenza minima (dwell) e isteresi d'uscita (exit grace) per non far
 * scattare la modale di rilevamento a ogni singolo jitter del GPS vicino al
 * confine, più le utility geometriche/cinematiche (distanza, velocità,
 * lunghezza tracciato, superficie lavorata) che il tracking GPS della Modalità Campo
 * riusa. Nessun accesso al DOM/rete/`navigator`: il wrapper su
 * `watchPosition` vive nell'app (`services/geofencing/geofence-watcher.ts`),
 * qui c'è solo il riduttore deterministico stato+campione ⇒ nuovo stato+evento,
 * testato in isolamento come gli altri engine di `@agrogea/tools`.
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { MultiPolygon, Polygon, Position } from "geojson";

// ---------------------------------------------------------------------------
// Tipi di dominio
// ---------------------------------------------------------------------------

/** Campione GPS grezzo (da `GeolocationPosition` o iniettato nei test). */
export interface GeoSample {
  lat: number;
  lon: number;
  /** Raggio di accuratezza in metri dichiarato dal chip GPS; null se ignoto. */
  accuracy_m?: number | null;
  /** Timestamp del campione in epoch millis. */
  timestamp: number;
}

/**
 * Appezzamento nella forma minima necessaria al geofencing (strutturalmente
 * compatibile con `Plot` di `@agrogea/core`, MAI importato qui: il pacchetto
 * resta framework-free e non dipende dal core).
 */
export interface GeofencePlot {
  id: string;
  name: string;
  geometry: Polygon | MultiPolygon;
  area_ha?: number | null;
}

// ---------------------------------------------------------------------------
// Point-in-polygon con prefiltro bbox
// ---------------------------------------------------------------------------

/** Anelli (esterno + eventuali buchi) di ogni poligono componente la geometria. */
function polygonRings(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

/**
 * Bounding box [minLon, minLat, maxLon, maxLat] calcolato inline (nessuna
 * dipendenza in più: è una semplice riduzione delle coordinate). Ritorna un
 * bbox "vuoto" (min > max) se la geometria non ha coordinate — il prefiltro
 * la scarta sempre, coerente con `plotContainingPoint` che ignora gli
 * appezzamenti privi di anelli validi.
 */
function geometryBbox(
  geometry: Polygon | MultiPolygon,
): [number, number, number, number] {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const ring of polygonRings(geometry)) {
    for (const points of ring) {
      for (const [lon, lat] of points) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function pointInBbox(
  lon: number,
  lat: number,
  bbox: [number, number, number, number],
): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * Appezzamento che contiene il punto del campione: prefiltro bbox (economico,
 * scarta subito la maggior parte degli appezzamenti lontani) poi
 * point-in-polygon ESATTO col poligono reale — il bbox da solo produrrebbe
 * falsi positivi per un punto dentro l'angolo del rettangolo ma fuori dal
 * perimetro irregolare del field. `null` se il punto non è dentro alcun
 * appezzamento (o se nessuno ha una geometria valida).
 */
export function plotContainingPoint(
  sample: GeoSample,
  plots: GeofencePlot[],
): GeofencePlot | null {
  for (const plot of plots) {
    const bbox = geometryBbox(plot.geometry);
    if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) continue; // geometria senza coordinate
    if (!pointInBbox(sample.lon, sample.lat, bbox)) continue;
    if (booleanPointInPolygon([sample.lon, sample.lat], plot.geometry)) {
      return plot;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Riduttore di geofencing: dwell debounce + isteresi d'uscita
// ---------------------------------------------------------------------------

export interface GeofenceState {
  /** Appezzamento CONFERMATO (permanenza minima superata). */
  insidePlotId: string | null;
  /** Appezzamento candidato, in attesa di conferma. */
  candidatePlotId: string | null;
  /** Timestamp del primo campione consecutivo dentro il candidato. */
  candidateSince: number | null;
  /** Timestamp del primo campione fuori dal confermato (isteresi d'uscita). */
  outsideSince: number | null;
}

export type GeofenceEvent =
  | { kind: "enter"; plotId: string; at: number }
  | { kind: "exit"; plotId: string; at: number }
  | null;

export interface GeofenceOptions {
  /** Secondi di permanenza continuativa per confermare l'ingresso (default 15). */
  dwellSeconds?: number;
  /** Secondi fuori perimetro per confermare l'uscita — isteresi anti-jitter (default 30). */
  exitGraceSeconds?: number;
  /** Accuratezza GPS massima accettata in metri: i campioni peggiori sono scartati (default 50). */
  maxAccuracyM?: number;
}

export const GEOFENCE_DEFAULTS: Required<GeofenceOptions> = {
  dwellSeconds: 15,
  exitGraceSeconds: 30,
  maxAccuracyM: 50,
};

export function initialGeofenceState(): GeofenceState {
  return {
    insidePlotId: null,
    candidatePlotId: null,
    candidateSince: null,
    outsideSince: null,
  };
}

/**
 * Riduttore PURO: stato + campione ⇒ nuovo stato + evento eventuale.
 *
 * Semantica:
 *   * un campione con `accuracy_m` peggiore di `maxAccuracyM` è SCARTATO: lo
 *     stato torna invariato e non emette alcun evento (nemmeno un reset del
 *     candidato — un campione impreciso non deve azzerare un dwell in corso);
 *   * senza appezzamento confermato: un campione dentro un plot avvia/mantiene
 *     un candidato; un campione fuori da quel plot (altro plot o fuori da
 *     tutti) AZZERA il candidato e, se il nuovo campione è comunque dentro un
 *     plot diverso, ne avvia subito uno nuovo (stesso campione, non serve
 *     "sprecarne" uno per il solo reset) — così il timer "riparte da zero"
 *     come richiesto, senza un giro a vuoto in più;
 *   * superata la soglia `dwellSeconds` sul candidato current, questo diventa
 *     `insidePlotId` ed emette ESATTAMENTE un evento `enter`; i campioni
 *     successivi dentro lo stesso plot non emettono altro;
 *   * con un appezzamento confermato, un campione fuori da quel plot avvia
 *     `outsideSince` (isteresi) invece di uscire subito: il jitter di un
 *     singolo campione non fa scattare `exit`. Un campione di nuovo dentro
 *     AZZERA `outsideSince` senza evento. Solo dopo `exitGraceSeconds`
 *     sostenuti fuori scatta `exit`;
 *   * transizione diretta A→B (senza sostare fuori da entrambi): l'uscita da A
 *     (dopo la grazia) e l'ingresso in B sono comunque due eventi separati nel
 *     tempo — questa implementazione emette PRIMA `exit` di A (al superamento
 *     della grazia) e, nello stesso passo, avvia già il candidato per B usando
 *     il campione corrente come primo campione del suo dwell (nessun campione
 *     sprecato); l'eventuale `enter` di B arriva solo dopo un dwell pieno
 *     successivo, mai nello stesso passo dell'`exit` (un solo evento per
 *     chiamata).
 */
export function advanceGeofence(
  state: GeofenceState,
  sample: GeoSample,
  plots: GeofencePlot[],
  options: GeofenceOptions = {},
): { state: GeofenceState; event: GeofenceEvent } {
  const dwellSeconds = options.dwellSeconds ?? GEOFENCE_DEFAULTS.dwellSeconds;
  const exitGraceSeconds =
    options.exitGraceSeconds ?? GEOFENCE_DEFAULTS.exitGraceSeconds;
  const maxAccuracyM = options.maxAccuracyM ?? GEOFENCE_DEFAULTS.maxAccuracyM;

  if (sample.accuracy_m != null && sample.accuracy_m > maxAccuracyM) {
    return { state, event: null };
  }

  const found = plotContainingPoint(sample, plots);

  // -- caso A: c'è già un appezzamento CONFERMATO -----------------------------
  if (state.insidePlotId != null) {
    if (found?.id === state.insidePlotId) {
      // Ancora dentro: azzera un'eventuale isteresi d'uscita in corso.
      if (state.outsideSince == null) return { state, event: null };
      return {
        state: { ...state, outsideSince: null },
        event: null,
      };
    }

    // Campione fuori dal plot confermato (altro plot, o nessuno): isteresi.
    if (state.outsideSince == null) {
      return {
        state: { ...state, outsideSince: sample.timestamp },
        event: null,
      };
    }
    const outsideElapsedMs = sample.timestamp - state.outsideSince;
    if (outsideElapsedMs < exitGraceSeconds * 1000) {
      return { state, event: null };
    }

    // Grazia superata: uscita confermata. Nello stesso passo si avvia già
    // (senza sprecare il campione) il candidato per il plot eventualmente
    // trovato ora — il suo `enter` arriverà solo a un dwell futuro pieno.
    const exitedPlotId = state.insidePlotId;
    return {
      state: {
        insidePlotId: null,
        candidatePlotId: found?.id ?? null,
        candidateSince: found ? sample.timestamp : null,
        outsideSince: null,
      },
      event: { kind: "exit", plotId: exitedPlotId, at: sample.timestamp },
    };
  }

  // -- caso B: nessun appezzamento confermato — logica di candidato/dwell -----
  if (!found) {
    if (state.candidatePlotId == null) return { state, event: null };
    return {
      state: { ...state, candidatePlotId: null, candidateSince: null },
      event: null,
    };
  }

  if (state.candidatePlotId === found.id && state.candidateSince != null) {
    const dwellElapsedMs = sample.timestamp - state.candidateSince;
    if (dwellElapsedMs < dwellSeconds * 1000) {
      return { state, event: null };
    }
    return {
      state: {
        insidePlotId: found.id,
        candidatePlotId: null,
        candidateSince: null,
        outsideSince: null,
      },
      event: { kind: "enter", plotId: found.id, at: sample.timestamp },
    };
  }

  // Nuovo candidato (primo campione dentro, oppure cambio di plot candidato).
  return {
    state: {
      ...state,
      candidatePlotId: found.id,
      candidateSince: sample.timestamp,
    },
    event: null,
  };
}

/**
 * Secondi ancora necessari a confermare il candidato (countdown per la UI);
 * `null` se non c'è un candidato in corso. Raggiunge 0 esattamente al
 * campione che confermerebbe l'ingresso.
 */
export function dwellRemainingSeconds(
  state: GeofenceState,
  now: number,
  options: GeofenceOptions = {},
): number | null {
  if (state.candidatePlotId == null || state.candidateSince == null) {
    return null;
  }
  const dwellSeconds = options.dwellSeconds ?? GEOFENCE_DEFAULTS.dwellSeconds;
  const elapsedMs = now - state.candidateSince;
  const remainingMs = dwellSeconds * 1000 - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

// ---------------------------------------------------------------------------
// Cinematica: distanza, velocità, lunghezza tracciato, superficie lavorata
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distanza geodetica (formula dell'emisenoverso) in metri tra due punti. */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Velocità istantanea in km/h tra due campioni consecutivi; `null` se il
 * Δt non è utilizzabile (non positivo, non finito — campioni fuori ordine o
 * duplicati per timestamp).
 */
export function speedKmh(
  previous: GeoSample,
  current: GeoSample,
): number | null {
  const deltaSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
  const meters = haversineMeters(previous, current);
  const metersPerSecond = meters / deltaSeconds;
  return metersPerSecond * 3.6;
}

/** Lunghezza geodetica del tracciato in metri (somma dei segmenti consecutivi). */
export function pathLengthMeters(coordinates: Position[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lonA, latA] = coordinates[i - 1];
    const [lonB, latB] = coordinates[i];
    total += haversineMeters({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
  }
  return total;
}

/**
 * Superficie lavorata stimata dal tracciato: lunghezza × larghezza di lavoro
 * (convenzione FMIS: il tracciato del centro macchina "spazza" una fascia
 * larga quanto l'attrezzo). Senza una larghezza di lavoro valida (assente o
 * ≤ 0) il calcolo non è possibile e ritorna 0 — nessuna stima fuorviante.
 * Clampata alla superficie dell'appezzamento quando nota: le sovrapposizioni
 * fra passate (headland, manovre) non possono gonfiare il dato oltre il
 * field reale.
 */
export function workedAreaHectares(
  coordinates: Position[],
  workingWidthM: number | null | undefined,
  plotAreaHa?: number | null,
): number {
  if (!workingWidthM || workingWidthM <= 0) return 0;
  const lengthM = pathLengthMeters(coordinates);
  const areaM2 = lengthM * workingWidthM;
  let areaHa = areaM2 / 10_000;
  if (plotAreaHa != null && plotAreaHa >= 0) {
    areaHa = Math.min(areaHa, plotAreaHa);
  }
  return Math.round(areaHa * 1e4) / 1e4;
}
