/**
 * Parametri del motore analitico del Command Center (`CommandCenterEngine`):
 * base GDD, biofix, soglia di stress idrico, finestra del trend ETc. Alimentano
 * i KPI che finiscono nell'Executive Report.
 *
 * Sono preferenze d'utente per-device: persistite in localStorage (istantaneo,
 * offline-safe), come tema/lingua. Non vivono in PGlite (non sono dati di
 * tenant) né hanno bisogno del control plane. Dalla rimozione della griglia a
 * indici fissi non hanno più un modale di modifica: la personalizzazione degli
 * indici passa dalle schede KPI custom (`kpi-cards.ts`), che si compongono sul
 * catalogo dati completo.
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
    /* localStorage non available o JSON corrotto: si ricade sui default */
  }
  return { ...DEFAULT_KPI_PARAMS };
}

