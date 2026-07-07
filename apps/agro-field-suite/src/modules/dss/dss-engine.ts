import {
  alertA01,
  type CropType,
  yieldReductionFao66,
} from "@agrogea/tools";
import {
  type CropModule,
  type DssOutcome,
  runDssModule,
  type DssWeatherDay,
} from "../crops";
import type { DssContext } from "../crops";

/**
 * Motore DSS unificato (Modulo 2 — espansione): compone gli esiti
 * fitopatologici esistenti (`runDssModule`, che a sua volta compone i motori
 * puri di `@agrogea/tools`) con il VETTORE DI STRESS IDRICO derivato dal
 * bilancio idrico (Modulo 1), e normalizza ogni risk sulla scala richiesta
 * 0.0 (nullo) → 1.0 (critico). Non duplica logica: aggrega e normalizza.
 *
 * Puro (oggetti/array): testabile sotto `node --test`. Lo stato del pannello e
 * la persistenza vivono nel hook `useDssCalcolo`.
 */

export type CategoriaRischio = "fitopatologico" | "idrico";

/** Vettore di risk normalizzato per la gauge e la mappa colorata. */
export interface VettoreRischioDss {
  id: string;
  categoria: CategoriaRischio;
  label: string;
  target: string;
  /** Rischio normalizzato 0..1 (0 nullo, 1 critico). */
  rischio01: number;
  message: string;
}

/** Stato idrico sintetico in ingresso al motore (dal bilancio FAO 66). */
export interface StatoIdricoCampo {
  depletion: number;
  raw: number;
  awc: number;
}

/**
 * Fattori di risposta della resa Ky (FAO-33, stagionali) come default editabili
 * per coltura — non costanti regolatorie. Valori indicativi da letteratura.
 */
export const KY_DEFAULT: Record<CropType, number> = {
  vite: 0.85,
  olivo: 0.8,
  melo: 1.0,
  frumento: 1.0,
  mais: 1.25,
  pomodoro: 1.05,
};

/** Ky di default della coltura (fallback prudente 1.0). */
export function kyColtura(coltura: CropType): number {
  return KY_DEFAULT[coltura] ?? 1.0;
}

/**
 * Rischio idrico normalizzato 0..1 dalla depletion: cresce linearmente da 0
 * (suolo a capacità di campo) a 0.5 alla soglia RAW (inizio stress), e da 0.5 a
 * 1 fino al punto di appassimento (AWC). Lo 0.5 marca quindi l'ingresso in
 * stress idrico, coerentemente con la legenda della mappa DSS.
 */
export function rischioIdrico01(stato: StatoIdricoCampo): number {
  const { depletion, raw, awc } = stato;
  if (raw <= 0 || awc <= raw) {
    return depletion > 0 ? 1 : 0;
  }
  if (depletion <= raw) {
    return Math.max(0, Math.min(0.5, (depletion / raw) * 0.5));
  }
  return Math.max(0.5, Math.min(1, 0.5 + ((depletion - raw) / (awc - raw)) * 0.5));
}

/** true se il campo è in stress idrico (Dr ≥ RAW). */
export function inStressIdrico(stato: StatoIdricoCampo): boolean {
  return stato.depletion >= stato.raw;
}

/** Costruisce il vettore di stress idrico (riduzione resa via Ky, FAO 66). */
export function vettoreStressIdrico(
  stato: StatoIdricoCampo,
  coltura: CropType,
): VettoreRischioDss {
  const rischio01 = rischioIdrico01(stato);
  const ky = kyColtura(coltura);
  const perditaResa = yieldReductionFao66(stato.depletion, stato.raw, stato.awc, ky);
  const stress = inStressIdrico(stato);
  return {
    id: "stress-idrico",
    categoria: "idrico",
    label: "Stress idrico",
    target: "Deficit idrico radicale (FAO 66)",
    rischio01,
    message: stress
      ? `Stress idrico in atto (Dr ${stato.depletion.toFixed(0)}/${stato.raw.toFixed(0)} mm ≥ RAW). Riduzione potenziale di resa stimata ${(perditaResa * 100).toFixed(0)}% (Ky ${ky}).`
      : `Riserva idrica adeguata (Dr ${stato.depletion.toFixed(0)} mm < RAW ${stato.raw.toFixed(0)} mm).`,
  };
}

/** Proietta gli esiti patologici nei vettori di risk normalizzati. */
export function vettoriPatologici(esiti: DssOutcome[]): VettoreRischioDss[] {
  return esiti.map((e) => ({
    id: e.dss.id,
    categoria: "fitopatologico" as const,
    label: e.dss.name,
    target: e.dss.target,
    rischio01: alertA01(e.alert),
    message: e.alert?.message ?? "Nessuna condizione di risk nella finestra analizzata.",
  }));
}

export interface EsitoDssEngine {
  /** Esiti patologici grezzi (per la timeline/messaggi esistenti). */
  esiti: DssOutcome[];
  /** Vettori normalizzati 0..1: patologici + idrico (se disponibile). */
  vettori: VettoreRischioDss[];
  /** Rischio complessivo del campo = massimo dei vettori (0..1). */
  rischioComplessivo01: number;
}

/**
 * Esegue il motore DSS unificato: i modelli patologici del modulo coltura più,
 * se fornito lo stato idrico, il vettore di stress idrico. Il risk
 * complessivo è il massimo dei vettori (il fattore limitante guida la decisione).
 */
export function eseguiDssEngine(
  modulo: CropModule,
  series: DssWeatherDay[],
  context?: DssContext,
  statoIdrico?: StatoIdricoCampo,
): EsitoDssEngine {
  const esiti = runDssModule(modulo, series, context);
  const vettori = vettoriPatologici(esiti);
  if (statoIdrico) {
    vettori.push(vettoreStressIdrico(statoIdrico, modulo.mainSpecies));
  }
  const rischioComplessivo01 = vettori.reduce(
    (max, v) => Math.max(max, v.rischio01),
    0,
  );
  return { esiti, vettori, rischioComplessivo01 };
}
