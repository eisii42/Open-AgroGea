/**
 * Engine agrometeorologico (Modulo 2 — Acqua/Irrigazione).
 *
 * Tutto in locale, su dati di stazione meteo (`letture_meteo`):
 *   * ET0 — evapotraspirazione di riferimento, Penman-Monteith FAO-56;
 *   * ETc = ET0 · Kc — evapotraspirazione colturale (Kc dalla fenologia);
 *   * bilancio idrico del suolo — acqua disponibile tra capacità di campo e
 *     punto di appassimento, e stima dei giorni di autonomia prima dello stress.
 *
 * Riferimento: Allen et al., FAO Irrigation and Drainage Paper 56 (1998).
 */

export interface WeatherDataDay {
  /** Temperatura minima/massima del day (°C). */
  tMin: number;
  tMax: number;
  /** Umidità relativa minima/massima del day (%). */
  rhMin: number;
  rhMax: number;
  /** Velocità del vento a 2 m (m/s). */
  windSpeed2m: number;
  /** Radiazione solare incidente (MJ m⁻² day⁻¹). */
  radiation: number;
  /** Quota della stazione (m s.l.m.). */
  altitude: number;
}

const G_SOIL_FLUX = 0; // flusso di calore nel suolo, ~0 su base giornaliera
const GAMMA_CONST = 0.665e-3; // costante psicrometrica × P
const ALBEDO = 0.23; // coltura di riferimento (erba)
const STEFAN_BOLTZMANN = 4.903e-9; // MJ K⁻⁴ m⁻² day⁻¹

