import {
  type Equipment,
  type FuelRefill,
  type Machine,
  type MachineDocument,
  type MaintenanceSchedule,
  type AttentionKind,
  type LotExpiryStatus,
  expiryStatus,
} from "@agrogea/core";
import {
  type FuelConsumptionResult,
  evaluateMaintenance,
  fuelConsumption,
} from "@agrogea/tools";

/**
 * Logica DERIVATA condivisa del Parco macchine (0.3.0), lato app: converte i
 * dati di dominio idratati nello store negli output dei cruscotti (consumo l/h,
 * semaforo documenti, voci "Richiede attenzione") appoggiandosi agli engine
 * PURI di `@agrogea/tools` (già testati) e all'alert di scadenza di
 * `@agrogea/core`. Nessuno stato React qui: sono funzioni pure riusate dalla
 * sotto-scheda Mezzi, dal cruscotto e dall'accesso rapido refill.
 */

/** Anticipo d'allerta di default (giorni) per manutenzione a tempo e documenti. */
export const MACHINERY_WARNING_DAYS = 30;
/** Anticipo d'allerta di default (ore) per la manutenzione a ore. */
export const MACHINERY_WARNING_HOURS = 20;

/**
 * Normalizza una data "solo giorno" del Parco macchine (`due_date`/
 * `expires_at`) in "YYYY-MM-DD": PGlite può restituire per le columns `date`
 * un vero `Date` JS a mezzanotte LOCALE invece della stringa ISO del tipo di
 * dominio (stesso caso di {@link expiryStatus} in `@agrogea/core`, da cui
 * questo helper riprende il pattern — qui serve anche per `due_date`, che
 * `expiryStatus` non copre). `toISOString` slitterebbe di un giorno nei fusi
 * positivi: si riformatta con i componenti locali.
 */
export function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : value.slice(0, 10);
}

/** Mappa i rifornimenti di dominio nei punti attesi dall'engine di consumo. */
export function toRefillPoints(refills: FuelRefill[]) {
  return refills.map((r) => ({
    refueled_at: r.refueled_at,
    liters: Number(r.liters),
    counter_hours: r.counter_hours != null ? Number(r.counter_hours) : null,
    full_tank: r.full_tank,
  }));
}

/** Consumo l/h di un singolo mezzo dai suoi rifornimenti (§5.6). */
export function machineConsumption(
  refills: FuelRefill[],
): FuelConsumptionResult {
  return fuelConsumption(toRefillPoints(refills));
}

/** Consumo l/h per ogni mezzo, indicizzato per id (rifornimenti dell'azienda). */
export function consumptionByMachine(
  fuelRefills: FuelRefill[],
): Map<string, FuelConsumptionResult> {
  const byMachine = new Map<string, FuelRefill[]>();
  for (const r of fuelRefills) {
    if (r.deleted_at) continue;
    const list = byMachine.get(r.machine_id) ?? [];
    list.push(r);
    byMachine.set(r.machine_id, list);
  }
  const out = new Map<string, FuelConsumptionResult>();
  for (const [id, list] of byMachine) out.set(id, machineConsumption(list));
  return out;
}

/** Semaforo di un documento del mezzo (riuso dell'alert di scadenza 0.2.0). */
export function documentSemaphore(
  expiresAt: string | null,
  warningDays = MACHINERY_WARNING_DAYS,
  today: Date = new Date(),
): LotExpiryStatus {
  return expiryStatus(expiresAt, today, warningDays);
}

/** Voce del cruscotto "Richiede attenzione" (§5.8), con il residuo per la UI. */
export interface AttentionEntry {
  kind: AttentionKind;
  machineId: string | null;
  equipmentId: string | null;
  /** Denominazione del mezzo/attrezzo interessato. */
  subject: string;
  /** Entità di origine (piano/documento) per la navigazione al dettaglio. */
  refId: string | null;
  /**
   * Residuo alla soglia: giorni (documenti/manutenzione a tempo) o ore
   * (manutenzione a ore); negativo se superata. `null` per stato/anomalia.
   */
  remaining: number | null;
  unit: "days" | "hours" | null;
}

export interface AttentionInput {
  machines: Machine[];
  equipment: Equipment[];
  schedules: MaintenanceSchedule[];
  documents: MachineDocument[];
  fuelRefills: FuelRefill[];
  today?: Date;
  warningDays?: number;
  warningHours?: number;
}

/**
 * Aggrega le voci realmente ACTIONABLE (§5.8): manutenzioni in scadenza/scadute
 * (tempo o ore), documenti in scadenza/scaduti, consumi anomali e mezzi
 * fermi/in manutenzione. I mezzi/attrezzi dismessi sono esclusi (retired).
 * Nessuna stringa localizzata qui: la UI compone l'etichetta da `kind`+residuo.
 */
