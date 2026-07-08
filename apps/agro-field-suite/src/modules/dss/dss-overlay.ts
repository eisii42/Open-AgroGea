import type { Plot } from "@agrogea/core";
import {
  type CropType,
  type PhenologicalPhase,
  getPhaseCalibration,
  hexToRgb,
  type ColorRamp,
} from "@agrogea/tools";
import type { Feature, FeatureCollection } from "geojson";

/**
 * Sintesi spaziale del risk DSS (Modulo 3): combina la phase IDROLOGICA
 * (stress idrico dal bilancio FAO 66), il dato SPETTRALE (`last_ndvi_mean`) e i
 * CAMPIONAMENTI fisici del soil in un unico punteggio 0..1 per plot,
 * **bilanciato per crop** (pesi e banda NDVI attesa dipendono da crop e
 * phase). Da qui l'overlay coropletico verde→giallo→rosso e la legenda colorbar.
 *
 * Tutto puro: niente React/MapLibre. Il rendering del layer e la legenda vivono
 * in `useDssOverlayLayer` / `Colorbar`.
 */

export interface FieldSummaryInputs {
  /** Stress idrico normalizzato 0..1 (da `waterRisk01`). */
  stressIdrico01: number;
  /** Rischio fitopatologico normalizzato 0..1 (max dei vettori). */
  rischioPatologico01: number;
  /** Ultimo NDVI medio dell'appezzamento (`last_ndvi_mean`), o null. */
  ndvi: number | null;
  /** Azoto dei soilSamples (`soil_samples.nitrogen`, mg/kg), o null. */
  azoto?: number | null;
  /** Sostanza organica (`soil_samples.organic_matter`, %), o null. */
  sostanzaOrganica?: number | null;
}

export interface SummaryCalibration {
  pesoStress: number;
  pesoPatologico: number;
  pesoVigore: number;
  pesoSuolo: number;
  /** Banda NDVI attesa per la phase (da `fenologia`): scala di vigore relativa. */
  ndviAtteso: [number, number];
  /** Azoto target (mg/kg) per la crop: sotto = deficit nutrizionale. */
  azotoTarget: number;
  /** Sostanza organica target (%). */
  sostanzaOrganicaTarget: number;
}

/**
 * Pesi di default per crop (editabili): quanto ciascun fattore conta nel
 * punteggio sintetico. Le arboree pesano di più il vigore/patologie; i
 * seminativi a copertura continua pesano di più lo stress idrico. Valori
 * indicativi, non costanti regolatorie.
 */
const PESI_COLTURA: Record<
  CropType,
  Pick<SummaryCalibration, "pesoStress" | "pesoPatologico" | "pesoVigore" | "pesoSuolo">
> = {
  vite: { pesoStress: 0.3, pesoPatologico: 0.35, pesoVigore: 0.2, pesoSuolo: 0.15 },
  olivo: { pesoStress: 0.25, pesoPatologico: 0.35, pesoVigore: 0.25, pesoSuolo: 0.15 },
  melo: { pesoStress: 0.3, pesoPatologico: 0.3, pesoVigore: 0.25, pesoSuolo: 0.15 },
  frumento: { pesoStress: 0.4, pesoPatologico: 0.2, pesoVigore: 0.25, pesoSuolo: 0.15 },
  mais: { pesoStress: 0.45, pesoPatologico: 0.15, pesoVigore: 0.25, pesoSuolo: 0.15 },
  pomodoro: { pesoStress: 0.4, pesoPatologico: 0.25, pesoVigore: 0.2, pesoSuolo: 0.15 },
};

const AZOTO_TARGET: Record<CropType, number> = {
  vite: 20,
  olivo: 18,
  melo: 25,
  frumento: 30,
  mais: 35,
  pomodoro: 30,
};

