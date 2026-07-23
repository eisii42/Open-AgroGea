/**
 * Colori e rampe per il fill degli indici sulla mappa (refactor modulo
 * Suolo): dal parsing di un colore esadecimale alla scelta del colore di un
 * value secondo una rampa `[soglia, colore][]`. Parti pure e testabili: nessun
 * accesso a DOM/rete, girano identiche in un Web Worker. Il consumo di queste
 * rampe (fill-color/espressione MapLibre delle celle indice) sta in
 * `./index-grid` e nell'app.
 */

/** Una rampa colore: coppie [soglia, "#rrggbb"] in ordine crescente di soglia. */
export type ColorRamp = [number, string][];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parsing di un colore esadecimale "#rgb" o "#rrggbb". */
export function hexToRgb(hex: string): Rgb {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = Number.parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * Colore di un value d'index secondo la rampa: l'ultima soglia raggiunta dal
 * value vince (sotto la prima soglia usa il primo colore). `NaN` → null
 * (pixel fuori dal poligono o nodata).
 */
export function colorFromRamp(value: number, rampa: ColorRamp): Rgb | null {
  if (Number.isNaN(value)) return null;
  let hex = rampa[0]?.[1] ?? "#000000";
  for (const [threshold, color] of rampa) {
    if (value >= threshold) hex = color;
  }
  return hexToRgb(hex);
}