export function buildAttentionEntries(input: AttentionInput): AttentionEntry[] {
  const today = input.today ?? new Date();
  const warningDays = input.warningDays ?? MACHINERY_WARNING_DAYS;
  const warningHours = input.warningHours ?? MACHINERY_WARNING_HOURS;

  const machineById = new Map(input.machines.map((m) => [m.id, m]));
  const equipmentById = new Map(input.equipment.map((e) => [e.id, e]));
  const subjectOf = (machineId: string | null, equipmentId: string | null) =>
    (machineId ? machineById.get(machineId)?.name : null) ??
    (equipmentId ? equipmentById.get(equipmentId)?.name : null) ??
    "";
  const isRetired = (machineId: string | null, equipmentId: string | null) => {
    const m = machineId ? machineById.get(machineId) : null;
    const e = equipmentId ? equipmentById.get(equipmentId) : null;
    return m?.status === "decommissioned" || e?.status === "decommissioned";
  };

  const entries: AttentionEntry[] = [];

  // Manutenzioni in scadenza/scadute (tempo o ore).
  for (const s of input.schedules) {
    if (s.deleted_at || !s.active) continue;
    if (isRetired(s.machine_id, s.equipment_id)) continue;
    const counter =
      (s.machine_id ? Number(machineById.get(s.machine_id)?.hour_counter) : null) ??
      (s.equipment_id
        ? Number(equipmentById.get(s.equipment_id)?.usage_counter)
        : null) ??
      0;
    const evaln = evaluateMaintenance(
      {
        trigger_type: s.trigger_type,
        due_date: s.due_date != null ? dateOnly(s.due_date) : null,
        due_hours: s.due_hours != null ? Number(s.due_hours) : null,
      },
      counter,
      today,
      { warningDays, warningHours },
    );
    if (evaln.urgency === "ok") continue;
    entries.push({
      kind: evaln.urgency === "overdue" ? "maintenance_overdue" : "maintenance_due",
      machineId: s.machine_id,
      equipmentId: s.equipment_id,
      subject: subjectOf(s.machine_id, s.equipment_id),
      refId: s.id,
      remaining: evaln.remaining,
      unit: evaln.unit,
    });
  }

  // Documenti in scadenza/scaduti.
  for (const d of input.documents) {
    if (d.deleted_at) continue;
    if (isRetired(d.machine_id, d.equipment_id)) continue;
    const status = documentSemaphore(d.expires_at, warningDays, today);
    if (status === "valid") continue;
    const expiry = new Date(`${dateOnly(d.expires_at)}T23:59:59.999`);
    const remaining = Math.floor(
      (expiry.getTime() - today.getTime()) / 86_400_000,
    );
    entries.push({
      kind: status === "expired" ? "document_expired" : "document_expiring",
      machineId: d.machine_id,
      equipmentId: d.equipment_id,
      subject: subjectOf(d.machine_id, d.equipment_id),
      refId: d.id,
      remaining,
      unit: "days",
    });
  }

  // Consumi anomali.
  const consumption = consumptionByMachine(input.fuelRefills);
  for (const [machineId, res] of consumption) {
    if (!res.anomaly) continue;
    if (isRetired(machineId, null)) continue;
    entries.push({
      kind: "fuel_anomaly",
      machineId,
      equipmentId: null,
      subject: subjectOf(machineId, null),
      refId: machineId,
      remaining: null,
      unit: null,
    });
  }

  // Mezzi/attrezzi fermi o in manutenzione.
  for (const m of input.machines) {
    if (m.deleted_at) continue;
    if (m.status === "maintenance" || m.status === "breakdown") {
      entries.push({
        kind: "machine_down",
        machineId: m.id,
        equipmentId: null,
        subject: m.name,
        refId: m.id,
        remaining: null,
        unit: null,
      });
    }
  }
  for (const e of input.equipment) {
    if (e.deleted_at) continue;
    if (e.status === "maintenance" || e.status === "breakdown") {
      entries.push({
        kind: "machine_down",
        machineId: null,
        equipmentId: e.id,
        subject: e.name,
        refId: e.id,
        remaining: null,
        unit: null,
      });
    }
  }

  // Ordine: prima gli scaduti/superati, poi le scadenze imminenti.
  const severity: Record<AttentionKind, number> = {
    maintenance_overdue: 0,
    document_expired: 1,
    machine_down: 2,
    fuel_anomaly: 3,
    maintenance_due: 4,
    document_expiring: 5,
  };
  return entries.sort((a, b) => severity[a.kind] - severity[b.kind]);
}
