/**
 * Modello della legenda a gradiente (colorbar) per i raster degli indici.
 *
 * Parte PURA (deriva gradiente CSS + tacche dalla rampa colore dell'indice):
 * testabile sotto Node. Il rendering è in ./Colorbar, l'aggancio agli overlay
 * attivi nello store in FieldDashboard.
 */
import type { ColorRamp } from "@agrogea/tools";

export interface ColorbarTick {
  /** Posizione 0..1 lungo la barra (0 = base/min, 1 = cima/max). */
  pos: number;
  value: number;
}

export interface ColorbarModel {
  /** Gradiente CSS verticale (valori alti in cima). */
  cssGradient: string;
  ticks: ColorbarTick[];
  min: number;
  max: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Costruisce il modello colorbar da una rampa `[value, colore][]`. Il dominio
 * è [primo stop, ultimo stop]; il gradiente posiziona ogni colore in proporzione
 * al suo value, e le tacche coincidono con gli stop della rampa.
 */
export function buildColorbar(rampa: ColorRamp): ColorbarModel {
  if (rampa.length === 0) {
    return { cssGradient: "transparent", ticks: [], min: 0, max: 0 };
  }
  const min = rampa[0][0];
  const max = rampa[rampa.length - 1][0];
  const span = max - min || 1;

  const stops = rampa.map(([value, color]) => {
    const pos = (value - min) / span; // 0..1
    return { pos, value, color };
  });

  // Gradiente "to top": il primo stop (min) sta in basso (0%), l'ultimo in cima.
  const cssGradient =
    rampa.length === 1
      ? rampa[0][1]
      : `linear-gradient(to top, ${stops
          .map((s) => `${s.color} ${round(s.pos * 100)}%`)
          .join(", ")})`;

  return {
    cssGradient,
    ticks: stops.map((s) => ({
      pos: Math.round(s.pos * 10000) / 10000,
      value: round(s.value),
    })),
    min: round(min),
    max: round(max),
  };
}
