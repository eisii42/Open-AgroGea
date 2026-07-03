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

export interface DatiMeteoGiorno {
  /** Temperatura minima/massima del giorno (°C). */
  tMin: number;
  tMax: number;
  /** Umidità relativa minima/massima del giorno (%). */
  rhMin: number;
  rhMax: number;
  /** Velocità del vento a 2 m (m/s). */
  vento2m: number;
  /** Radiazione solare incidente (MJ m⁻² giorno⁻¹). */
  radiazione: number;
  /** Quota della stazione (m s.l.m.). */
  altitudine: number;
}

const G_SOIL_FLUX = 0; // flusso di calore nel suolo, ~0 su base giornaliera
const GAMMA_CONST = 0.665e-3; // costante psicrometrica × P
const ALBEDO = 0.23; // coltura di riferimento (erba)
const STEFAN_BOLTZMANN = 4.903e-9; // MJ K⁻⁴ m⁻² giorno⁻¹

/** Pressione di vapore a saturazione e_s(T) [kPa] (Tetens). */
function pressioneSaturazione(t: number): number {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/** Pendenza della curva di pressione di vapore Δ [kPa °C⁻¹]. */
function pendenzaVapore(t: number): number {
  const es = pressioneSaturazione(t);
  return (4098 * es) / Math.pow(t + 237.3, 2);
}

/**
 * ET0 giornaliera (mm/giorno) con Penman-Monteith FAO-56.
 * `radiazioneNetta` è opzionale: se assente è stimata da radiazione/umidità.
 */
export function et0PenmanMonteith(
  m: DatiMeteoGiorno,
  options: { radiazioneNettaLunga?: number } = {},
): number {
  const tMean = (m.tMax + m.tMin) / 2;
  const delta = pendenzaVapore(tMean);

  // Pressione atmosferica e costante psicrometrica γ dall'altitudine.
  const P = 101.3 * Math.pow((293 - 0.0065 * m.altitudine) / 293, 5.26);
  const gamma = GAMMA_CONST * P;

  // Pressioni di vapore: saturazione media e effettiva da RH min/max.
  const esTmax = pressioneSaturazione(m.tMax);
  const esTmin = pressioneSaturazione(m.tMin);
  const es = (esTmax + esTmin) / 2;
  const ea =
    (esTmin * (m.rhMax / 100) + esTmax * (m.rhMin / 100)) / 2;

  // Radiazione netta: onda corta (1−albedo)·Rs meno onda lunga uscente.
  const rns = (1 - ALBEDO) * m.radiazione;
  const tMaxK = m.tMax + 273.16;
  const tMinK = m.tMin + 273.16;
  const rnl =
    options.radiazioneNettaLunga ??
    STEFAN_BOLTZMANN *
      ((Math.pow(tMaxK, 4) + Math.pow(tMinK, 4)) / 2) *
      (0.34 - 0.14 * Math.sqrt(ea)) *
      0.9; // fattore nuvolosità semplificato (cielo per lo più sereno)
  const rn = rns - rnl;

  const numeratore =
    0.408 * delta * (rn - G_SOIL_FLUX) +
    gamma * (900 / (tMean + 273)) * m.vento2m * (es - ea);
  const denominatore = delta + gamma * (1 + 0.34 * m.vento2m);
  return Math.max(0, numeratore / denominatore);
}

/** ETc = ET0 · Kc (Kc colturale per fase, da `fenologia.ts`). */
export function etColturale(et0: number, kc: number): number {
  return et0 * kc;
}

// ---------------------------------------------------------------------------
// Bilancio idrico del suolo
// ---------------------------------------------------------------------------

export interface ParametriSuolo {
  /** Capacità di campo (frazione volumetrica, es. 0.30). */
  capacitaCampo: number;
  /** Punto di appassimento (frazione volumetrica, es. 0.12). */
  puntoAppassimento: number;
  /** Profondità delle radici (m). */
  profonditaRadici: number;
  /**
   * Frazione di acqua disponibile estraibile senza stress (p, 0..1):
   * sotto questa soglia la coltura entra in stress idrico. FAO-56 ~0.5.
   */
  frazioneDeplezione: number;
}

export interface StatoIdrico {
  /** Acqua disponibile totale tra CC e PA (mm). */
  awc: number;
  /** Acqua facilmente disponibile prima dello stress (mm). */
  raw: number;
  /** Deplezione corrente dalla capacità di campo (mm). */
  deplezione: number;
  /** Acqua residua prima della soglia di stress (mm). */
  marginePrimaStress: number;
  /** true se la coltura è già in stress idrico. */
  inStress: boolean;
}

/**
 * Acqua disponibile e soglie del suolo. AWC = (CC − PA)·profondità (mm),
 * RAW = p·AWC: sotto RAW di deplezione, la coltura va in stress.
 */
export function statoIdricoSuolo(
  suolo: ParametriSuolo,
  deplezioneCorrente: number,
): StatoIdrico {
  const awc =
    (suolo.capacitaCampo - suolo.puntoAppassimento) *
    suolo.profonditaRadici *
    1000;
  const raw = suolo.frazioneDeplezione * awc;
  const deplezione = Math.max(0, Math.min(deplezioneCorrente, awc));
  return {
    awc,
    raw,
    deplezione,
    marginePrimaStress: raw - deplezione,
    inStress: deplezione >= raw,
  };
}

export interface PianoIrriguoGiorno {
  giorno: number;
  etc: number;
  pioggia: number;
  irrigazione: number;
  deplezione: number;
  inStress: boolean;
}

// ---------------------------------------------------------------------------
// Bilancio idrico dinamico — equazione di deplezione FAO-56 §8 / FAO-66
// ---------------------------------------------------------------------------

export interface BilancioIdricoGiorno {
  giorno: number;
  /** Evapotraspirazione colturale ETc del giorno (mm). */
  etc: number;
  /** Pioggia efficace P del giorno (mm). */
  pioggia: number;
  /** Apporto irriguo I del giorno (mm). */
  irrigazione: number;
  /**
   * Percolazione profonda DP del giorno (mm): acqua che drena sotto la zona
   * radicale quando l'apporto (P+I) eccede la capacità di campo. È un TERMINE
   * ESPLICITO del bilancio (FAO-56 eq.88), non più implicito nel clamp.
   */
  percolazione: number;
  /** Deplezione radicale Dr,t a fine giornata (mm), entro [0, AWC]. */
  deplezione: number;
  /** Acqua facilmente disponibile RAW (mm), costante della parcella. */
  raw: number;
  /** Acqua disponibile totale AWC (mm), costante della parcella. */
  awc: number;
  /** true se Dr,t ≥ RAW (stress idrico in atto). */
  inStress: boolean;
}

/**
 * Bilancio idrico del suolo per ZONA RADICALE con l'equazione di deplezione
 * FAO-56 (eq.85), forma esplicita richiesta dalla DSS irrigua AgroGea:
 *
 *   Dr,t = Dr,t-1 − P_t − I_t + ETc,t + DP_t        (poi limitata a [0, AWC])
 *
 * dove la percolazione profonda DP,t = max(0, −(Dr,t-1 − P_t − I_t + ETc,t)) è
 * l'eccesso d'acqua oltre la capacità di campo (Dr = 0). Si differenzia da
 * {@link pianoIrriguo} (che è un piano irriguo predittivo con irrigazione
 * automatica): qui l'irrigazione è un INPUT misurato dai log gestionali e DP è
 * tracciato giorno per giorno per la persistenza (`soil_water_indices`).
 *
 * Risalita capillare (CR) e ruscellamento (RO) sono trascurati (≈0): default
 * conservativo, coerente con i dati disponibili da stazione.
 */
export function bilancioIdricoFao66(
  suolo: ParametriSuolo,
  etcSerie: number[],
  pioggiaSerie: number[],
  irrigazioneSerie: number[] = [],
  deplezioneIniziale = 0,
): { serie: BilancioIdricoGiorno[]; giorniAutonomia: number } {
  const stato0 = statoIdricoSuolo(suolo, deplezioneIniziale);
  const serie: BilancioIdricoGiorno[] = [];

  let deplezione = stato0.deplezione;
  let giorniAutonomia = etcSerie.length;
  let autonomiaTrovata = false;

  for (let g = 0; g < etcSerie.length; g++) {
    const etc = Math.max(0, etcSerie[g] ?? 0);
    const pioggia = Math.max(0, pioggiaSerie[g] ?? 0);
    const irrigazione = Math.max(0, irrigazioneSerie[g] ?? 0);

    // Dr provvisorio prima dei limiti fisici del suolo.
    const drProvvisorio = deplezione - pioggia - irrigazione + etc;
    // DP: l'eccesso oltre la capacità di campo (Dr<0) percola in profondità e
    // riporta Dr a 0. Non c'è percolazione finché il profilo non è saturo.
    const percolazione = Math.max(0, -drProvvisorio);
    // Limite inferiore 0 (capacità di campo) e superiore AWC (punto di
    // appassimento: oltre non c'è più acqua estraibile).
    deplezione = Math.min(Math.max(drProvvisorio, 0), stato0.awc);

    const inStress = deplezione >= stato0.raw;
    if (!autonomiaTrovata && inStress) {
      giorniAutonomia = g;
      autonomiaTrovata = true;
    }

    serie.push({
      giorno: g,
      etc,
      pioggia,
      irrigazione,
      percolazione,
      deplezione,
      raw: stato0.raw,
      awc: stato0.awc,
      inStress,
    });
  }

  return { serie, giorniAutonomia };
}

/**
 * Coefficiente di stress idrico Ks (FAO-56 eq.84): 1 quando l'acqua è
 * facilmente disponibile (Dr ≤ RAW), poi decresce linearmente fino a 0 al punto
 * di appassimento (Dr = AWC). Sotto RAW la traspirazione (e quindi la resa) è
 * ridotta proporzionalmente.
 */
export function coefficienteStressIdrico(
  deplezione: number,
  raw: number,
  awc: number,
): number {
  if (deplezione <= raw) return 1;
  const denom = awc - raw;
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, (awc - deplezione) / denom));
}

