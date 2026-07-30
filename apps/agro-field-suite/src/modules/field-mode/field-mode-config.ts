/**
 * Parametri EDITABILI del geofencing GPS e della Modalità Campo.
 * Sono preferenze d'utente per-device: persistite in localStorage (istantaneo,
 * offline-safe), come `analytics/kpi-config.ts`. Non vivono in PGlite (non
 * sono dati di tenant) né hanno bisogno del control plane.
 */

export interface FieldModeConfig {
  /** Secondi di permanenza continuativa per confermare l'ingresso in un plot. */
  dwellSeconds: number;
  /** Secondi fuori perimetro per confermare l'uscita (isteresi anti-jitter). */
  exitGraceSeconds: number;
  /** Accuratezza GPS massima accettata in metri: i campioni peggiori sono scartati. */
  maxAccuracyM: number;
  /**
   * Larghezza di lavoro di default (m) proposta all'avvio di una sessione
   * senza attrezzo agganciato: base della stima della superficie lavorata finché l'operatore non sceglie un attrezzo reale (con la sua
   * `working_width_m` anagrafica).
   */
  defaultWorkingWidthM: number;
}

export const DEFAULT_FIELD_MODE_CONFIG: FieldModeConfig = {
  dwellSeconds: 15,
  exitGraceSeconds: 30,
  maxAccuracyM: 100,
  defaultWorkingWidthM: 3,
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Normalizza una config (parziale/legacy) contro i default. */
export function mergeFieldModeConfig(
  partial: Partial<Record<string, unknown>> | null | undefined,
): FieldModeConfig {
  const out = { ...DEFAULT_FIELD_MODE_CONFIG };
  if (partial && typeof partial === "object") {
    for (const key of Object.keys(out) as (keyof FieldModeConfig)[]) {
      const v = (partial as Record<string, unknown>)[key];
      if (isFiniteNumber(v) && v > 0) out[key] = v;
    }
  }
  return out;
}

const STORAGE_KEY = "agrogea.fieldMode.config";

export function loadFieldModeConfig(): FieldModeConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return mergeFieldModeConfig(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    /* localStorage non available o JSON corrotto: si ricade sui default */
  }
  return { ...DEFAULT_FIELD_MODE_CONFIG };
}

export function persistFieldModeConfig(config: FieldModeConfig): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* no-op */
  }
}
