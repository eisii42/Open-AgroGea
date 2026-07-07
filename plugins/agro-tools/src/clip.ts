import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { MultiPolygon, Polygon } from "geojson";
import { lonLatToUtm } from "./utm";

/**
 * Clip dei pixel raster sul poligono esatto dell'appezzamento.
 *
 * La finestra letta dal COG è un rettangolo (bbox) in coordinate UTM della
 * scena; il poligono è in WGS84. Per tenere solo i pixel *dentro* il perimetro
 * (e non l'intero bbox) si proietta il poligono nello stesso UTM e si testa il
 * centro di ogni pixel con point-in-polygon. I pixel fuori diventano NaN, così
 * `indexStatistics` li ignora.
 *
 * Tutto è geometrico e puro: nessun accesso alla rete o al DOM, quindi gira
 * identico nel Web Worker.
 */

export interface RasterWindow {
  /** EPSG della scena (es. 32632). Determina la zona UTM di proiezione. */
  epsg: number;
  /** Coordinate UTM dell'angolo in alto a sinistra della finestra letta. */
  originEasting: number;
  originNorthing: number;
  /** Dimensione pixel in metri (positiva). */
  pixelWidth: number;
  pixelHeight: number;
  /** Dimensioni della finestra in pixel. */
  width: number;
  height: number;
}

/** Proietta gli anelli del poligono in UTM per i test point-in-polygon. */
function polygonToUtm(
  geometria: Polygon | MultiPolygon,
  epsg: number,
): Polygon | MultiPolygon {
  const proj = (ring: number[][]): number[][] =>
    ring.map(([lon, lat]) => {
      const { easting, northing } = lonLatToUtm(lon, lat, epsg);
      return [easting, northing];
    });
  if (geometria.type === "Polygon") {
    return { type: "Polygon", coordinates: geometria.coordinates.map(proj) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometria.coordinates.map((poly) => poly.map(proj)),
  };
}

/**
 * Maschera in-place i valori dei pixel fuori dal poligono (→ NaN). `values` è
 * il raster row-major della finestra (length = width·height). Ritorna lo stesso
 * array per comodità, con il numero di pixel interni mantenuti.
 */
export function clipRasterToPolygon(
  values: Float32Array,
  win: RasterWindow,
  geometria: Polygon | MultiPolygon,
): { masked: Float32Array; pixelInterni: number } {
  if (values.length !== win.width * win.height) {
    throw new Error(
      `Finestra incoerente: ${values.length} valori per ${win.width}×${win.height}.`,
    );
  }
  const poly = polygonToUtm(geometria, win.epsg);
  let interni = 0;
  for (let row = 0; row < win.height; row++) {
    // Centro del pixel: origine + (col+0.5)·passo. Il northing decresce verso il basso.
    const north = win.originNorthing - (row + 0.5) * win.pixelHeight;
    for (let col = 0; col < win.width; col++) {
      const idx = row * win.width + col;
      if (Number.isNaN(values[idx])) continue;
      const east = win.originEasting + (col + 0.5) * win.pixelWidth;
      if (booleanPointInPolygon([east, north], poly)) {
        interni++;
      } else {
        values[idx] = Number.NaN;
      }
    }
  }
  return { masked: values, pixelInterni: interni };
}
