import {
  type DssResult,
  type Harvest,
  type OperationType,
  type PlannedTask,
  type SoilWaterIndex,
  type TreatmentLog,
  toIsoDay,
} from "@agrogea/core";

/**
 * Costruzione PURA degli eventi del Calendario aziendale: dati dentro, righe
 * di calendario fuori. Nessun hook, nessun accesso al DAL, nessun `t()` — le
 * etichette arrivano dal chiamante ({@link CalendarEventLabels}), così la
 * regola "cosa compare in quale giorno" resta testabile in isolamento e la
 * traduzione resta nel componente.
 *
 * Cinque sorgenti, una sola griglia temporale:
 *   * `planned_tasks` — ciò che DEVE ancora essere fatto (l'unica sorgente
 *     futura pianificabile a mano dal calendario);
 *   * `treatment_logs` — il registro di ciò che è stato fatto;
 *   * `harvest_logs` — le raccolte;
 *   * `dss_results` — i giorni a rischio alto dei modelli fitopatologici;
 *   * `soil_water_indices` — i giorni di stress idrico del bilancio FAO 56/66.
 *
 * Gli ultimi due compaiono NON APPENA il rispettivo calcolo viene eseguito
 * altrove (mappa/Command Center): il calendario li legge dalla cache locale,
 * non li ricalcola.
 */

export type CalendarEventKind =
  | "task"
  | "operation"
  | "harvest"
  | "dss"
  | "water";

export interface CalendarEvent {
  /** Chiave React stabile (`<prefisso>-<id>`). */
  key: string;
  kind: CalendarEventKind;
  /** Id del record sorgente: apre l'editor giusto nel dettaglio del giorno. */
  refId: string;
  /** Giorno "YYYY-MM-DD" (componenti LOCALI: il giorno è quello dell'operatore). */
  day: string;
  label: string;
  color: string;
  /** true per ciò che deve ancora accadere: reso in tratteggio nella griglia. */
  future: boolean;
}

/** Colore per tipo di operation (condiviso griglia/legenda/dettaglio). */
export const OPERATION_COLOR: Record<OperationType, string> = {
  phytosanitary: "var(--accent)",
  fertilization: "var(--ok)",
  irrigation: "#0ea5e9",
  tillage: "var(--ink-3)",
  sowing: "#a855f7",
  harvest: "var(--warn)",
  sampling: "var(--ink-3)",
};

export const TASK_COLOR = "#6366f1";
export const HARVEST_COLOR = "#d97706";
export const DSS_COLOR = "var(--danger)";
export const WATER_COLOR = "#0284c7";

/** Etichette localizzate, iniettate dal componente (il modulo resta puro). */
export interface CalendarEventLabels {
  task: (task: PlannedTask) => string;
  operation: (log: TreatmentLog) => string;
  harvest: (harvest: Harvest) => string;
  dss: (result: DssResult) => string;
  water: (index: SoilWaterIndex) => string;
}

export interface CalendarEventsInput {
  plannedTasks: PlannedTask[];
  treatments: TreatmentLog[];
  harvests: Harvest[];
  dssResults: DssResult[];
  soilIndices: SoilWaterIndex[];
  /** `plots_campaign.id` → `plot_id`, per portare gli indici idrici nello scope. */
  plotIdByCampaign: Record<string, string>;
  /** Appezzamenti nello scope; null = tutta l'azienda. */
  plotIds: Set<string> | null;
  /** Giorno corrente "YYYY-MM-DD": separa il pianificato dal registrato. */
  today: string;
  labels: CalendarEventLabels;
}

/** Giorno locale di un timestamp, o null se non utilizzabile. */
function dayOf(value: string | Date | null | undefined): string | null {
  return toIsoDay(value);
}

export function buildCalendarEvents(input: CalendarEventsInput): CalendarEvent[] {
  const { plotIds, today, labels } = input;
  const inScope = (plotId: string | null | undefined): boolean =>
    plotIds == null || (plotId != null && plotIds.has(plotId));

  const events: CalendarEvent[] = [];

  // Task programmate: le sole voci FUTURE pianificabili. Quelle chiuse o
  // annullate non sono più impegni e sparirebbero comunque dal cruscotto.
  for (const task of input.plannedTasks) {
    if (task.deleted_at != null || !inScope(task.plot_id)) continue;
    if (task.status === "COMPLETED" || task.status === "CANCELLED") continue;
    const day = dayOf(task.planned_date);
    if (!day) continue; // senza data non ha una casella: resta nel Planner
    events.push({
      key: `task-${task.id}`,
      kind: "task",
      refId: task.id,
      day,
      label: labels.task(task),
      color: TASK_COLOR,
      future: day >= today,
    });
  }

  for (const log of input.treatments) {
    if (log.deleted_at != null || !inScope(log.plot_id)) continue;
    const day = dayOf(log.executed_at);
    if (!day) continue;
    events.push({
      key: `op-${log.id}`,
      kind: "operation",
      refId: log.id,
      day,
      label: labels.operation(log),
      color: OPERATION_COLOR[log.operation_type],
      future: day > today,
    });
  }

  for (const harvest of input.harvests) {
    if (harvest.deleted_at != null || !inScope(harvest.plot_id)) continue;
    const day = dayOf(harvest.harvested_at);
    if (!day) continue;
    events.push({
      key: `harvest-${harvest.id}`,
      kind: "harvest",
      refId: harvest.id,
      day,
      label: labels.harvest(harvest),
      color: HARVEST_COLOR,
      future: day > today,
    });
  }

  // DSS: solo il rischio ALTO merita una casella — il medio/basso riempirebbe
  // il mese di rumore e toglierebbe forza all'unico giorno che conta.
  for (const result of input.dssResults) {
    if (result.risk_level !== "high" || !inScope(result.plot_id)) continue;
    const day = dayOf(result.calculated_at);
    if (!day) continue;
    events.push({
      key: `dss-${result.id}`,
      kind: "dss",
      refId: result.id,
      day,
      label: labels.dss(result),
      color: DSS_COLOR,
      future: false,
    });
  }

  // Bilancio idrico: idem, solo i giorni in stress (Dr ≥ RAW) — è il giorno in
  // cui bisogna irrigare, non la serie completa.
  for (const index of input.soilIndices) {
    if (!index.water_stress) continue;
    const plotId = index.plot_campaign_id
      ? (input.plotIdByCampaign[index.plot_campaign_id] ?? null)
      : null;
    if (!inScope(plotId)) continue;
    const day = dayOf(index.date);
    if (!day) continue;
    events.push({
      key: `water-${index.id}`,
      kind: "water",
      refId: index.id,
      day,
      label: labels.water(index),
      color: WATER_COLOR,
      future: day > today,
    });
  }

  return events;
}

/** Eventi raggruppati per giorno, nell'ordine di {@link buildCalendarEvents}. */
export function groupEventsByDay(
  events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = map.get(event.day);
    if (list) list.push(event);
    else map.set(event.day, [event]);
  }
  return map;
}

/**
 * Griglia del mese: 7 colonne (lun→dom), celle `null` per il riempimento
 * iniziale/finale. I giorni sono chiavi "YYYY-MM-DD" costruite dai componenti
 * locali, coerenti con {@link buildCalendarEvents}.
 */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lun = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  const monthLabel = String(month + 1).padStart(2, "0");
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${monthLabel}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Giorno corrente in forma "YYYY-MM-DD" (componenti locali). */
export function todayKey(now: Date = new Date()): string {
  return toIsoDay(now) ?? "";
}
