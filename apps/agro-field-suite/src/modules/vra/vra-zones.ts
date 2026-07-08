/**
 * Zonazione a rateo variabile (VRA) per tipologia di lavorazione.
 *
 * Logica PURA: clusterizza le celle dell'indice (K-means) in zone gestionali e
 * assegna a ciascuna zona un rateo (quantità) deciso dall'agronomo. Indipendente
 * da come l'indice è stato calcolato (vedi ./raster-cells), per rispettare la
 * separazione "calcolo indici ≠ generazione mappa VRA".
 */
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { kmeans1d } from "./kmeans";

/** Tipi di lavorazione che possono usare una mappa a rateo variabile. */
export type TipoLavorazione =
  | "concimazione"
  | "fertilizzazione"
  | "trattamento"
  | "semina"
  | "irrigation";

export const ETICHETTE_LAVORAZIONE: Record<TipoLavorazione, string> = {
  concimazione: "Concimazione",
  fertilizzazione: "Fertilizzazione",
  trattamento: "Trattamento",
  semina: "Semina",
  irrigation: "Irrigazione",
};

/** Unità di misura di default del rateo per ciascuna lavorazione. */
export const UNITA_LAVORAZIONE: Record<TipoLavorazione, string> = {
  concimazione: "kg/ha",
  fertilizzazione: "kg/ha",
  trattamento: "L/ha",
  semina: "semi/ha",
  irrigation: "mm",
};

export interface ZonaVra {
  /** Indice zona 0..k-1, crescente per value medio dell'indice. */
  zona: number;
  /** Valore medio dell'indice nella zona (centroid K-means). */
  valoreMedio: number;
  /** Numero di celle assegnate alla zona. */
  nCelle: number;
  /** Rateo (quantità) prescritto per la zona. */
  rateo: number;
}

export interface OpzioniZoneVra {
  /** Numero di zone gestionali (cluster K-means). */
  zone: number;
  /** Tipo di lavorazione (determina unità ed etichette). */
  lavorazione: TipoLavorazione;
  /**
   * Rateo per zona, allineato alle zone in ordine CRESCENTE di indice
   * (rates[0] = zona a indice più basso). Se più corto, l'ultimo value si
   * ripete; se assente, i ratei restano 0.
   */
  ratei: number[];
  /** Unità di misura del rateo (default per lavorazione). */
  unita?: string;
}

export interface RisultatoZoneVra {
  /** Celle annotate con `zona`, `rateo`, `valore`, `lavorazione`, `unita`. */
  fc: FeatureCollection<Polygon>;
  /** Statistiche per zona (per legenda e riepilogo). */
  zone: ZonaVra[];
  lavorazione: TipoLavorazione;
  unita: string;
}

function rateoPerZona(ratei: number[], zona: number): number {
  if (ratei.length === 0) return 0;
  const value = ratei[Math.min(zona, ratei.length - 1)];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Genera le zone VRA dalle celle dell'indice: K-means su `properties.valore`,
 * poi assegna il rateo di ogni zona. Le celle senza `valore` numerico sono
 * escluse dalla mappa di prescrizione.
 */
export function generateVraZones(
  cells: FeatureCollection<Polygon, { value?: number }>,
  options: OpzioniZoneVra,
): RisultatoZoneVra {
  const unita = options.unita ?? UNITA_LAVORAZIONE[options.lavorazione];
  const validi = cells.features.filter(
    (f): f is Feature<Polygon, { value: number }> =>
      typeof f.properties?.value === "number" &&
      Number.isFinite(f.properties.value),
  );

  if (validi.length === 0) {
    return {
      fc: { type: "FeatureCollection", features: [] },
      zone: [],
      lavorazione: options.lavorazione,
      unita,
    };
  }

  const valori = validi.map((f) => f.properties.value);
  const { assignments, centroids } = kmeans1d(valori, options.zone);

  const conteggi = new Array<number>(centroids.length).fill(0);
  for (const zona of assignments) conteggi[zona] += 1;

  const zone: ZonaVra[] = centroids.map((valoreMedio, zona) => ({
    zona,
    valoreMedio: Math.round(valoreMedio * 1000) / 1000,
    nCelle: conteggi[zona],
    rateo: rateoPerZona(options.ratei, zona),
  }));

  const features = validi.map((feature, i) => {
    const zona = assignments[i];
    return {
      ...feature,
      properties: {
        ...feature.properties,
        zona,
        rateo: zone[zona].rateo,
        lavorazione: options.lavorazione,
        unita,
      },
    } satisfies Feature<Polygon>;
  });

  return {
    fc: { type: "FeatureCollection", features },
    zone,
    lavorazione: options.lavorazione,
    unita,
  };
}
