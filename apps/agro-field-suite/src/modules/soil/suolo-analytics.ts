/**
 * Analitiche pure del Modulo Suolo (testabili sotto Node).
 *
 *  * incrocio NDVI ↔ chimica del suolo per lo scatter plot del pannello Charts;
 *  * funzione di prescrizione a rateo variabile (VRA) per la zonazione H3
 *    (alimenta `SpatialAnalysisEngine.zonateH3`);
 *  * costruttori della sorgente di clustering nativo MapLibre per i POI.
 *
 * Nessuna dipendenza da React/MapLibre/DuckDB: solo dati e matematica.
 */
import type { Appezzamento, CampionamentoSuolo } from "@agrogea/core";

/** Variabili chimiche del campionamento usabili come asse X dello scatter. */
export type VariabileSuolo =
  | "ph"
  | "organic_matter"
  | "nitrogen"
  | "phosphorus"
  | "potassium";

export const ETICHETTE_VARIABILE: Record<VariabileSuolo, string> = {
  ph: "pH",
  organic_matter: "Sostanza organica (%)",
  nitrogen: "Azoto (N)",
  phosphorus: "Fosforo (P)",
  potassium: "Potassio (K)",
};

/** Un punto dello scatter: chimica del suolo (X) vs ultimo NDVI medio (Y). */
export interface PuntoScatterSuolo {
  appezzamentoId: string;
  nome: string;
  /** Media della variabile chimica sui campionamenti dell'appezzamento. */
  x: number;
  /** Ultimo NDVI medio dell'appezzamento (cache STAC). */
  y: number;
  /** Numero di campionamenti che concorrono alla media X. */
  n: number;
}

function media(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Media per appezzamento di una variabile chimica (ignora i valori nulli). */
export function mediaCampionamentiPerAppezzamento(
  campionamenti: CampionamentoSuolo[],
  variabile: VariabileSuolo,
): Map<string, { media: number; n: number }> {
  const byApz = new Map<string, number[]>();
  for (const c of campionamenti) {
    if (c.plot_id == null || c.deleted_at != null) continue;
    const value = c[variabile];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    const list = byApz.get(c.plot_id) ?? [];
    list.push(value);
    byApz.set(c.plot_id, list);
  }
  const out = new Map<string, { media: number; n: number }>();
  for (const [id, values] of byApz) {
    const m = media(values);
    if (m != null) out.set(id, { media: m, n: values.length });
  }
  return out;
}

/**
 * Costruisce i punti dello scatter NDVI ↔ chimica: un punto per appezzamento
 * che abbia sia l'ultimo NDVI medio sia almeno un campionamento valido della
 * variabile scelta.
 */
export function buildNdviScatter(
  appezzamenti: Appezzamento[],
  campionamenti: CampionamentoSuolo[],
  variabile: VariabileSuolo,
): PuntoScatterSuolo[] {
  const medie = mediaCampionamentiPerAppezzamento(campionamenti, variabile);
  const punti: PuntoScatterSuolo[] = [];
  for (const apz of appezzamenti) {
    const ndvi = apz.last_ndvi_mean;
    const chim = medie.get(apz.id);
    if (ndvi == null || Number.isNaN(ndvi) || !chim) continue;
    punti.push({
      appezzamentoId: apz.id,
      nome: apz.user_plot_name,
      x: Math.round(chim.media * 1000) / 1000,
      y: Math.round(ndvi * 1000) / 1000,
      n: chim.n,
    });
  }
  return punti;
}

/**
 * Coefficiente di correlazione di Pearson dei punti scatter. Aiuta l'agronomo a
 * leggere il legame NDVI↔chimica. Restituisce null con meno di 2 punti o
 * varianza nulla (correlazione indefinita).
 */
export function correlazionePearson(punti: PuntoScatterSuolo[]): number | null {
  const n = punti.length;
  if (n < 2) return null;
  const mx = punti.reduce((s, p) => s + p.x, 0) / n;
  const my = punti.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of punti) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000;
}

/**
 * `clusterProperties` per una sorgente GeoJSON MapLibre che, su zoom-out,
 * raggruppa i POI e ne aggrega un attributo numerico. Memorizza somma e conteggio
 * così la UI mostra la **media** della zona via {@link clusterMeanExpression}.
 */
export function buildPoiClusterProperties(
  attribute: string,
): Record<string, unknown> {
  return {
    // Somma dei valori dell'attributo nelle feature del cluster.
    somma: ["+", ["coalesce", ["get", attribute], 0]],
    // Conteggio delle feature che hanno effettivamente l'attributo numerico.
    conteggio: [
      "+",
      ["case", ["==", ["typeof", ["get", attribute]], "number"], 1, 0],
    ],
  };
}

/** Espressione MapLibre per la media del cluster (somma/conteggio, 0 se vuoto). */
export function clusterMeanExpression(): unknown[] {
  return [
    "case",
    [">", ["get", "conteggio"], 0],
    ["/", ["get", "somma"], ["get", "conteggio"]],
    0,
  ];
}
