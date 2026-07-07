/**
 * DSS fitopatologico (Modulo 3 — difesa integrata).
 *
 * Motori locali e puri su serie meteo (`letture_meteo`):
 *   * accumulo termico (gradi-giorno) per fenologia di colture e insetti;
 *   * regola "tre-dieci" per l'infezione primaria di peronospora della vite;
 *   * rischio di oidio su finestre termiche.
 *
 * Output: alert tipizzati che la UI aggancia alla timeline dell'appezzamento.
 * I parametri (soglie termiche, target) sono default editabili, non costanti
 * regolatorie.
 */

export type LivelloRischio = "nullo" | "basso" | "medio" | "alto";

export interface AlertFitopatologico {
  modello: string;
  rischio: LivelloRischio;
  /** Indice 1..5 per la gauge del DSS (Design.md §DSS). */
  indice: number;
  messaggio: string;
  /** Giorno (indice nella serie) a cui si riferisce l'alert. */
  giorno: number;
}

// ---------------------------------------------------------------------------
// Gradi-giorno (Growing Degree Days)
// ---------------------------------------------------------------------------

/**
 * Gradi-giorno di un giorno con il metodo media-soglia:
 *   GDD = clamp((Tmax+Tmin)/2, [tBase, tCutoff]) − tBase
 * Il cutoff superiore evita che temperature estreme gonfino l'accumulo (le
 * soglie tBase/tCutoff vengono dalla matrice della coltura/target).
 */
