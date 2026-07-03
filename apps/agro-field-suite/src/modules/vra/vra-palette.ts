/**
 * Palette agronomica per la colorazione choropleth (per classi) delle zone VRA.
 *
 * Pura e testabile. Le zone sono ordinate per indice crescente (zona 0 = vigore
 * più basso): la rampa RdYlGn 5 classi mappa il basso vigore sul rosso e l'alto
 * sul verde, lettura immediata della mappa di prescrizione.
 */
import type { VectorStyleStop } from "@geolibre/core";

/** RdYlGn (ColorBrewer) a 5 classi: rosso → giallo → verde. */
const PALETTE_RDYLGN = [
  "#d7191c",
  "#fdae61",
  "#ffffbf",
  "#a6d96a",
  "#1a9641",
] as const;

/** Colore della zona `index` su `total` zone, campionando la palette. */
export function coloreZona(index: number, total: number): string {
  if (total <= 1) return PALETTE_RDYLGN[PALETTE_RDYLGN.length - 1];
  const ratio = Math.min(1, Math.max(0, index / (total - 1)));
  const pos = Math.round(ratio * (PALETTE_RDYLGN.length - 1));
  return PALETTE_RDYLGN[pos];
}

/**
 * Stop categorizzati per `LayerStyle.vectorStyleStops`: la fill-color del layer
 * diventa un `match` sulla proprietà `zona` (vedi vectorColorExpression).
 */
export function stopsVra(numeroZone: number): VectorStyleStop[] {
  return Array.from({ length: numeroZone }, (_, zona) => ({
    value: String(zona),
    color: coloreZona(zona, numeroZone),
    label: `Zona ${zona + 1}`,
  }));
}
