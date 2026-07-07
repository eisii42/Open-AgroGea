/**
 * Indici vegetazionali da bande multispettrali (Sentinel-2 e compatibili).
 * Funzioni pure su Float32Array: girano identiche nel main thread, in un Web
 * Worker o dentro la pipeline geotiff.js della timeline NDVI.
 */

/** Indici a differenza normalizzata (a − b)/(a + b). */
export type IndiceNormalizzato = "ndvi" | "ndre" | "ndwi";
/** Indici corretti per il suolo (NIR/Red + fattore L). */
export type IndiceSuolo = "savi" | "msavi2";
export type IndiceVegetazionale = IndiceNormalizzato | IndiceSuolo;

/** Bande Sentinel-2 richieste dagli indici normalizzati (riflettanze, stessa griglia). */
export const BANDE_RICHIESTE: Record<
  IndiceNormalizzato,
  { a: string; b: string }
> = {
  // (NIR − Red) / (NIR + Red)
  ndvi: { a: "B08", b: "B04" },
  // (NIR − RedEdge) / (NIR + RedEdge) — stato azotato, vigneto/frutteto
  ndre: { a: "B08", b: "B05" },
  // (Green − NIR) / (Green + NIR) — contenuto idrico/superfici irrigue
  ndwi: { a: "B03", b: "B08" },
};

/** Bande NIR/Red usate dagli indici corretti per il suolo. */
export const BANDE_SUOLO: Record<IndiceSuolo, { nir: string; red: string }> = {
  savi: { nir: "B08", red: "B04" },
  msavi2: { nir: "B08", red: "B04" },
};

const INDICI_SUOLO: ReadonlySet<string> = new Set<IndiceSuolo>([
  "savi",
  "msavi2",
]);

export function isIndiceSuolo(indice: string): indice is IndiceSuolo {
  return INDICI_SUOLO.has(indice);
}

export interface IndiceStats {
  media: number;
  min: number;
  max: number;
  devStd: number;
  pixelValidi: number;
}

/**
 * Differenza normalizzata (a − b) / (a + b) pixel per pixel.
 * I pixel senza dato (NaN, o somma nulla) producono NaN, così la
 * simbologia e le statistiche zonali possono escluderli.
 */
export function differenzaNormalizzata(
  a: Float32Array,
  b: Float32Array,
): Float32Array {
  if (a.length !== b.length) {
    throw new Error(
      `Bande disallineate: ${a.length} vs ${b.length} pixel (stessa griglia richiesta).`,
    );
  }
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const sum = a[i] + b[i];
    out[i] = sum === 0 || Number.isNaN(sum) ? Number.NaN : (a[i] - b[i]) / sum;
  }
  return out;
}

/**
 * SAVI — Soil-Adjusted Vegetation Index (Huete 1988):
 *   ((NIR − Red) / (NIR + Red + L)) · (1 + L)
 * Il fattore `L` (0..1, default 0.5) attenua l'influenza del suolo nudo:
 * alto per copertura rada (arboree giovani, fasi iniziali), basso a piena
 * copertura. A L=0 degenera in NDVI.
 */
export function calcolaSavi(
  nir: Float32Array,
  red: Float32Array,
  L = 0.5,
): Float32Array {
  if (nir.length !== red.length) {
    throw new Error(
      `Bande disallineate: ${nir.length} vs ${red.length} pixel.`,
    );
  }
  const out = new Float32Array(nir.length);
  for (let i = 0; i < nir.length; i++) {
    const denom = nir[i] + red[i] + L;
    out[i] =
      denom === 0 || Number.isNaN(denom)
        ? Number.NaN
        : ((nir[i] - red[i]) / denom) * (1 + L);
  }
  return out;
}

/**
 * MSAVI2 — Modified SAVI (Qi 1994): il fattore L si auto-calibra pixel per
 * pixel, eliminando la scelta manuale. Robusto su suolo nudo / bassa copertura.
 *   (2·NIR + 1 − √((2·NIR + 1)² − 8·(NIR − Red))) / 2
 */
export function calcolaMsavi2(
  nir: Float32Array,
  red: Float32Array,
): Float32Array {
  if (nir.length !== red.length) {
    throw new Error(
      `Bande disallineate: ${nir.length} vs ${red.length} pixel.`,
    );
  }
  const out = new Float32Array(nir.length);
  for (let i = 0; i < nir.length; i++) {
    const n = nir[i];
    const r = red[i];
    const term = 2 * n + 1;
    const radicando = term * term - 8 * (n - r);
    out[i] =
      radicando < 0 || Number.isNaN(radicando)
        ? Number.NaN
        : (term - Math.sqrt(radicando)) / 2;
  }
  return out;
}

