import type { VegetationIndex } from "../indices";
import type {
  IndexSeries,
  IndexSeriesPoint,
  SceneProvenance,
} from "./check-types";
import { daysBetween } from "./confidence";

/**
 * Operazioni pure sulla serie temporale degli indici: finestre, filtri di
 * qualità, cali e risalite, quota di giorni sopra soglia.
 *
 * Vivono qui e non dentro le singole schede perché sono la parte che decide
 * davvero gli esiti: se ogni scheda si scrivesse il proprio "calo di NDVI",
 * venti schede darebbero venti definizioni diverse della stessa cosa e il
 * confronto fra esiti non varrebbe nulla.
 */

/** Punti dentro una finestra `[from, to]`, estremi inclusi, ordinati per data. */
export function pointsInWindow(
  series: IndexSeries,
  from: string,
  to: string,
): IndexSeriesPoint[] {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return series.points
    .filter((p) => {
      const t = Date.parse(p.date);
      return !Number.isNaN(t) && t >= start && t <= end;
    })
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Punti UTILIZZABILI per un indice: quelli che quel valore ce l'hanno davvero,
 * con nuvolosità sotto la soglia e almeno un pixel valido.
 *
 * Il filtro sulla nuvolosità è un parametro della scheda, non una costante:
 * su una parcella grande si può essere severi, su una piccola in una stagione
 * piovosa si accetta di più — ed è l'utente a doverlo poter decidere, con il
 * numero sotto gli occhi.
 */
export function usablePoints(
  points: readonly IndexSeriesPoint[],
  index: VegetationIndex,
  maxCloudPct: number,
): IndexSeriesPoint[] {
  return points.filter((p) => {
    const value = p.values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (p.validPixels <= 0) return false;
    if (p.cloudCoverPct != null && p.cloudCoverPct > maxCloudPct) return false;
    return true;
  });
}

/** Valori di un indice, nell'ordine dei punti. */
export function valuesOf(
  points: readonly IndexSeriesPoint[],
  index: VegetationIndex,
): number[] {
  const out: number[] = [];
  for (const p of points) {
    const value = p.values[index];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function maxOf(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : Math.max(...values);
}

export function minOf(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : Math.min(...values);
}

/**
 * Quota di GIORNI (non di scene) in cui l'indice sta sopra una soglia, stimata
 * per interpolazione lineare fra punti consecutivi.
 *
 * Contare le scene invece dei giorni falserebbe il conto ogni volta che le
 * scene non sono equispaziate — cioè quasi sempre, perché le nuvole tolgono
 * proprio i giorni piovosi, che sono anche quelli in cui il suolo resta
 * scoperto più a lungo. Il metodo assume che fra due osservazioni l'indice
 * vari linearmente: è l'ipotesi minima, ed è dichiarata.
 */
export function daysAboveThresholdShare(
  points: readonly IndexSeriesPoint[],
  index: VegetationIndex,
  threshold: number,
): number {
  if (points.length < 2) return Number.NaN;
  let above = 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const span = daysBetween(points[i - 1].date, points[i].date);
    if (!Number.isFinite(span) || span <= 0) continue;
    const a = points[i - 1].values[index];
    const b = points[i].values[index];
    if (typeof a !== "number" || typeof b !== "number") continue;
    total += span;
    const aAbove = a >= threshold;
    const bAbove = b >= threshold;
    if (aAbove && bAbove) {
      above += span;
    } else if (aAbove !== bAbove) {
      // Attraversamento: la frazione di intervallo sopra soglia è la
      // proporzione lineare fino al punto d'incrocio.
      const crossing = (threshold - a) / (b - a);
      above += span * (aAbove ? crossing : 1 - crossing);
    }
  }
  return total <= 0 ? Number.NaN : above / total;
}

/** Un calo brusco fra due osservazioni consecutive: la firma di un evento. */
export interface SeriesDrop {
  fromDate: string;
  toDate: string;
  fromValue: number;
  toValue: number;
  /** Ampiezza del calo (positiva). */
  delta: number;
  /** Giorni fra le due osservazioni: più sono, meno l'evento è databile. */
  spanDays: number;
  /** Scene coinvolte, per la provenienza. */
  sceneIds: [string, string];
}

/**
 * Cali dell'indice maggiori di `minDelta` fra osservazioni consecutive.
 *
 * È il rilevatore condiviso di "è successo qualcosa": uno sfalcio, una
 * lavorazione, un raccolto, una bruciatura. Che cosa sia stato lo decide la
 * scheda dal contesto (stagione, coltura, ripresa successiva) — questo strato
 * si limita a trovare il gradino, e a dire quanto era largo l'intervallo in cui
 * è avvenuto, perché è quello a determinare se l'evento è databile o no.
 */
export function detectDrops(
  points: readonly IndexSeriesPoint[],
  index: VegetationIndex,
  minDelta: number,
): SeriesDrop[] {
  const drops: SeriesDrop[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const a = previous.values[index];
    const b = current.values[index];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const delta = a - b;
    if (delta < minDelta) continue;
    drops.push({
      fromDate: previous.date,
      toDate: current.date,
      fromValue: a,
      toValue: b,
      delta,
      spanDays: daysBetween(previous.date, current.date),
      sceneIds: [previous.sceneId, current.sceneId],
    });
  }
  return drops;
}

/**
 * Cali seguiti da una risalita entro `recoveryDays`: distingue uno SFALCIO (la
 * cotica ricresce) da un cambio d'uso o da un raccolto di fine ciclo (che non
 * ricresce). È la differenza fra la D1 e la B6, e sta qui perché è la stessa
 * osservazione letta con due domande diverse.
 */
export function dropsWithRecovery(
  points: readonly IndexSeriesPoint[],
  index: VegetationIndex,
  minDelta: number,
  recoveryDays: number,
  recoveryShare = 0.6,
): SeriesDrop[] {
  const all = detectDrops(points, index, minDelta);
  return all.filter((drop) => {
    const target = drop.toValue + drop.delta * recoveryShare;
    return points.some((p) => {
      const value = p.values[index];
      if (typeof value !== "number") return false;
      const gap = daysBetween(drop.toDate, p.date);
      return gap > 0 && gap <= recoveryDays && value >= target;
    });
  });
}

/** Provenienza delle scene di una lista di punti (una riga per scena). */
export function provenanceOf(
  points: readonly IndexSeriesPoint[],
): SceneProvenance[] {
  const seen = new Set<string>();
  const out: SceneProvenance[] = [];
  for (const p of points) {
    if (seen.has(p.sceneId)) continue;
    seen.add(p.sceneId);
    out.push({
      sceneId: p.sceneId,
      sensedAt: p.date,
      collection: p.collection,
      gsdM: p.gsdM,
      cloudCoverPct: p.cloudCoverPct,
      validPixels: p.validPixels,
    });
  }
  return out;
}

/** Annate distinte coperte dalla serie: profondità reale dell'archivio. */
export function archiveYears(series: IndexSeries): number {
  const years = new Set<number>();
  for (const p of series.points) {
    const year = Number(p.date.slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }
  return years.size;
}

/** Finestra `[from, to]` di un'annata solare. */
export function calendarYearWindow(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Finestra di più annate che termina con quella osservata. Serve alle schede
 * pluriennali (rotazione, prati permanenti, EUDR) e rende esplicito quante
 * annate di archivio quella scheda pretende.
 */
export function multiYearWindow(
  year: number,
  years: number,
): { from: string; to: string } {
  const first = year - Math.max(1, years) + 1;
  return { from: `${first}-01-01`, to: `${year}-12-31` };
}