export function gradiGiornoMediaSoglia(
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
 * Gradi-giorno col metodo single-sine (Baskerville-Emin): integra la curva
 * termica sinusoidale del giorno, più accurato del media-soglia per gli
 * insetti vicino alla soglia base. Restituisce GDD del singolo giorno.
 */
export function gradiGiornoSingleSine(
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

export interface PuntoTermico {
  tMin: number;
  tMax: number;
}

/**
 * Accumulo cumulato di gradi-giorno su una serie; segnala il giorno in cui si
 * supera una soglia obiettivo (es. comparsa di un target). `metodo` sceglie la
 * formula giornaliera.
 */
export function accumuloGradiGiorno(
  serie: PuntoTermico[],
  tBase: number,
  options: {
    tCutoff?: number;
    sogliaObiettivo?: number;
    metodo?: "media-soglia" | "single-sine";
  } = {},
): { cumulato: number[]; giornoSoglia: number | null } {
  const metodo = options.metodo ?? "media-soglia";
  const cumulato: number[] = [];
  let acc = 0;
  let giornoSoglia: number | null = null;
  serie.forEach((p, i) => {
    const gdd =
      metodo === "single-sine"
        ? gradiGiornoSingleSine(p.tMin, p.tMax, tBase)
        : gradiGiornoMediaSoglia(p.tMin, p.tMax, tBase, options.tCutoff);
    acc += gdd;
    cumulato.push(acc);
    if (
      giornoSoglia === null &&
      options.sogliaObiettivo !== undefined &&
      acc >= options.sogliaObiettivo
    ) {
      giornoSoglia = i;
    }
  });
  return { cumulato, giornoSoglia };
}

// ---------------------------------------------------------------------------
// Peronospora della vite — regola "tre-dieci"
// ---------------------------------------------------------------------------

export interface GiornoPeronospora {
  /** Temperatura media giornaliera (°C). */
  tMedia: number;
  /** Pioggia del giorno (mm). */
  pioggia: number;
  /** Lunghezza dei germogli (cm). */
  lunghezzaGermogli: number;
}

/**
 * Regola "tre-dieci" (Baldacci/Goidanich) per l'infezione primaria di
 * Plasmopara viticola: rischio quando, in 24-48 h, si verificano insieme
 *   * germogli ≥ 10 cm,
 *   * temperatura media ≥ 10 °C,
 *   * pioggia ≥ 10 mm.
 * Ritorna l'alert nel primo giorno in cui le tre condizioni coesistono.
 */
export function regolaTreDieci(
  serie: GiornoPeronospora[],
): AlertFitopatologico | null {
  for (let i = 0; i < serie.length; i++) {
    const g = serie[i];
    if (g.tMedia >= 10 && g.pioggia >= 10 && g.lunghezzaGermogli >= 10) {
      return {
        modello: "Peronospora (tre-dieci)",
        rischio: "alto",
        indice: 5,
        messaggio:
          "Condizioni per l'infezione primaria: germogli ≥10 cm, T media ≥10 °C, pioggia ≥10 mm. Valutare trattamento preventivo.",
        giorno: i,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Oidio — finestra termica favorevole
// ---------------------------------------------------------------------------

export interface GiornoOidio {
  tMin: number;
  tMax: number;
  /** Umidità relativa media (%). */
  rhMedia: number;
}

// ---------------------------------------------------------------------------
// Normalizzazione del rischio (0.0 nullo → 1.0 critico)
// ---------------------------------------------------------------------------

/**
 * Porta l'indice 1..5 della gauge DSS sulla scala normalizzata richiesta dalla
 * mappa colorata e dallo stato del modulo: 0.0 (nullo) → 1.0 (critico). Un
 * alert assente vale 0; l'indice 5 (es. infezione primaria conclamata) vale 1.
 */
export function normalizzaIndiceRischio(indice: number): number {
  return Math.max(0, Math.min(1, indice / 5));
}

/** Valore normalizzato 0..1 di un livello qualitativo (per le sintesi senza indice). */
export function rischioLivelloA01(rischio: LivelloRischio): number {
  switch (rischio) {
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
export function alertA01(alert: AlertFitopatologico | null): number {
  if (!alert) return 0;
  return normalizzaIndiceRischio(alert.indice);
}

/**
 * Rischio di oidio (Erysiphe necator): favorito da temperature 20-27 °C e
 * umidità moderata, sfavorito da T>32 °C o piogge battenti. Modello a soglie
 * giornaliero, con escalation se i giorni favorevoli sono consecutivi.
 */
export function rischioOidio(serie: GiornoOidio[]): AlertFitopatologico | null {
  let consecutivi = 0;
  let peggior: AlertFitopatologico | null = null;
  for (let i = 0; i < serie.length; i++) {
    const g = serie[i];
    const tMedia = (g.tMin + g.tMax) / 2;
    const favorevole =
      tMedia >= 20 && tMedia <= 27 && g.tMax < 32 && g.rhMedia >= 40;
    consecutivi = favorevole ? consecutivi + 1 : 0;

    if (consecutivi >= 1) {
      const rischio: LivelloRischio =
        consecutivi >= 3 ? "alto" : consecutivi >= 2 ? "medio" : "basso";
      const indice = consecutivi >= 3 ? 4 : consecutivi >= 2 ? 3 : 2;
      const alert: AlertFitopatologico = {
        modello: "Oidio (finestra termica)",
        rischio,
        indice,
        messaggio: `Condizioni favorevoli all'oidio da ${consecutivi} giorno/i (T media ${tMedia.toFixed(1)} °C). Monitorare e valutare difesa.`,
        giorno: i,
      };
      if (!peggior || alert.indice > peggior.indice) peggior = alert;
    }
  }
  return peggior;
}

// ---------------------------------------------------------------------------
// Occhio di pavone dell'olivo — Spilocaea oleagina (Fusicladium oleagineum)
// ---------------------------------------------------------------------------

export interface GiornoOcchioPavone {
  tMin: number;
  tMax: number;
  /** Ore di bagnatura fogliare del giorno (0..24). */
  bagnaturaOre: number;
}

/** Ore di bagnatura minime per un evento d'infezione favorevole. */
const BAGNATURA_SOGLIA_ORE = 10;
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
 * (pattern di {@link rischioOidio}). Ritorna l'alert peggiore della finestra.
 */
export function rischioOcchioPavone(
  serie: GiornoOcchioPavone[],
): AlertFitopatologico | null {
  let consecutivi = 0;
  let peggior: AlertFitopatologico | null = null;
  for (let i = 0; i < serie.length; i++) {
    const g = serie[i];
    const tMedia = (g.tMin + g.tMax) / 2;
    const bagnaturaOk = g.bagnaturaOre >= BAGNATURA_SOGLIA_ORE;
    const termicaOk = tMedia >= OCCHIO_T_MIN && tMedia <= OCCHIO_T_MAX;
    const favorevole = bagnaturaOk && termicaOk;
    consecutivi = favorevole ? consecutivi + 1 : 0;

    if (favorevole) {
      // Bagnatura lunga in piena banda ottimale: evento severo anche singolo.
      const ottimale =
        g.bagnaturaOre >= 18 && tMedia <= OCCHIO_T_OTTIMALE_MAX;
      const indice = consecutivi >= 3 || ottimale ? 5 : consecutivi >= 2 ? 4 : 3;
      const rischio: LivelloRischio =
        indice >= 5 ? "alto" : indice >= 4 ? "medio" : "basso";
      const alert: AlertFitopatologico = {
        modello: "Occhio di pavone (bagnatura-temperatura)",
        rischio,
        indice,
        messaggio: `Bagnatura fogliare ${g.bagnaturaOre.toFixed(0)} h con T media ${tMedia.toFixed(1)} °C${consecutivi > 1 ? ` da ${consecutivi} giorni` : ""}: condizioni d'infezione per Spilocaea oleagina. Valutare difesa rameica.`,
        giorno: i,
      };
      if (!peggior || alert.indice > peggior.indice) peggior = alert;
    }
  }
  return peggior;
}
