/**
 * Vettorizzazione del raster di un indice (es. NDVI) in una griglia di celle
 * quadrate georeferenziate, ciascuna col valore medio dell'indice. È l'input
 * vettoriale della zonazione VRA (clustering K-means + ratei).
 *
 * Parte PURA (solo `utmToLonLat`): testabile sotto Node.
 */
import { utmToLonLat, type RasterWindow } from "@agrogea/tools";
import type { FeatureCollection, Polygon } from "geojson";

/** Media dei valori finiti di un blocco di pixel; null se nessuno è valido. */
function mediaBlocco(
  masked: Float32Array | number[],
  window: RasterWindow,
  row0: number,
  col0: number,
  step: number,
): number | null {
  let somma = 0;
  let n = 0;
  const rowEnd = Math.min(row0 + step, window.height);
  const colEnd = Math.min(col0 + step, window.width);
  for (let row = row0; row < rowEnd; row += 1) {
    for (let col = col0; col < colEnd; col += 1) {
      const v = masked[row * window.width + col];
      if (typeof v === "number" && Number.isFinite(v)) {
        somma += v;
        n += 1;
      }
    }
  }
  return n > 0 ? somma / n : null;
}

/**
 * Converte il raster mascherato (NaN fuori dal poligono) in una FeatureCollection
 * di celle quadrate (blocchi `step`×`step` pixel) con la proprietà `valore` =
 * media dell'indice nel blocco. Le celle interamente fuori dal poligono (nessun
 * pixel valido) sono omesse.
 */
export function rasterToGridCells(
  masked: Float32Array | number[],
  window: RasterWindow,
  step = 4,
): FeatureCollection<Polygon, { valore: number }> {
  const passo = Math.max(1, Math.floor(step));
  const features: FeatureCollection<Polygon, { valore: number }>["features"] = [];

  for (let row0 = 0; row0 < window.height; row0 += passo) {
    const rowEnd = Math.min(row0 + passo, window.height);
    // Nord decresce con la riga (origine in alto a sinistra).
    const nordTop = window.originNorthing - row0 * window.pixelHeight;
    const nordBottom = window.originNorthing - rowEnd * window.pixelHeight;
    for (let col0 = 0; col0 < window.width; col0 += passo) {
      const valore = mediaBlocco(masked, window, row0, col0, passo);
      if (valore == null) continue;
      const colEnd = Math.min(col0 + passo, window.width);
      const estLeft = window.originEasting + col0 * window.pixelWidth;
      const estRight = window.originEasting + colEnd * window.pixelWidth;

      const tl = utmToLonLat(estLeft, nordTop, window.epsg);
      const tr = utmToLonLat(estRight, nordTop, window.epsg);
      const br = utmToLonLat(estRight, nordBottom, window.epsg);
      const bl = utmToLonLat(estLeft, nordBottom, window.epsg);

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
        properties: { valore: Math.round(valore * 1000) / 1000 },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