/** Pressione di vapore a saturazione e_s(T) [kPa] (Tetens). */
function saturationPressure(t: number): number {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/** Pendenza della curva di pressione di vapore Δ [kPa °C⁻¹]. */
function vaporSlope(t: number): number {
  const es = saturationPressure(t);
  return (4098 * es) / Math.pow(t + 237.3, 2);
}

/**
 * ET0 giornaliera (mm/day) con Penman-Monteith FAO-56.
 * `radiazioneNetta` è opzionale: se assente è stimata da radiazione/umidità.
 */
export function et0PenmanMonteith(
  m: WeatherDataDay,
  options: { netLongwaveRadiation?: number } = {},
): number {
  const tMean = (m.tMax + m.tMin) / 2;
  const delta = vaporSlope(tMean);

  // Pressione atmosferica e costante psicrometrica γ dall'altitudine.
  const P = 101.3 * Math.pow((293 - 0.0065 * m.altitude) / 293, 5.26);
  const gamma = GAMMA_CONST * P;

  // Pressioni di vapore: saturazione media e effettiva da RH min/max.
  const esTmax = saturationPressure(m.tMax);
  const esTmin = saturationPressure(m.tMin);
  const es = (esTmax + esTmin) / 2;
  const ea =
    (esTmin * (m.rhMax / 100) + esTmax * (m.rhMin / 100)) / 2;

  // Radiazione netta: onda corta (1−albedo)·Rs meno onda lunga uscente.
  const rns = (1 - ALBEDO) * m.radiation;
  const tMaxK = m.tMax + 273.16;
  const tMinK = m.tMin + 273.16;
  const rnl =
    options.netLongwaveRadiation ??
    STEFAN_BOLTZMANN *
      ((Math.pow(tMaxK, 4) + Math.pow(tMinK, 4)) / 2) *
      (0.34 - 0.14 * Math.sqrt(ea)) *
      0.9; // fattore nuvolosità semplificato (cielo per lo più sereno)
  const rn = rns - rnl;

  const numerator =
    0.408 * delta * (rn - G_SOIL_FLUX) +
    gamma * (900 / (tMean + 273)) * m.windSpeed2m * (es - ea);
  const denominator = delta + gamma * (1 + 0.34 * m.windSpeed2m);
  return Math.max(0, numerator / denominator);
}

/** ETc = ET0 · Kc (Kc colturale per phase, da `fenologia.ts`). */
export function cropEt(et0: number, kc: number): number {
  return et0 * kc;
}

// ---------------------------------------------------------------------------
// Bilancio idrico del suolo
// ---------------------------------------------------------------------------

export interface SoilParameters {
  /** Capacità di campo (frazione volumetrica, es. 0.30). */
  fieldCapacity: number;
  /** Punto di appassimento (frazione volumetrica, es. 0.12). */
  wiltingPoint: number;
  /** Profondità delle radici (m). */
  rootDepth: number;
  /**
   * Frazione di acqua disponibile estraibile senza stress (p, 0..1):
   * sotto questa soglia la coltura entra in stress idrico. FAO-56 ~0.5.
   */
  depletionFraction: number;
}

export interface WaterStatus {
  /** Acqua disponibile totale tra CC e PA (mm). */
  awc: number;
  /** Acqua facilmente disponibile prima dello stress (mm). */
  raw: number;
  /** Deplezione corrente dalla capacità di campo (mm). */
  depletion: number;
  /** Acqua residua prima della soglia di stress (mm). */
  marginBeforeStress: number;
  /** true se la coltura è già in stress idrico. */
  inStress: boolean;
}

/**
 * Acqua disponibile e soglie del suolo. AWC = (CC − PA)·profondità (mm),
 * RAW = p·AWC: sotto RAW di depletion, la coltura va in stress.
 */
export function soilWaterStatus(
  soil: SoilParameters,
  currentDepletion: number,
): WaterStatus {
  const awc =
    (soil.fieldCapacity - soil.wiltingPoint) *
    soil.rootDepth *
    1000;
  const raw = soil.depletionFraction * awc;
  const depletion = Math.max(0, Math.min(currentDepletion, awc));
  return {
    awc,
    raw,
    depletion,
    marginBeforeStress: raw - depletion,
    inStress: depletion >= raw,
  };
}

export interface IrrigationPlanDay {
  day: number;
  etc: number;
  rain: number;
  irrigation: number;
  depletion: number;
  inStress: boolean;
}

// ---------------------------------------------------------------------------
// Bilancio idrico dinamico — equazione di depletion FAO-56 §8 / FAO-66
// ---------------------------------------------------------------------------

export interface WaterBalanceDay {
  day: number;
  /** Evapotraspirazione colturale ETc del day (mm). */
  etc: number;
  /** Pioggia efficace P del day (mm). */
  rain: number;
  /** Apporto irriguo I del day (mm). */
  irrigation: number;
  /**
   * Percolazione profonda DP del day (mm): acqua che drena sotto la zona
   * radicale quando l'apporto (P+I) eccede la capacità di campo. È un TERMINE
   * ESPLICITO del bilancio (FAO-56 eq.88), non più implicito nel clamp.
   */
  percolation: number;
  /** Deplezione radicale Dr,t a fine giornata (mm), entro [0, AWC]. */
  depletion: number;
  /** Acqua facilmente disponibile RAW (mm), costante della parcella. */
  raw: number;
  /** Acqua disponibile totale AWC (mm), costante della parcella. */
  awc: number;
  /** true se Dr,t ≥ RAW (stress idrico in atto). */
  inStress: boolean;
}

/**
 * Bilancio idrico del suolo per ZONA RADICALE con l'equazione di depletion
 * FAO-56 (eq.85), forma esplicita richiesta dalla DSS irrigua AgroGea:
 *
 *   Dr,t = Dr,t-1 − P_t − I_t + ETc,t + DP_t        (poi limitata a [0, AWC])
 *
 * dove la percolation profonda DP,t = max(0, −(Dr,t-1 − P_t − I_t + ETc,t)) è
 * l'eccesso d'acqua oltre la capacità di campo (Dr = 0). Si differenzia da
 * {@link irrigationPlan} (che è un piano irriguo predittivo con irrigation
 * automatica): qui l'irrigation è un INPUT misurato dai log gestionali e DP è
 * tracciato day per day per la persistenza (`soil_water_indices`).
 *
 * Risalita capillare (CR) e ruscellamento (RO) sono trascurati (≈0): default
 * conservativo, coerente con i dati disponibili da stazione.
 */
export function waterBalanceFao66(
  soil: SoilParameters,
  etcSeries: number[],
  rainSeries: number[],
  irrigationSeries: number[] = [],
  initialDepletion = 0,
): { series: WaterBalanceDay[]; autonomyDays: number } {
  const state0 = soilWaterStatus(soil, initialDepletion);
  const series: WaterBalanceDay[] = [];

  let depletion = state0.depletion;
  let autonomyDays = etcSeries.length;
  let autonomyFound = false;

  for (let g = 0; g < etcSeries.length; g++) {
    const etc = Math.max(0, etcSeries[g] ?? 0);
    const rain = Math.max(0, rainSeries[g] ?? 0);
    const irrigation = Math.max(0, irrigationSeries[g] ?? 0);

    // Dr provvisorio prima dei limiti fisici del suolo.
    const provisionalDr = depletion - rain - irrigation + etc;
    // DP: l'eccesso oltre la capacità di campo (Dr<0) percola in profondità e
    // riporta Dr a 0. Non c'è percolation finché il profilo non è saturo.
    const percolation = Math.max(0, -provisionalDr);
    // Limite inferiore 0 (capacità di campo) e superiore AWC (punto di
    // appassimento: oltre non c'è più acqua estraibile).
    depletion = Math.min(Math.max(provisionalDr, 0), state0.awc);

    const inStress = depletion >= state0.raw;
    if (!autonomyFound && inStress) {
      autonomyDays = g;
      autonomyFound = true;
    }

    series.push({
      day: g,
      etc,
      rain,
      irrigation,
      percolation,
      depletion,
      raw: state0.raw,
      awc: state0.awc,
      inStress,
    });
  }

  return { series, autonomyDays };
}

/**
 * Coefficiente di stress idrico Ks (FAO-56 eq.84): 1 quando l'acqua è
 * facilmente disponibile (Dr ≤ RAW), poi decresce linearmente fino a 0 al punto
 * di appassimento (Dr = AWC). Sotto RAW la traspirazione (e quindi la resa) è
 * ridotta proporzionalmente.
 */
export function waterStressCoefficient(
  depletion: number,
  raw: number,
  awc: number,
): number {
  if (depletion <= raw) return 1;
  const denom = awc - raw;
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, (awc - depletion) / denom));
}

