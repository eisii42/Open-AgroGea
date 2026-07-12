/**
 * DSS fitopatologico (Modulo 3 — difesa integrata).
 *
 * Motori locali e puri su series meteo (`letture_meteo`):
 *   * accumulo termico (gradi-day) per fenologia di colture e insetti;
 *   * regola "tre-dieci" per l'infezione primaria di peronospora della vite;
 *   * risk di oidio su finestre termiche.
 *
 * Output: alert tipizzati che la UI aggancia alla timeline dell'appezzamento.
 * I parametri (soglie termiche, target) sono default editabili, non costanti
 * regolatorie.
 */

export type RiskLevel = "nullo" | "basso" | "medio" | "alto";

export interface PhytopathologyAlert {
  model: string;
  risk: RiskLevel;
  /** Indice 1..5 per la gauge del DSS (Design.md §DSS). */
  index: number;
  message: string;
  /** Giorno (index nella series) a cui si riferisce l'alert. */
  day: number;
}

// ---------------------------------------------------------------------------
// Gradi-day (Growing Degree Days)
// ---------------------------------------------------------------------------

/**
 * Gradi-day di un day con il method media-soglia:
 *   GDD = clamp((Tmax+Tmin)/2, [tBase, tCutoff]) − tBase
 * Il cutoff superiore evita che temperature estreme gonfino l'accumulo (le
 * soglie tBase/tCutoff vengono dalla matrice della coltura/target).
 */
export function degreeDaysMeanThreshold(
  tMin: number,
  tMax: number,
  tBase: number,
  tCutoff = Number.POSITIVE_INFINITY,
): number {
  const media = (tMax + tMin) / 2;
  const limitata = Math.min(Math.max(media, tBase), tCutoff);
  return Math.max(0, limitata - tBase);
}

/**
 * Gradi-day col method single-sine (Baskerville-Emin): integra la curva
 * termica sinusoidale del day, più accurato del media-soglia per gli
 * insetti vicino alla soglia base. Restituisce GDD del singolo day.
 */
export function degreeDaysSingleSine(
  tMin: number,
  tMax: number,
  tBase: number,
): number {
  if (tMax <= tBase) return 0;
  if (tMin >= tBase) return (tMax + tMin) / 2 - tBase;
  // tMin < tBase < tMax: integrazione parziale della semionda.
  const media = (tMax + tMin) / 2;
  const ampiezza = (tMax - tMin) / 2;
  const theta = Math.asin((tBase - media) / ampiezza);
  return (
    (1 / Math.PI) *
    ((media - tBase) * (Math.PI / 2 - theta) + ampiezza * Math.cos(theta))
  );
}

export interface ThermalPoint {
  tMin: number;
  tMax: number;
}

/**
 * Accumulo cumulative di gradi-day su una series; segnala il day in cui si
 * supera una soglia obiettivo (es. comparsa di un target). `method` sceglie la
 * formula giornaliera.
 */
export function degreeDayAccumulation(
  series: ThermalPoint[],
  tBase: number,
  options: {
    tCutoff?: number;
    targetThreshold?: number;
    method?: "media-soglia" | "single-sine";
  } = {},
): { cumulative: number[]; thresholdDay: number | null } {
  const method = options.method ?? "media-soglia";
  const cumulative: number[] = [];
  let acc = 0;
  let thresholdDay: number | null = null;
  series.forEach((p, i) => {
    const gdd =
      method === "single-sine"
        ? degreeDaysSingleSine(p.tMin, p.tMax, tBase)
        : degreeDaysMeanThreshold(p.tMin, p.tMax, tBase, options.tCutoff);
    acc += gdd;
    cumulative.push(acc);
    if (
      thresholdDay === null &&
      options.targetThreshold !== undefined &&
      acc >= options.targetThreshold
    ) {
      thresholdDay = i;
    }
  });
  return { cumulative, thresholdDay };
}

// ---------------------------------------------------------------------------
// Peronospora della vite — regola "tre-dieci"
// ---------------------------------------------------------------------------

export interface DownyMildewDay {
  /** Temperatura media giornaliera (°C). */
  tMean: number;
  /** Pioggia del day (mm). */
  rain: number;
  /** Lunghezza dei germogli (cm). */
  shootLength: number;
}

/**
 * Regola "tre-dieci" (Baldacci/Goidanich) per l'infezione primaria di
 * Plasmopara viticola: risk quando, in 24-48 h, si verificano insieme
 *   * germogli ≥ 10 cm,
 *   * temperatura media ≥ 10 °C,
 *   * rain ≥ 10 mm.
 * Ritorna l'alert nel primo day in cui le tre condizioni coesistono.
 */
