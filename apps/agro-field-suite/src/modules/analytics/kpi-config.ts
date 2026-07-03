/**
 * Parametri EDITABILI dei KPI del Command Center (Modulo 3 — personalizzazione).
 * Sono preferenze d'utente per-device: persistite in localStorage (istantaneo,
 * offline-safe), come tema/lingua. Non vivono in PGlite (non sono dati di
 * tenant) né hanno bisogno del control plane.
 */

export interface KpiParams {
  /** Temperatura base per l'accumulo dei gradi-giorno (°C). */
  gddBase: number;
  /** Mese biofix d'inizio accumulo GDD (1=gennaio … 12=dicembre). */
  gddStartMonth: number;
  /** Soglia 0..1 di allerta per lo stress idrico medio (deplezione/AWC). */
  waterStressThreshold: number;
  /** Finestra (giorni) per il trend dell'evapotraspirazione ETc. */
  etcWindowDays: number;
}

export const DEFAULT_KPI_PARAMS: KpiParams = {
  gddBase: 10,
  gddStartMonth: 1,
  waterStressThreshold: 0.5,
  etcWindowDays: 7,
};

/** Metadati di un parametro per il modale di modifica del widget. */
export interface KpiParamMeta {
  id: keyof KpiParams;
  label: string;
  /** Suffisso/unità mostrata accanto all'input. */
  unit?: string;
  min: number;
  max: number;
  step: number;
}

export const KPI_PARAM_META: Record<keyof KpiParams, KpiParamMeta> = {
  gddBase: { id: "gddBase", label: "Temperatura base GDD", unit: "°C", min: 0, max: 20, step: 0.5 },
  gddStartMonth: { id: "gddStartMonth", label: "Mese inizio accumulo", min: 1, max: 12, step: 1 },
  waterStressThreshold: {
    id: "waterStressThreshold",
    label: "Soglia allerta stress idrico",
    unit: "frazione 0–1",
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  etcWindowDays: { id: "etcWindowDays", label: "Finestra trend ETc", unit: "giorni", min: 3, max: 30, step: 1 },
};

const STORAGE_KEY = "agrogea.commandCenter.kpiParams";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Normalizza una config (parziale/legacy) contro i default. */
export function mergeKpiParams(
  partial: Partial<Record<string, unknown>> | null | undefined,
): KpiParams {
  const out = { ...DEFAULT_KPI_PARAMS };
  if (partial && typeof partial === "object") {
    for (const key of Object.keys(out) as (keyof KpiParams)[]) {
      const v = (partial as Record<string, unknown>)[key];
      if (isFiniteNumber(v)) out[key] = v;
    }
  }
  return out;
}

export function loadKpiParams(): KpiParams {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return mergeKpiParams(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    /* localStorage non disponibile o JSON corrotto: si ricade sui default */
  }
  return { ...DEFAULT_KPI_PARAMS };
}

export function persistKpiParams(params: KpiParams): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    /* no-op */
  }
}