/** Calibrazione della summary per crop e phase (banda NDVI dalla fenologia). */
export function summaryCalibration(
  crop: CropType,
  phase: PhenologicalPhase,
): SummaryCalibration {
  return {
    ...PESI_COLTURA[crop],
    ndviAtteso: getPhaseCalibration(crop, phase).ndviAtteso,
    azotoTarget: AZOTO_TARGET[crop] ?? 25,
    sostanzaOrganicaTarget: 2,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Deficit di vigore 0..1 dall'NDVI rispetto alla banda attesa (hi→0, lo→1). */
function deficitVigore(ndvi: number, banda: [number, number]): number {
  const [lo, hi] = banda;
  if (hi <= lo) return 0;
  return clamp01((hi - ndvi) / (hi - lo));
}

/** Deficit nutrizionale 0..1 da azoto/sostanza organica rispetto ai target. */
function soilDeficit(
  azoto: number | null | undefined,
  so: number | null | undefined,
  cal: SummaryCalibration,
): number | null {
  const termini: number[] = [];
  if (typeof azoto === "number" && cal.azotoTarget > 0) {
    termini.push(clamp01((cal.azotoTarget - azoto) / cal.azotoTarget));
  }
  if (typeof so === "number" && cal.sostanzaOrganicaTarget > 0) {
    termini.push(clamp01((cal.sostanzaOrganicaTarget - so) / cal.sostanzaOrganicaTarget));
  }
  if (termini.length === 0) return null;
  return termini.reduce((a, b) => a + b, 0) / termini.length;
}

/**
 * Punteggio di risk sintetico 0..1 (0 ottimale, 1 critico), bilanciato per
 * crop. I fattori non disponibili (NDVI o soil assenti) vengono esclusi e i
 * pesi rinormalizzati sui fattori presenti, così il punteggio resta in [0,1].
 */
export function summarizeFieldRisk(
  ingressi: FieldSummaryInputs,
  cal: SummaryCalibration,
): number {
  const termini: Array<{ peso: number; value: number }> = [
    { peso: cal.pesoStress, value: clamp01(ingressi.stressIdrico01) },
    { peso: cal.pesoPatologico, value: clamp01(ingressi.rischioPatologico01) },
  ];
  if (typeof ingressi.ndvi === "number") {
    termini.push({
      peso: cal.pesoVigore,
      value: deficitVigore(ingressi.ndvi, cal.ndviAtteso),
    });
  }
  const soil = soilDeficit(ingressi.azoto, ingressi.sostanzaOrganica, cal);
  if (soil != null) termini.push({ peso: cal.pesoSuolo, value: soil });

  const pesoTot = termini.reduce((a, t) => a + t.peso, 0);
  if (pesoTot <= 0) return 0;
  return clamp01(
    termini.reduce((a, t) => a + t.peso * t.value, 0) / pesoTot,
  );
}

// ---------------------------------------------------------------------------
// Rampa cromatica e overlay coropletico
// ---------------------------------------------------------------------------

const VERDE = "#1a9850";
const GIALLO = "#fee08b";
const ROSSO = "#d73027";

/**
 * Rampa del risk DSS verde→giallo→rosso sul dominio 0..1, calibrata per
 * crop: la posizione del giallo (ingresso in allerta) si sposta in base alla
 * sensibilità della crop — le più sensibili allertano prima. Il rosso marca
 * lo stato critico (≥ soglia rossa).
 */
export function dssRiskRamp(crop: CropType): ColorRamp {
  // Sensibilità ≈ peso combinato di stress+patologie: più alta ⇒ allerta prima.
  const pesi = PESI_COLTURA[crop];
  const sensibilita = pesi.pesoStress + pesi.pesoPatologico; // ~0.5..0.6
  const sogliaGialla = clamp01(0.45 - (sensibilita - 0.5) * 0.4);
  const sogliaRossa = clamp01(0.72 - (sensibilita - 0.5) * 0.3);
  return [
    [0, VERDE],
    [Math.min(sogliaGialla, sogliaRossa - 0.05), GIALLO],
    [sogliaRossa, ROSSO],
  ];
}

/** Componente esadecimale a 2 cifre. */
function due(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/** Colore esadecimale del punteggio secondo la rampa (step: last soglia vince). */
export function dssRiskColor(score: number, rampa: ColorRamp): string {
  let hex = rampa[0]?.[1] ?? VERDE;
  for (const [soglia, colore] of rampa) {
    if (score >= soglia) hex = colore;
  }
  // Normalizza eventuali "#rgb" in "#rrggbb" per coerenza nelle properties.
  const { r, g, b } = hexToRgb(hex);
  return `#${due(r)}${due(g)}${due(b)}`;
}

/** Etichetta qualitativa del punteggio per tooltip/legenda. */
export function dssRiskLevelFn(score: number): "ottimale" | "allerta" | "critico" {
  if (score >= 0.66) return "critico";
  if (score >= 0.4) return "allerta";
  return "ottimale";
}

export interface FieldSummary {
  /** Punteggio di risk 0..1 dell'appezzamento. */
  rischio01: number;
}

/**
 * Costruisce l'overlay coropletico: ogni plot diventa una feature
 * poligonale colorata in base al punteggio sintetico. Gli plots senza
 * summary disponibile sono omessi (nessun colore arbitrario).
 */
export function buildDssOverlay(
  plots: Plot[],
  summaryPerField: Map<string, FieldSummary>,
  rampa: ColorRamp,
): FeatureCollection {
  const features: Feature[] = [];
  for (const a of plots) {
    const summary = summaryPerField.get(a.id);
    if (!summary) continue;
    const score = clamp01(summary.rischio01);
    features.push({
      type: "Feature",
      geometry: a.geometry,
      properties: {
        id: a.id,
        plot_name: a.user_plot_name,
        rischio01: Math.round(score * 100) / 100,
        livello: dssRiskLevelFn(score),
        fillColor: dssRiskColor(score, rampa),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