export function calcolaIndice(
  indice: IndiceVegetazionale,
  bande: Partial<Record<string, Float32Array>>,
  options: { L?: number } = {},
): Float32Array {
  if (isIndiceSuolo(indice)) {
    const { nir, red } = BANDE_SUOLO[indice];
    const bandNir = bande[nir];
    const bandRed = bande[red];
    if (!bandNir || !bandRed) {
      throw new Error(`Indice ${indice}: servono le bande ${nir} e ${red}.`);
    }
    return indice === "savi"
      ? calcolaSavi(bandNir, bandRed, options.L)
      : calcolaMsavi2(bandNir, bandRed);
  }
  const { a, b } = BANDE_RICHIESTE[indice];
  const bandA = bande[a];
  const bandB = bande[b];
  if (!bandA || !bandB) {
    throw new Error(`Indice ${indice}: servono le bande ${a} e ${b}.`);
  }
  return differenzaNormalizzata(bandA, bandB);
}

/**
 * Soil-masking: azzera (→ NaN) i pixel sotto la soglia di indice, isolando la
 * vegetazione dall'interfila/suolo nudo prima delle statistiche zonali. Per
 * vigneti e frutteti la soglia arriva dalla matrice fenologica della coltura
 * (vedi `fenologia.ts`): NDVI tipico del suolo nudo ~0.2, della chioma ben più
 * alto. Restituisce un nuovo array; l'originale non è toccato.
 */
export function applicaSoilMask(
  values: Float32Array,
  sogliaMin: number,
): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isNaN(v) || v < sogliaMin ? Number.NaN : v;
  }
  return out;
}

/** Frazione di pixel validi (copertura vegetale stimata) dopo il masking. */
export function frazioneCopertura(masked: Float32Array): number {
  if (masked.length === 0) return 0;
  let validi = 0;
  for (const v of masked) if (!Number.isNaN(v)) validi++;
  return validi / masked.length;
}

/** Statistiche per le schede NDVI (media/min/max/dev.std sui pixel validi). */
export function statisticheIndice(values: Float32Array): IndiceStats {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    n++;
    sum += v;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (n === 0) {
    return { media: Number.NaN, min: Number.NaN, max: Number.NaN, devStd: Number.NaN, pixelValidi: 0 };
  }
  const media = sum / n;
  return {
    media,
    min,
    max,
    devStd: Math.sqrt(Math.max(0, sumSq / n - media * media)),
    pixelValidi: n,
  };
}

/** Rampa NDVI del design system (Design.md §Design Tokens). */
export const NDVI_RAMP: [number, string][] = [
  [0.3, "#d23b2e"],
  [0.45, "#e8833a"],
  [0.55, "#f2c14e"],
  [0.66, "#a7c44d"],
  [0.78, "#4e9a3f"],
  [0.9, "#1f6b2e"],
];

export function ndviColor(value: number): string {
  if (Number.isNaN(value)) return "transparent";
  let color = NDVI_RAMP[0][1];
  for (const [stop, hex] of NDVI_RAMP) {
    if (value >= stop) color = hex;
  }
  return color;
}

/**
 * Rampa "acqua" per NDWI (Green−NIR / Green+NIR): valori alti = più contenuto
 * idrico/superfici sature. Dal beige asciutto al blu profondo.
 */
export const NDWI_RAMP: [number, string][] = [
  [-0.3, "#caa472"],
  [-0.1, "#d9c89a"],
  [0.0, "#bfe0d8"],
  [0.2, "#7fc6d9"],
  [0.4, "#3a93c4"],
  [0.6, "#1f5fa6"],
];

/**
 * Rampa colore consigliata per ciascun indice, base dell'overlay raster sulla
 * mappa. NDVI/SAVI/MSAVI2/NDRE condividono la rampa di vigore vegetale; NDWI usa
 * la rampa idrica. Editabile come gli altri default agronomici.
 */
export const RAMPA_INDICE: Record<IndiceVegetazionale, [number, string][]> = {
  ndvi: NDVI_RAMP,
  ndre: NDVI_RAMP,
  savi: NDVI_RAMP,
  msavi2: NDVI_RAMP,
  ndwi: NDWI_RAMP,
};

export function rampaPerIndice(indice: IndiceVegetazionale): [number, string][] {
  return RAMPA_INDICE[indice] ?? NDVI_RAMP;
}
