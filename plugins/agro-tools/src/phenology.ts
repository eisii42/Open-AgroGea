/**
 * Matrici di calibrazione fenologica per coltura.
 *
 * Gli indici spettrali non vanno letti in assoluto ma parametrizzati sulla
 * coltura e sulla fase fenologica: la stessa media NDVI significa "vigore
 * scarso" su un seminativo a piena copertura e "normale" su un vigneto a
 * inizio stagione. Qui vivono, come dati puri:
 *   * la soglia di soil-masking (isola la chioma dall'interfila);
 *   * il coefficiente colturale Kc per fase (per ETc = ET0·Kc, vedi agrometeo);
 *   * le soglie termiche base/superiore per i gradi-giorno (vedi fitopatologia);
 *   * banda d'indice attesa per fase, base della scala di vigore relativa.
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

export type FaseFenologica =
  | "iniziale"
  | "sviluppo"
  | "piena"
  | "maturazione";

export interface CalibrazioneFase {
  fase: FaseFenologica;
  /** Coefficiente colturale Kc (FAO-56) per ETc = ET0 · Kc. */
  kc: number;
  /** Soglia NDVI di soil-masking: pixel sotto = interfila/suolo nudo. */
  ndviSoilMask: number;
  /** Banda NDVI attesa [min,max] per la fase: scala di vigore relativa. */
  ndviAtteso: [number, number];
}

export interface MatriceColtura {
  coltura: CropType;
  /** CropType arborea/specializzata: il soil-masking è attivo di default. */
  arborea: boolean;
  /** Soglie termiche per i gradi-giorno (°C): base e cutoff superiore. */
  tBase: number;
  tCutoff: number;
  fasi: CalibrazioneFase[];
}

export const MATRICI_COLTURA: Record<CropType, MatriceColtura> = {
  vite: {
    coltura: "vite",
    arborea: true,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.3, ndviSoilMask: 0.35, ndviAtteso: [0.25, 0.45] },
      { fase: "sviluppo", kc: 0.7, ndviSoilMask: 0.4, ndviAtteso: [0.45, 0.65] },
      { fase: "piena", kc: 0.85, ndviSoilMask: 0.45, ndviAtteso: [0.6, 0.85] },
      { fase: "maturazione", kc: 0.45, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.75] },
    ],
  },
  olivo: {
    coltura: "olivo",
    arborea: true,
    tBase: 9,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.55, ndviSoilMask: 0.3, ndviAtteso: [0.3, 0.5] },
      { fase: "sviluppo", kc: 0.6, ndviSoilMask: 0.35, ndviAtteso: [0.4, 0.6] },
      { fase: "piena", kc: 0.65, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.7] },
      { fase: "maturazione", kc: 0.6, ndviSoilMask: 0.35, ndviAtteso: [0.45, 0.65] },
    ],
  },
  melo: {
    coltura: "melo",
    arborea: true,
    tBase: 7,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.45, ndviSoilMask: 0.35, ndviAtteso: [0.3, 0.5] },
      { fase: "sviluppo", kc: 0.85, ndviSoilMask: 0.4, ndviAtteso: [0.5, 0.7] },
      { fase: "piena", kc: 1.0, ndviSoilMask: 0.45, ndviAtteso: [0.65, 0.88] },
      { fase: "maturazione", kc: 0.75, ndviSoilMask: 0.4, ndviAtteso: [0.55, 0.78] },
    ],
  },
  frumento: {
    coltura: "frumento",
    arborea: false,
    tBase: 0,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { fase: "sviluppo", kc: 0.8, ndviSoilMask: 0.25, ndviAtteso: [0.5, 0.75] },
      { fase: "piena", kc: 1.15, ndviSoilMask: 0.3, ndviAtteso: [0.7, 0.9] },
      { fase: "maturazione", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.3, 0.6] },
    ],
  },
  mais: {
    coltura: "mais",
    arborea: false,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.4, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { fase: "sviluppo", kc: 0.8, ndviSoilMask: 0.3, ndviAtteso: [0.5, 0.75] },
      { fase: "piena", kc: 1.2, ndviSoilMask: 0.35, ndviAtteso: [0.75, 0.92] },
      { fase: "maturazione", kc: 0.6, ndviSoilMask: 0.25, ndviAtteso: [0.4, 0.7] },
    ],
  },
  pomodoro: {
    coltura: "pomodoro",
    arborea: false,
    tBase: 10,
    tCutoff: 30,
    fasi: [
      { fase: "iniziale", kc: 0.6, ndviSoilMask: 0.2, ndviAtteso: [0.2, 0.4] },
      { fase: "sviluppo", kc: 0.85, ndviSoilMask: 0.3, ndviAtteso: [0.45, 0.7] },
      { fase: "piena", kc: 1.15, ndviSoilMask: 0.35, ndviAtteso: [0.7, 0.9] },
      { fase: "maturazione", kc: 0.8, ndviSoilMask: 0.3, ndviAtteso: [0.5, 0.78] },
    ],
  },
};

export function getMatriceColtura(coltura: CropType): MatriceColtura {
  const matrice = MATRICI_COLTURA[coltura];
  if (!matrice) throw new Error(`CropType senza matrice di calibrazione: ${coltura}`);
  return matrice;
}

export function getCalibrazioneFase(
  coltura: CropType,
  fase: FaseFenologica,
): CalibrazioneFase {
  const cal = getMatriceColtura(coltura).fasi.find((f) => f.fase === fase);
  if (!cal) throw new Error(`Fase ${fase} non definita per ${coltura}.`);
  return cal;
}

/**
 * Soglia di soil-masking consigliata: solo per le colture arboree
 * (vigneti/frutteti, dove l'interfila va isolato). Per i seminativi a copertura
 * continua restituisce `null` (masking non applicato).
 */
export function sogliaSoilMask(
  coltura: CropType,
  fase: FaseFenologica,
): number | null {
  const matrice = getMatriceColtura(coltura);
  if (!matrice.arborea) return null;
  return getCalibrazioneFase(coltura, fase).ndviSoilMask;
}
