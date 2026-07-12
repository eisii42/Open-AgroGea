/**
 * Matrici di calibrazione fenologica per coltura.
 *
 * Gli indici spettrali non vanno letti in assoluto ma parametrizzati sulla
 * coltura e sulla phase fenologica: la stessa media NDVI significa "vigore
 * scarso" su un seminativo a piena copertura e "normale" su un vigneto a
 * inizio stagione. Qui vivono, come dati puri:
 *   * la soglia di soil-masking (isola la chioma dall'interfila);
 *   * il coefficiente colturale Kc per phase (per ETc = ET0·Kc, vedi agrometeo);
 *   * le soglie termiche base/superiore per i gradi-day (vedi fitopatologia);
 *   * banda d'index attesa per phase, base della scala di vigore relativa.
 *
 * Valori indicativi da letteratura agronomica/FAO-56, pensati come default
 * editabili dall'utente: NON costanti regolatorie.
 */

export type CropType =
  | "vite"
  | "olivo"
  | "melo"
  | "frumento"
  | "mais"
  | "pomodoro";

export type PhenologicalPhase =
  | "iniziale"
  | "sviluppo"
  | "piena"
  | "maturazione";

export interface PhaseCalibration {
  phase: PhenologicalPhase;
  /** Coefficiente colturale Kc (FAO-56) per ETc = ET0 · Kc. */
  kc: number;
  /** Soglia NDVI di soil-masking: pixel sotto = interfila/suolo nudo. */
  ndviSoilMask: number;
  /** Banda NDVI attesa [min,max] per la phase: scala di vigore relativa. */
  ndviAtteso: [number, number];
}

export interface CropMatrix {
  coltura: CropType;
  /** CropType arborea/specializzata: il soil-masking è attivo di default. */
  arborea: boolean;
  /** Soglie termiche per i gradi-day (°C): base e cutoff superiore. */
  tBase: number;
  tCutoff: number;
  fasi: PhaseCalibration[];
}

export const CROP_MATRICES: Record<CropType, CropMatrix> = {
  vite: {
    coltura: "vite",
    arborea: true,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.3, ndviSoilMask: 0.35, ndviAtteso: [0.25, 0.45] },
      { phase: "sviluppo", kc: 0.7, ndviSoilMask: 0.4, ndviAtteso: [0.45, 0.65] },
      { phase: "piena", kc: 0.85, ndviSoilMask: 0.45, ndviAtteso: [0.6, 0.85] },
      { phase: "maturazione", kc: 0.45, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.75] },
    ],
  },
  olivo: {
    coltura: "olivo",
    arborea: true,
    tBase: 9,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.55, ndviSoilMask: 0.3, ndviAtteso: [0.3, 0.5] },
      { phase: "sviluppo", kc: 0.6, ndviSoilMask: 0.35, ndviAtteso: [0.4, 0.6] },
      { phase: "piena", kc: 0.65, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.7] },
      { phase: "maturazione", kc: 0.6, ndviSoilMask: 0.35, ndviAtteso: [0.45, 0.65] },
    ],
  },
  melo: {
    coltura: "melo",
    arborea: true,
    tBase: 7,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.45, ndviSoilMask: 0.35, ndviAtteso: [0.3, 0.5] },
      { phase: "sviluppo", kc: 0.85, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.7] },
      { phase: "piena", kc: 1.0, ndviSoilMask: 0.45, ndviAtteso: [0.65, 0.88] },
      { phase: "maturazione", kc: 0.75, ndviSoilMask: 0.4, ndviAtteso: [0.55, 0.78] },
    ],
  },
  frumento: {
    coltura: "frumento",
    arborea: false,
    tBase: 0,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { phase: "sviluppo", kc: 0.8, ndviSoilMask: 0.25, ndviAtteso: [0.5, 0.75] },
      { phase: "piena", kc: 1.15, ndviSoilMask: 0.3, ndviAtteso: [0.7, 0.9] },
      { phase: "maturazione", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.3, 0.6] },
    ],
  },
  mais: {
    coltura: "mais",
    arborea: false,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { phase: "sviluppo", kc: 0.8, ndviSoilMask: 0.3, ndviAtteso: [0.5, 0.75] },
      { phase: "piena", kc: 1.2, ndviSoilMask: 0.35, ndviAtteso: [0.75, 0.92] },
      { phase: "maturazione", kc: 0.6, ndviSoilMask: 0.25, ndviAtteso: [0.4, 0.7] },
    ],
  },
  pomodoro: {
    coltura: "pomodoro",
    arborea: false,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { phase: "iniziale", kc: 0.6, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { phase: "sviluppo", kc: 0.85, ndviSoilMask: 0.3, ndviAtteso: [0.45, 0.7] },
      { phase: "piena", kc: 1.15, ndviSoilMask: 0.35, ndviAtteso: [0.7, 0.9] },
      { phase: "maturazione", kc: 0.8, ndviSoilMask: 0.3, ndviAtteso: [0.5, 0.78] },
    ],
  },
};

export function getCropMatrix(coltura: CropType): CropMatrix {
  const matrix = CROP_MATRICES[coltura];
  if (!matrix) throw new Error(`CropType without matrix di calibrazione: ${coltura}`);
  return matrix;
}

export function getPhaseCalibration(
  coltura: CropType,
  phase: PhenologicalPhase,
): PhaseCalibration {
  const cal = getCropMatrix(coltura).fasi.find((f) => f.phase === phase);
  if (!cal) throw new Error(`Fase ${phase} non definita per ${coltura}.`);
  return cal;
}

/**
 * Soglia di soil-masking consigliata: solo per le colture arboree
 * (vigneti/frutteti, dove l'interfila va isolato). Per i seminativi a copertura
 * continua restituisce `null` (masking non applicato).
 */
export function soilMaskThreshold(
  coltura: CropType,
  phase: PhenologicalPhase,
): number | null {
  const matrix = getCropMatrix(coltura);
  if (!matrix.arborea) return null;
  return getPhaseCalibration(coltura, phase).ndviSoilMask;
}