export function threeTenRule(
  series: DownyMildewDay[],
): PhytopathologyAlert | null {
  for (let i = 0; i < series.length; i++) {
    const g = series[i];
    if (g.tMean >= 10 && g.rain >= 10 && g.shootLength >= 10) {
      return {
        model: "Peronospora (tre-dieci)",
        risk: "alto",
        index: 5,
        message:
          "Condizioni per l'infezione primaria: germogli ≥10 cm, T media ≥10 °C, rain ≥10 mm. Valutare trattamento preventivo.",
        day: i,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Oidio — finestra termica favorevole
// ---------------------------------------------------------------------------

export interface PowderyMildewDay {
  tMin: number;
  tMax: number;
  /** Umidità relativa media (%). */
  rhMean: number;
}

// ---------------------------------------------------------------------------
// Normalizzazione del risk (0.0 nullo → 1.0 critico)
// ---------------------------------------------------------------------------

/**
 * Porta l'index 1..5 della gauge DSS sulla scala normalizzata richiesta dalla
 * mappa colorata e dallo stato del modulo: 0.0 (nullo) → 1.0 (critico). Un
 * alert assente vale 0; l'index 5 (es. infezione primaria conclamata) vale 1.
 */
export function normalizeRiskIndex(index: number): number {
  return Math.max(0, Math.min(1, index / 5));
}

/** Valore normalizzato 0..1 di un livello qualitativo (per le sintesi senza index). */
export function riskLevelA01(risk: RiskLevel): number {
  switch (risk) {
    case "alto":
      return 1;
    case "medio":
      return 0.6;
    case "basso":
      return 0.3;
    default:
      return 0;
  }
}

/** Indice normalizzato 0..1 di un alert (0 se nullo/assente). */
export function alertA01(alert: PhytopathologyAlert | null): number {
  if (!alert) return 0;
  return normalizeRiskIndex(alert.index);
}

/**
 * Rischio di oidio (Erysiphe necator): favorito da temperature 20-27 °C e
 * umidità moderata, sfavorito da T>32 °C o piogge battenti. Modello a soglie
 * giornaliero, con escalation se i giorni favorevoli sono consecutivi.
 */
export function powderyMildewRisk(series: PowderyMildewDay[]): PhytopathologyAlert | null {
  let consecutivi = 0;
  let peggior: PhytopathologyAlert | null = null;
  for (let i = 0; i < series.length; i++) {
    const g = series[i];
    const tMean = (g.tMin + g.tMax) / 2;
    const favorevole =
      tMean >= 20 && tMean <= 27 && g.tMax < 32 && g.rhMean >= 40;
    consecutivi = favorevole ? consecutivi + 1 : 0;

    if (consecutivi >= 1) {
      const risk: RiskLevel =
        consecutivi >= 3 ? "alto" : consecutivi >= 2 ? "medio" : "basso";
      const index = consecutivi >= 3 ? 4 : consecutivi >= 2 ? 3 : 2;
      const alert: PhytopathologyAlert = {
        model: "Oidio (finestra termica)",
        risk,
        index,
        message: `Condizioni favorevoli all'oidio da ${consecutivi} day/i (T media ${tMean.toFixed(1)} °C). Monitorare e valutare difesa.`,
        day: i,
      };
      if (!peggior || alert.index > peggior.index) peggior = alert;
    }
  }
  return peggior;
}

// ---------------------------------------------------------------------------
// Occhio di pavone dell'olivo — Spilocaea oleagina (Fusicladium oleagineum)
// ---------------------------------------------------------------------------

export interface PeacockEyeDay {
  tMin: number;
  tMax: number;
  /** Ore di bagnatura fogliare del day (0..24). */
  leafWetnessHours: number;
}

/** Ore di bagnatura minime per un evento d'infezione favorevole. */
const WETNESS_THRESHOLD_HOURS = 10;
/** Banda termica favorevole alla germinazione dei conidi (°C). */
const OCCHIO_T_MIN = 8;
const OCCHIO_T_OTTIMALE_MAX = 22;
const OCCHIO_T_MAX = 26;

/**
 * Rischio di occhio di pavone (Spilocaea oleagina): la germinazione dei conidi
 * e l'infezione richiedono BAGNATURA FOGLIARE prolungata (≥ ~10 h) con
 * temperatura mite (ottimo ~15-20 °C, tollerata ~8-26 °C); umidità alta e
 * temperature primaverili/autunnali sono il driver, non l'estate secca. Modello
 * a soglie giornaliero con escalation sui giorni d'infezione consecutivi
 * (pattern di {@link powderyMildewRisk}). Ritorna l'alert peggiore della finestra.
 */
export function peacockEyeRisk(
  series: PeacockEyeDay[],
): PhytopathologyAlert | null {
  let consecutivi = 0;
  let peggior: PhytopathologyAlert | null = null;
  for (let i = 0; i < series.length; i++) {
    const g = series[i];
    const tMean = (g.tMin + g.tMax) / 2;
    const bagnaturaOk = g.leafWetnessHours >= WETNESS_THRESHOLD_HOURS;
    const termicaOk = tMean >= OCCHIO_T_MIN && tMean <= OCCHIO_T_MAX;
    const favorevole = bagnaturaOk && termicaOk;
    consecutivi = favorevole ? consecutivi + 1 : 0;

    if (favorevole) {
      // Bagnatura lunga in piena banda ottimale: evento severo anche singolo.
      const ottimale =
        g.leafWetnessHours >= 18 && tMean <= OCCHIO_T_OTTIMALE_MAX;
      const index = consecutivi >= 3 || ottimale ? 5 : consecutivi >= 2 ? 4 : 3;
      const risk: RiskLevel =
        index >= 5 ? "alto" : index >= 4 ? "medio" : "basso";
      const alert: PhytopathologyAlert = {
        model: "Occhio di pavone (bagnatura-temperatura)",
        risk,
        index,
        message: `Bagnatura fogliare ${g.leafWetnessHours.toFixed(0)} h con T media ${tMean.toFixed(1)} °C${consecutivi > 1 ? ` da ${consecutivi} days` : ""}: condizioni d'infezione per Spilocaea oleagina. Valutare difesa rameica.`,
        day: i,
      };
      if (!peggior || alert.index > peggior.index) peggior = alert;
    }
  }
  return peggior;
}
