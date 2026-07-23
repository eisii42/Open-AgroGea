/**
 * Motore PURO del Parco macchine (0.3.0): consumo carburante l/h col metodo
 * pieno-a-pieno, rilevazione anomalie, valutazione dello scadenziario di
 * manutenzione (tempo/ore) e riprogrammazione dei piani ricorrenti. Nessun
 * accesso al DB né dipendenza da framework: le funzioni sono deterministiche e
 * testate in isolamento, consumate dal DAL/UI come gli altri engine di
 * `@agrogea/tools`. I tipi d'ingresso sono locali (strutturalmente compatibili
 * coi tipi di dominio di `@agrogea/core`) per non accoppiare i pacchetti.
 */

// ---------------------------------------------------------------------------
// Consumo carburante (l/h) — metodo pieno-a-pieno (§5.6)
// ---------------------------------------------------------------------------

/** Rifornimento minimo necessario al calcolo del consumo. */
export interface RefillPoint {
  /** Data ISO ("YYYY-MM-DD") o timestamp: ordina i rifornimenti. */
  refueled_at: string;
  liters: number;
  /** Lettura contaore al rifornimento; null se non registrata. */
  counter_hours: number | null;
  /** true = pieno completo (chiude un intervallo pieno-a-pieno). */
  full_tank: boolean;
}

export interface FuelConsumptionResult {
  /** Consumo medio l/h su tutti gli intervalli pieno-a-pieno validi. */
  avgLitersPerHour: number | null;
  /** Consumo dell'ultimo intervallo pieno-a-pieno. */
  lastLitersPerHour: number | null;
  /** Numero di intervalli pieno-a-pieno usati nel calcolo. */
  sampleCount: number;
  /** true se l'ultimo intervallo devia oltre soglia dalla media dei precedenti. */
  anomaly: boolean;
}