/**
 * Riduzione potenziale di resa per stress idrico (FAO-33/66):
 *
 *   1 − Ya/Ym = Ky · (1 − ETa/ETc) = Ky · (1 − Ks)
 *
 * con Ks da {@link waterStressCoefficient} e Ky fattore di risposta della
 * coltura (default editabile). Ritorna la frazione di resa persa in [0, 1].
 */
export function yieldReductionFao66(
  depletion: number,
  raw: number,
  awc: number,
  ky: number,
): number {
  const ks = waterStressCoefficient(depletion, raw, awc);
  return Math.max(0, Math.min(1, ky * (1 - ks)));
}

/**
 * Piano idrico predittivo (DSS irriguo): proietta il bilancio day per
 * day e suggerisce volume e momento dell'intervento. Quando la depletion
 * raggiunge RAW, prescrive un'irrigation che riporta a capacità di campo.
 *
 * `etcSerie` e `pioggiaSerie` (mm/day) hanno la stessa lunghezza =
 * orizzonte di previsione. Ritorna la series giornaliera e i giorni di
 * autonomia residua dall'oggi (prima del primo stress senza irrigare).
 */
export function irrigationPlan(
  soil: SoilParameters,
  etcSeries: number[],
  rainSeries: number[],
  initialDepletion = 0,
  options: { autoIrrigate?: boolean } = {},
): { series: IrrigationPlanDay[]; autonomyDays: number } {
  const state0 = soilWaterStatus(soil, initialDepletion);
  const autoIrrigate = options.autoIrrigate ?? true;
  const series: IrrigationPlanDay[] = [];

  let depletion = state0.depletion;
  let autonomyDays = etcSeries.length;
  let autonomyFound = false;

  for (let g = 0; g < etcSeries.length; g++) {
    const etc = etcSeries[g];
    const rain = rainSeries[g] ?? 0;
    // Aggiunge ETc (asciuga), sottrae rain (ricarica), entro [0, AWC].
    depletion = Math.max(0, Math.min(depletion + etc - rain, state0.awc));

    if (!autonomyFound && depletion >= state0.raw) {
      autonomyDays = g;
      autonomyFound = true;
    }

    let irrigation = 0;
    if (autoIrrigate && depletion >= state0.raw) {
      irrigation = depletion; // ripristina la capacità di campo
      depletion = 0;
    }

    series.push({
      day: g,
      etc,
      rain,
      irrigation,
      depletion,
      inStress: !autoIrrigate && depletion >= state0.raw,
    });
  }

  return { series, autonomyDays };
}
