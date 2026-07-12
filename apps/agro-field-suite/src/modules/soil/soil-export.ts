import type { Plot } from "@agrogea/core";
import type { Feature, FeatureCollection, Point, Position } from "geojson";
import {
  type ExportArtifact,
  geojsonToCsvLocalizzato,
  serializzaVettoriale,
} from "../../services/gis/geo-export";

/**
 * Export dello STORICO UMIDITÀ (Modulo Suolo §3): proietta la series giornaliera
 * del bilancio idrico (`soil_water_indices`) in formati GIS della filiera —
 * GeoJSON, Shapefile (.zip) e CSV localizzato (`;` + BOM UTF-8). Ogni day
 * diventa un punto al baricentro dell'appezzamento con gli indici idrici come
 * attributi. Compone i serializzatori puri di `geo-export` (priorità peso bundle).
 */

/** Riga giornaliera dello storico idrico (schema `soil_water_indices`). */
export interface MoistureHistoryRow {
  date: string;
  et0: number;
  etc: number;
  rain_mm: number;
  irrigation_mm: number;
  deep_percolation_mm: number;
  depletion_mm: number;
  raw_mm: number;
  awc_mm: number;
  water_stress: boolean;
}

/** Formati ammessi per l'export dello storico umidità. */
export type MoistureHistoryFormat = "geojson" | "shapefile" | "csv";

/** Baricentro grezzo (media dei vertici) del poligono, senza dipendenze pesanti. */
function baricentro(geometry: Plot["geometry"]): Position {
  const punti: Position[] = [];
  const raccogli = (rings: Position[][]) => {
    for (const ring of rings) for (const p of ring) punti.push(p);
  };
  if (geometry.type === "Polygon") raccogli(geometry.coordinates);
  else for (const poly of geometry.coordinates) raccogli(poly);
  if (punti.length === 0) return [0, 0];
  const somma = punti.reduce(
    (acc, [x, y]) => [acc[0] + x, acc[1] + y],
    [0, 0] as Position,
  );
  return [somma[0] / punti.length, somma[1] / punti.length];
}

/**
 * Costruisce la FeatureCollection dello storico: un punto per day al
 * baricentro dell'appezzamento, con gli indici idrici come attributi numerici.
 */
export function buildMoistureHistoryFc(
  plot: Plot,
  series: MoistureHistoryRow[],
): FeatureCollection {
  const centro = baricentro(plot.geometry);
  const features: Feature<Point>[] = series.map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: centro },
    properties: {
      plot_id: plot.id,
      plot_name: plot.user_plot_name,
      date: r.date,
      et0_mm: r.et0,
      etc_mm: r.etc,
      rain_mm: r.rain_mm,
      irrigation_mm: r.irrigation_mm,
      deep_percolation_mm: r.deep_percolation_mm,
      depletion_mm: r.depletion_mm,
      raw_mm: r.raw_mm,
      awc_mm: r.awc_mm,
      water_stress: r.water_stress,
    },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Serializza lo storico umidità nel formato richiesto. GeoJSON/Shapefile
 * delegano a {@link serializzaVettoriale}; il CSV usa la variante localizzata
 * europea (`;` + BOM UTF-8) attesa da Excel IT/ES.
 */
export function serializeMoistureHistory(
  fc: FeatureCollection,
  formato: MoistureHistoryFormat,
  baseName: string,
): ExportArtifact {
  if (formato === "csv") {
    return {
      filename: `${baseName}.csv`,
      blobPart: geojsonToCsvLocalizzato(fc),
      mime: "text/csv;charset=utf-8",
    };
  }
  return serializzaVettoriale(fc, formato, baseName);
}