/**
 * Riduzione potenziale di resa per stress idrico (FAO-33/66):
 *
 *   1 − Ya/Ym = Ky · (1 − ETa/ETc) = Ky · (1 − Ks)
 *
 * con Ks da {@link coefficienteStressIdrico} e Ky fattore di risposta della
 * coltura (default editabile). Ritorna la frazione di resa persa in [0, 1].
 */
export function riduzioneResaFao66(
  deplezione: number,
  raw: number,
  awc: number,
  ky: number,
): number {
  const ks = coefficienteStressIdrico(deplezione, raw, awc);
  return Math.max(0, Math.min(1, ky * (1 - ks)));
}

/**
 * Piano idrico predittivo (DSS irriguo): proietta il bilancio giorno per
 * giorno e suggerisce volume e momento dell'intervento. Quando la deplezione
 * raggiunge RAW, prescrive un'irrigazione che riporta a capacità di campo.
 *
 * `etcSerie` e `pioggiaSerie` (mm/giorno) hanno la stessa lunghezza =
 * orizzonte di previsione. Ritorna la serie giornaliera e i giorni di
 * autonomia residua dall'oggi (prima del primo stress senza irrigare).
 */
export function pianoIrriguo(
  suolo: ParametriSuolo,
  etcSerie: number[],
  pioggiaSerie: number[],
  deplezioneIniziale = 0,
  options: { irrigaAutomatico?: boolean } = {},
): { serie: PianoIrriguoGiorno[]; giorniAutonomia: number } {
  const stato0 = statoIdricoSuolo(suolo, deplezioneIniziale);
  const irrigaAuto = options.irrigaAutomatico ?? true;
  const serie: PianoIrriguoGiorno[] = [];

  let deplezione = stato0.deplezione;
  let giorniAutonomia = etcSerie.length;
  let autonomiaTrovata = false;

  for (let g = 0; g < etcSerie.length; g++) {
    const etc = etcSerie[g];
    const pioggia = pioggiaSerie[g] ?? 0;
    // Aggiunge ETc (asciuga), sottrae pioggia (ricarica), entro [0, AWC].
    deplezione = Math.max(0, Math.min(deplezione + etc - pioggia, stato0.awc));

    if (!autonomiaTrovata && deplezione >= stato0.raw) {
      giorniAutonomia = g;
      autonomiaTrovata = true;
    }

    let irrigazione = 0;
    if (irrigaAuto && deplezione >= stato0.raw) {
      irrigazione = deplezione; // ripristina la capacità di campo
      deplezione = 0;
    }

    serie.push({
      giorno: g,
      etc,
      pioggia,
      irrigazione,
      deplezione,
      inStress: !irrigaAuto && deplezione >= stato0.raw,
    });
  }

  return { serie, giorniAutonomia };
}