export interface FuelConsumptionOptions {
  /**
   * Soglia relativa di anomalia (default 0.30 = 30%): l'ultimo intervallo è
   * segnalato se |last − mediaPrecedenti| / mediaPrecedenti supera la soglia.
   */
  anomalyThreshold?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Consumo l/h col metodo PIENO-A-PIENO: tra due rifornimenti a serbatoio pieno
 * con lettura contaore, i litri erogati nell'intervallo (inclusi eventuali
 * rifornimenti PARZIALI intermedi, esclusa la sola lettura d'ancora) sono il
 * carburante consumato nelle ore trascorse. Casi limite gestiti:
 *   * contaore mancante → il rifornimento accumula litri ma non chiude/apre un
 *     intervallo (serve la lettura per il Δore);
 *   * primo rifornimento → nessun intervallo (manca l'ancora precedente);
 *   * rifornimenti parziali → i litri confluiscono nell'intervallo pieno
 *     successivo (media corretta sull'intero serbatoio consumato).
 * Anomalia: confronto dell'ultimo intervallo con la media di quelli precedenti.
 */
export function fuelConsumption(
  refills: RefillPoint[],
  options: FuelConsumptionOptions = {},
): FuelConsumptionResult {
  const threshold = options.anomalyThreshold ?? 0.3;
  // Ordina per data, poi per contaore (tie-break stabile dello stesso giorno).
  const sorted = [...refills].sort((a, b) => {
    const da = Date.parse(a.refueled_at);
    const db = Date.parse(b.refueled_at);
    if (da !== db) return da - db;
    return (a.counter_hours ?? 0) - (b.counter_hours ?? 0);
  });

  const intervals: number[] = [];
  let anchor: RefillPoint | null = null;
  let litersSinceAnchor = 0;

  for (const r of sorted) {
    if (anchor) litersSinceAnchor += r.liters;
    const closesInterval = r.full_tank && r.counter_hours != null;
    if (closesInterval) {
      if (anchor && anchor.counter_hours != null) {
        const deltaHours = r.counter_hours! - anchor.counter_hours;
        if (deltaHours > 0 && litersSinceAnchor > 0) {
          intervals.push(litersSinceAnchor / deltaHours);
        }
      }
      anchor = r;
      litersSinceAnchor = 0;
    }
  }

  if (intervals.length === 0) {
    return {
      avgLitersPerHour: null,
      lastLitersPerHour: null,
      sampleCount: 0,
      anomaly: false,
    };
  }

  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const last = intervals[intervals.length - 1];
  let anomaly = false;
  if (intervals.length >= 2) {
    const prior = intervals.slice(0, -1);
    const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length;
    if (priorAvg > 0) {
      anomaly = Math.abs(last - priorAvg) / priorAvg > threshold;
    }
  }

  return {
    avgLitersPerHour: round2(avg),
    lastLitersPerHour: round2(last),
    sampleCount: intervals.length,
    anomaly,
  };
}

// ---------------------------------------------------------------------------
// Scadenziario manutenzione (tempo/ore) — §5.3
// ---------------------------------------------------------------------------

/** Urgenza di un piano di manutenzione rispetto a oggi/al contaore. */
export type MaintenanceUrgency = "ok" | "due" | "overdue";

/** Piano di manutenzione minimo per la valutazione. */
export interface MaintenanceScheduleInput {
  trigger_type: "time" | "hours";
  due_date: string | null;
  due_hours: number | null;
  active?: boolean;
}

export interface MaintenanceEvaluation {
  urgency: MaintenanceUrgency;
  /** Residuo alla scadenza: giorni (trigger time) o ore (trigger hours). */
  remaining: number | null;
  unit: "days" | "hours";
}

export interface MaintenanceThresholds {
  /** Anticipo d'allerta a tempo (giorni), default 30. */
  warningDays?: number;
  /** Anticipo d'allerta a ore, default 20. */
  warningHours?: number;
}

const MS_PER_DAY = 86_400_000;

/** Giorni interi (arrotondati per difetto) tra oggi e una data ISO. */
function daysUntil(dateIso: string, today: Date): number {
  const due = Date.parse(`${dateIso.slice(0, 10)}T23:59:59.999`);
  if (Number.isNaN(due)) return Number.POSITIVE_INFINITY;
  return Math.floor((due - today.getTime()) / MS_PER_DAY);
}

/**
 * Valuta un piano di manutenzione: `overdue` se la soglia (data o contaore) è
 * superata, `due` se rientra nell'anticipo d'allerta, `ok` altrimenti. Per il
 * trigger a ore serve il contatore corrente del mezzo.
 */
export function evaluateMaintenance(
  schedule: MaintenanceScheduleInput,
  currentHours: number,
  today: Date = new Date(),
  thresholds: MaintenanceThresholds = {},
): MaintenanceEvaluation {
  const warningDays = thresholds.warningDays ?? 30;
  const warningHours = thresholds.warningHours ?? 20;

  if (schedule.trigger_type === "time") {
    if (schedule.due_date == null) {
      return { urgency: "ok", remaining: null, unit: "days" };
    }
    const remaining = daysUntil(schedule.due_date, today);
    const urgency: MaintenanceUrgency =
      remaining < 0 ? "overdue" : remaining <= warningDays ? "due" : "ok";
    return { urgency, remaining, unit: "days" };
  }

  // trigger_type === "hours"
  if (schedule.due_hours == null) {
    return { urgency: "ok", remaining: null, unit: "hours" };
  }
  const remaining = round2(schedule.due_hours - currentHours);
  const urgency: MaintenanceUrgency =
    remaining <= 0 ? "overdue" : remaining <= warningHours ? "due" : "ok";
  return { urgency, remaining, unit: "hours" };
}

/**
 * Prossima scadenza di un piano ricorrente dopo un intervento: data
 * dell'intervento + `interval_days` (trigger time), oppure contaore
 * dell'intervento + `interval_hours` (trigger hours). Ritorna i soli campi
 * pertinenti al trigger; null se l'intervallo non è definito.
 */
export function rescheduleMaintenance(
  schedule: {
    trigger_type: "time" | "hours";
    interval_days: number | null;
    interval_hours: number | null;
  },
  performedAt: string,
  counterHours: number | null,
): { due_date?: string; due_hours?: number } {
  if (schedule.trigger_type === "time") {
    if (schedule.interval_days == null) return {};
    const parts = performedAt.slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return {};
    // Aritmetica in UTC (Date.UTC + toISOString): evita lo slittamento di un
    // giorno che si avrebbe con la mezzanotte LOCALE riformattata in ISO/UTC.
    const base = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    base.setUTCDate(base.getUTCDate() + Number(schedule.interval_days));
    return { due_date: base.toISOString().slice(0, 10) };
  }
  if (schedule.interval_hours == null || counterHours == null) return {};
  return { due_hours: round2(Number(counterHours) + Number(schedule.interval_hours)) };
}
