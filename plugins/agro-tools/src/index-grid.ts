/**
 * Vettorizzazione del raster degli indici in una griglia di celle quadrate
 * ESATTE (un poligono per pixel Sentinel-2, agganciato alla griglia UTM della
 * scena) e color scale RELATIVA ai plots calcolati nella stessa run
 * (refactor rendering modulo Suolo, sostituisce l'overlay immagine sfumato).
 *
 * Parti pure e testabili: nessun accesso a DOM/rete/MapLibre, gira identica
 * nel Web Worker. La cella (row, col) copre esattamente il pixel raster
 * originario — origine + col·pixelWidth in easting, northing decrescente con
 * la row — così celle adiacenti condividono gli stessi angoli in coordinate
 * float piene (nessun arrotondamento sulle coordinate: introdurrebbe fessure
 * visibili fra celle contigue). Solo i value numerici delle properties sono
 * arrotondati a 3 decimali.
 */
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { RasterWindow } from "./clip";
import type { VegetationIndex } from "./indices";
import { rampForIndex } from "./indices";
import type { ColorRamp } from "./overlay";
import { utmToLonLat } from "./utm";

/** Raster mascherato (NaN fuori dal poligono) di un singolo indice, sulla griglia `RasterWindow` comune. */
export interface IndexLayerRaster {
  index: VegetationIndex;
  values: Float32Array;
}

/**
 * Properties di una cella indice: `value` (l'indice primario, letto dalla fill
 * expression) + `plotId`, più un campo numerico per ciascun indice presente e
 * finito in quel pixel (chiave = id indice, es. "ndvi"/"ndre"/…).
 */
export interface IndexCellProperties extends Partial<Record<VegetationIndex, number>> {
  value: number;
  plotId: string;
}

export interface IndexGridOptions {
  /** Indice renderizzato come fill-color della cella (letto dalla property `value`). */
  primaryIndex: VegetationIndex;
  plotId: string;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Converte i raster mascherati (uno per indice, stessa griglia) in una
 * FeatureCollection di celle quadrate: una per pixel dove l'indice PRIMARIO ha
 * un value finito (i pixel fuori dal poligono/nodata sono NaN e vengono
 * omessi). Ogni cella porta il value dell'indice primario più, quando finiti,
 * i value degli altri indici calcolati nella stessa run (per il tooltip hover
 * multi-indice).
 */
export function rasterToIndexCells(
  layers: IndexLayerRaster[],
  win: RasterWindow,
  options: IndexGridOptions,
): FeatureCollection<Polygon, IndexCellProperties> {
  const primary = layers.find((l) => l.index === options.primaryIndex);
  const features: Feature<Polygon, IndexCellProperties>[] = [];
  if (!primary) {
    return { type: "FeatureCollection", features };
  }

  for (let row = 0; row < win.height; row++) {
    // Nord decresce con la row (origine in alto a sinistra), come rasterToGridCells.
    const northTop = win.originNorthing - row * win.pixelHeight;
    const northBottom = win.originNorthing - (row + 1) * win.pixelHeight;
    for (let col = 0; col < win.width; col++) {
      const idx = row * win.width + col;
      const primaryValue = primary.values[idx];
      if (!Number.isFinite(primaryValue)) continue;

      const eastLeft = win.originEasting + col * win.pixelWidth;
      const eastRight = win.originEasting + (col + 1) * win.pixelWidth;

      // Coordinate a piena precisione (NIENTE arrotondamento): celle adiacenti
      // devono condividere esattamente gli stessi angoli, altrimenti la
      // griglia mostra fessure sottopixel fra un poligono e l'altro.
      const tl = utmToLonLat(eastLeft, northTop, win.epsg);
      const tr = utmToLonLat(eastRight, northTop, win.epsg);
      const br = utmToLonLat(eastRight, northBottom, win.epsg);
      const bl = utmToLonLat(eastLeft, northBottom, win.epsg);

      const properties: IndexCellProperties = {
        value: round3(primaryValue),
        plotId: options.plotId,
      };
      for (const layer of layers) {
        const v = layer.values[idx];
        if (Number.isFinite(v)) {
          properties[layer.index] = round3(v);
        }
      }

      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [tl.lon, tl.lat],
              [tr.lon, tr.lat],
              [br.lon, br.lat],
              [bl.lon, bl.lat],
              [tl.lon, tl.lat],
            ],
          ],
        },
        properties,
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/** Estrae il value dell'indice primario (property `value`) da ogni cella. */
export function indexCellValues(
  cells: FeatureCollection<Polygon, IndexCellProperties>,
): number[] {
  return cells.features.map((f) => f.properties.value);
}

/**
 * Dominio relativo dei value pooled: stretch 2–98 percentile (standard
 * telerilevamento), così un singolo pixel outlier non appiattisce la mappa
 * sui restanti. Percentile lineare-interpolato su una copia sorted.
 * Degenera su [min, max] se lo stretch è troppo stretto, e su [v−0.01, v+0.01]
 * se anche min/max coincidono (value costante). Input vuoto → [0, 1].
 */
export function relativeDomain(values: number[]): [number, number] {
  const finiti = values.filter((v) => Number.isFinite(v));
  if (finiti.length === 0) return [0, 1];

  const sorted = [...finiti].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    const frac = idx - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
  };

  let lo = percentile(2);
  let hi = percentile(98);
  if (hi - lo < 1e-6) {
    lo = sorted[0];
    hi = sorted[sorted.length - 1];
  }
  if (hi - lo < 1e-6) {
    const v = sorted[0];
    lo = v - 0.01;
    hi = v + 0.01;
  }
  return [lo, hi];
}

/**
 * Rampa colore dell'indice (stessi colori di `rampForIndex`, es. NDVI
 * rosso→verde) spalmata uniformemente sul dominio relativo `[lo, hi]` invece
 * delle soglie assolute 0..1: la mappa usa tutta la scala colore sul range
 * REALE dei value calcolati, invece di appiattirsi su una banda stretta.
 */
export function relativeRamp(
  index: VegetationIndex,
  domain: [number, number],
): ColorRamp {
  const colori = rampForIndex(index).map(([, colore]) => colore);
  const [lo, hi] = domain;
  const span = hi - lo;
  const n = colori.length;
  if (n <= 1) return [[lo, colori[0] ?? "#000000"]];
  return colori.map((colore, i) => {
    const t = i / (n - 1);
    return [lo + t * span, colore] as [number, string];
  });
}

/**
 * Espressione MapLibre `interpolate` (lineare) dai colori/soglie della rampa,
 * letta dalla property indicata (default `value`). Array puro, JSON-serializzabile
 * dal chiamante in `LayerStyle.vectorStyleExpression`.
 */
export function indexCellColorExpression(
  ramp: ColorRamp,
  property = "value",
): unknown[] {
  const lo = ramp[0]?.[0] ?? 0;
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["get", property], lo],
    ...ramp.flatMap(([value, colore]) => [value, colore]),
  ];
}
