/**
 * Report di due diligence EUDR georeferenziato, generato localmente.
 *
 * Puro e testabile: produce un GeoJSON Feature con la geometria dell'appezzamento
 * e i metadati della dichiarazione di assenza deforestazione (cut-off 2020).
 */
import type { Feature, Geometry } from "geojson";
import { CONSTRAINT_LABELS, type ConstraintType } from "./geo-compliance";

/** Cut-off della Regolamentazione EUDR (products a deforestazione zero). */
export const EUDR_CUTOFF = "2020-12-31";

export interface DueDiligenceData {
  appezzamentoNome: string;
  aziendaNome?: string;
  geometria: Geometry;
  areaHa: number | null;
  constraints: ConstraintType[];
  /** Data di generazione (ISO); default: ora. */
  generatoIl?: string;
}

/**
 * Costruisce il report come GeoJSON Feature (stringa). La geometria è inclusa
 * per la verifica georeferenziata richiesta da EUDR; le proprietà riassumono i
 * vincoli rilevati e la dichiarazione.
 */
export function buildDueDiligenceReport(dati: DueDiligenceData): string {
  const feature: Feature = {
    type: "Feature",
    geometry: dati.geometria,
    properties: {
      documento: "EUDR Due Diligence Statement",
      generato_il: dati.generatoIl ?? new Date().toISOString(),
      company: dati.aziendaNome ?? null,
      plot: dati.appezzamentoNome,
      area_ha: dati.areaHa,
      eudr_cutoff: EUDR_CUTOFF,
      vincoli_rilevati: dati.constraints.map((v) => CONSTRAINT_LABELS[v]),
      a_rischio_deforestazione: dati.constraints.includes("eudr"),
      dichiarazione: dati.constraints.includes("eudr")
        ? "L'appezzamento interseca un'area a rischio: necessaria verifica documentale prima dell'immissione sul mercato UE."
        : "Nessuna intersezione con aree a rischio deforestazione rilevata dai layer locali.",
    },
  };
  return JSON.stringify(feature, null, 2);
}
