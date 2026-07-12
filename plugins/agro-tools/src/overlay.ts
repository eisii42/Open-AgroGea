/**
 * Costruzione dell'overlay raster d'index da renderizzare sopra il poligono
 * dell'appezzamento (refactor modulo Suolo).
 *
 * Parti pure e testabili: dalla finestra raster letta dal COG (in UTM) ai
 * quattro angoli geografici per la sorgente immagine MapLibre, e dalla matrice
 * di valori d'index (NDVI/NDRE/…) al buffer RGBA colorato via rampa. La
 * codifica in PNG/data-URL resta al chiamante (main thread: usa un canvas), così
 * questo modulo gira identico in un Web Worker senza dipendere dal DOM.
 */

import type { RasterWindow } from "./clip";
import { utmToLonLat } from "./utm";

/** Quattro angoli [lng, lat] nell'ordine richiesto da MapLibre image source. */
export type OverlayCoordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * Angoli geografici (lng/lat) della finestra raster, nell'ordine che la sorgente
 * `image` di MapLibre si aspetta: alto-sx, alto-dx, basso-dx, basso-sx. La
 * finestra è un rettangolo allineato agli assi in UTM; proiettandone i vertici
 * in WGS84 si ottiene un quadrilatero non rettangolare, che MapLibre gestisce.
 */
export function windowToCoordinates(win: RasterWindow): OverlayCoordinates {
  const east0 = win.originEasting;
  const east1 = win.originEasting + win.width * win.pixelWidth;
  const north0 = win.originNorthing; // bordo superiore (northing maggiore)
  const north1 = win.originNorthing - win.height * win.pixelHeight; // inferiore

  const toLngLat = (e: number, n: number): [number, number] => {
    const { lon, lat } = utmToLonLat(e, n, win.epsg);
    return [lon, lat];
  };

  return [
    toLngLat(east0, north0), // alto-sx
    toLngLat(east1, north0), // alto-dx
    toLngLat(east1, north1), // basso-dx
    toLngLat(east0, north1), // basso-sx
  ];
}

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
 * Colore di un valore d'index secondo la rampa: l'ultima soglia raggiunta dal
 * valore vince (sotto la prima soglia usa il primo colore). `NaN` → null
 * (pixel trasparente fuori dal poligono o nodata).
 */
export function colorFromRamp(value: number, rampa: ColorRamp): Rgb | null {
  if (Number.isNaN(value)) return null;
  let hex = rampa[0]?.[1] ?? "#000000";
  for (const [threshold, color] of rampa) {
    if (value >= threshold) hex = color;
  }
  return hexToRgb(hex);
}

/**
 * Buffer RGBA (row-major, length = width·height·4) della matrice d'index
 * colorata via rampa. I pixel `NaN` (fuori dal poligono / nodata) restano
 * completamente trasparenti, così l'overlay segue il perimetro dell'appezzamento.
 * `alpha` (0..255) regola l'opacità dei pixel validi.
 */
export function indexToRgba(
  values: Float32Array,
  rampa: ColorRamp,
  alpha = 220,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const rgb = colorFromRamp(values[i], rampa);
    const o = i * 4;
    if (!rgb) {
      out[o + 3] = 0; // trasparente
      continue;
    }
    out[o] = rgb.r;
    out[o + 1] = rgb.g;
    out[o + 2] = rgb.b;
    out[o + 3] = alpha;
  }
  return out;
}
