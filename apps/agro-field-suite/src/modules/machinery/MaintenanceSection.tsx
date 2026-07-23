import {
  type MaintenanceCategory,
  type MaintenanceLog,
  type MaintenanceTriggerType,
  useAgroStore,
} from "@agrogea/core";
import { evaluateMaintenance, type MaintenanceUrgency } from "@agrogea/tools";
import { Button, Input, Label, Select, cn } from "@geolibre/ui";
import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MACHINERY_WARNING_DAYS, MACHINERY_WARNING_HOURS, dateOnly } from "./machinery-view";

const todayIso = () => new Date().toISOString().slice(0, 10);

const CATEGORIES: MaintenanceCategory[] = ["routine", "extraordinary"];
const TRIGGERS: MaintenanceTriggerType[] = ["time", "hours"];

const URGENCY_STYLE: Record<MaintenanceUrgency, string> = {
  ok: "bg-[var(--ok-l)] text-[var(--ok)]",
  due: "bg-[var(--warn-l)] text-[var(--warn)]",
  overdue: "bg-[var(--danger-l)] text-[var(--danger)]",
};
const URGENCY_LABEL_KEY: Record<MaintenanceUrgency, string> = {
  ok: "machinery.maintenance.urgencyOk",
  due: "machinery.maintenance.urgencyDue",
  overdue: "machinery.maintenance.urgencyOverdue",
};

interface ScheduleDraft {
  name: string;
  category: MaintenanceCategory;
  triggerType: MaintenanceTriggerType;
  intervalDays: string;
  dueDate: string;
  intervalHours: string;
  dueHours: string;
  active: boolean;
  notes: string;
}

const EMPTY_SCHEDULE: ScheduleDraft = {
  name: "",
  category: "routine",
  triggerType: "time",
  intervalDays: "",
  dueDate: "",
  intervalHours: "",
  dueHours: "",
  active: true,
  notes: "",
};

/**
 * Scadenziario manutenzione (§5.3): piani (dallo store, filtrati per mezzo/
 * attrezzo) con urgenza calcolata da `evaluateMaintenance` (engine puro di
 * `@agrogea/tools`) sul contatore corrente, form nuovo piano, form "Registra
 * intervento" (con scarico opzionale di un ricambio dal Magazzino) e storico
 * interventi caricato via DAL (`maintenance_logs` non è idratato nello store).
 */
export function MaintenanceSection({
  kind,
  id,
  currentCounter,
}: {
  kind: "machine" | "equipment";
  id: string;
  currentCounter: number;
}) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const allSchedules = useAgroStore((s) => s.maintenanceSchedules);
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  const saveMaintenanceSchedule = useAgroStore((s) => s.saveMaintenanceSchedule);
  const deleteMaintenanceSchedule = useAgroStore((s) => s.deleteMaintenanceSchedule);
  const recordMaintenance = useAgroStore((s) => s.recordMaintenance);

  const schedules = useMemo(
    () =>
      allSchedules.filter((s) =>
        kind === "machine" ? s.machine_id === id : s.equipment_id === id,
      ),
    [allSchedules, kind, id],
  );

  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [logsVersion, setLogsVersion] = useState(0);

  useEffect(() => {
    if (!dal) return;
    let active = true;
    void dal
      .listMaintenanceLogs(kind === "machine" ? { machineId: id } : { equipmentId: id })
      .then((rows) => {
        if (active) setLogs(rows);
      });
    return () => {
      active = false;
    };
  }, [dal, kind, id, logsVersion]);

  // -- nuovo piano ------------------------------------------------------------
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(EMPTY_SCHEDULE);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveSchedule(event: FormEvent) {
    event.preventDefault();
    if (savingSchedule || scheduleDraft.name.trim() === "") return;
    setSavingSchedule(true);
    setError(null);
    try {
      await saveMaintenanceSchedule({
        machine_id: kind === "machine" ? id : null,
        equipment_id: kind === "equipment" ? id : null,
        name: scheduleDraft.name.trim(),
        category: scheduleDraft.category,
        trigger_type: scheduleDraft.triggerType,
        interval_days:
          scheduleDraft.triggerType === "time" && scheduleDraft.intervalDays.trim() !== ""
            ? Number(scheduleDraft.intervalDays)
            : null,
        due_date:
          scheduleDraft.triggerType === "time" && scheduleDraft.dueDate.trim() !== ""
            ? scheduleDraft.dueDate
            : null,
        interval_hours:
          scheduleDraft.triggerType === "hours" && scheduleDraft.intervalHours.trim() !== ""
            ? Number(scheduleDraft.intervalHours)
            : null,
        due_hours:
          scheduleDraft.triggerType === "hours" && scheduleDraft.dueHours.trim() !== ""
            ? Number(scheduleDraft.dueHours)
            : null,
        active: scheduleDraft.active,
        notes: scheduleDraft.notes.trim() || null,
      });
      setScheduleDraft(EMPTY_SCHEDULE);
      setScheduleOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    setError(null);
    try {
      await deleteMaintenanceSchedule(scheduleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // -- registra intervento -----------------------------------------------------
  const [interventionOpen, setInterventionOpen] = useState(false);
  const [scheduleId, setScheduleId] = useState("");
  const [performedAt, setPerformedAt] = useState(todayIso());
  const [counterHours, setCounterHours] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [parts, setParts] = useState("");
  const [lotId, setLotId] = useState("");
  const [partsQuantity, setPartsQuantity] = useState("");
  const [savingIntervention, setSavingIntervention] = useState(false);

  const availableLots = useMemo(
    () =>
      lots
        .filter((l) => !l.deleted_at && Number(l.quantity_on_hand) > 0)
        .map((l) => ({
          lot: l,
          product: products.find((p) => p.id === l.product_id) ?? null,
        }))
        .sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? "")),
    [lots, products],
  );
  const selectedLot = availableLots.find((x) => x.lot.id === lotId) ?? null;
  const lotQuantityInvalid =
    selectedLot != null &&
    partsQuantity.trim() !== "" &&
    Number(partsQuantity) > Number(selectedLot.lot.quantity_on_hand);

  function openIntervention(forScheduleId: string | null) {
    setScheduleId(forScheduleId ?? "");
    setPerformedAt(todayIso());
    setCounterHours(String(currentCounter));
    setDescription("");
    setCost("");
    setParts("");
    setLotId("");
    setPartsQuantity("");
    setInterventionOpen(true);
    setError(null);
  }

  async function handleSubmitIntervention(event: FormEvent) {
    event.preventDefault();
    if (savingIntervention || lotQuantityInvalid) return;
    setSavingIntervention(true);
    setError(null);
    try {
      // Un lotto selezionato senza quantità valorizzata NON genera uno scarico:
      // in tal caso il riferimento al lotto è omesso (evita un product_lot_id
      // "appeso" senza parts_quantity nello storico).
      const qty =
        lotId && partsQuantity.trim() !== "" ? Number(partsQuantity) : null;
      const usesLot = qty != null && qty > 0;
      await recordMaintenance({
        schedule_id: scheduleId || null,
        machine_id: kind === "machine" ? id : null,
        equipment_id: kind === "equipment" ? id : null,
        performed_at: performedAt,
        counter_hours: counterHours.trim() === "" ? null : Number(counterHours),
        description: description.trim() || null,
        cost: cost.trim() === "" ? null : Number(cost),
        parts: parts.trim() || null,
        product_lot_id: usesLot ? lotId : null,
        parts_quantity: usesLot ? qty : null,
      });
      setInterventionOpen(false);
      setLogsVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIntervention(false);
    }
  }

  function remainingLabel(
    evaln: ReturnType<typeof evaluateMaintenance>,
  ): string | null {
    if (evaln.remaining == null) return null;
    const overdue = evaln.urgency === "overdue";
    const count = Math.abs(evaln.remaining);
    if (evaln.unit === "days") {
      return overdue
        ? t("machinery.maintenance.overdueDays", { count })
        : t("machinery.maintenance.remainingDays", { count });
    }
    return overdue
      ? t("machinery.maintenance.overdueHours", { count })
      : t("machinery.maintenance.remainingHours", { count });
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("machinery.maintenance.title")}
        </p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="min-h-[36px] px-2 text-xs"
            onClick={() => openIntervention(null)}
          >
            {t("machinery.maintenance.recordIntervention")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[36px] px-2 text-xs"
            onClick={() => setScheduleOpen((v) => !v)}
          >
            {t("machinery.maintenance.add")}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {scheduleOpen && (
        <form
          onSubmit={handleSaveSchedule}
          className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-nome">{t("machinery.maintenance.name")}</Label>
            <Input
              id="ms-nome"
              value={scheduleDraft.name}
              onChange={(e) => setScheduleDraft({ ...scheduleDraft, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-categoria">{t("machinery.maintenance.category")}</Label>
              <Select
                id="ms-categoria"
                value={scheduleDraft.category}
                onChange={(e) =>
                  setScheduleDraft({
                    ...scheduleDraft,
                    category: e.target.value as MaintenanceCategory,
                  })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(
                      c === "routine"
                        ? "machinery.maintenance.categoryRoutine"
                        : "machinery.maintenance.categoryExtraordinary",
                    )}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-trigger">{t("machinery.maintenance.triggerType")}</Label>
              <Select
                id="ms-trigger"
                value={scheduleDraft.triggerType}
                onChange={(e) =>
                  setScheduleDraft({
                    ...scheduleDraft,
                    triggerType: e.target.value as MaintenanceTriggerType,
                  })
                }
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>
                    {t(
                      tr === "time"
                        ? "machinery.maintenance.triggerTime"
                        : "machinery.maintenance.triggerHours",
                    )}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {scheduleDraft.triggerType === "time" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ms-intervallo-gg">
                  {t("machinery.maintenance.intervalDays")}
                </Label>
                <Input
                  id="ms-intervallo-gg"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={scheduleDraft.intervalDays}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, intervalDays: e.target.value })
                  }
                  className="agro-num"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ms-scadenza">{t("machinery.maintenance.dueDate")}</Label>
                <Input
                  id="ms-scadenza"
                  type="date"
                  value={scheduleDraft.dueDate}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, dueDate: e.target.value })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ms-intervallo-h">
                  {t("machinery.maintenance.intervalHours")}
                </Label>
                <Input
                  id="ms-intervallo-h"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={scheduleDraft.intervalHours}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, intervalHours: e.target.value })
                  }
                  className="agro-num"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ms-soglia-h">{t("machinery.maintenance.dueHours")}</Label>
                <Input
                  id="ms-soglia-h"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={scheduleDraft.dueHours}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, dueHours: e.target.value })
                  }
                  className="agro-num"
                />
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={scheduleDraft.active}
              onChange={(e) =>
                setScheduleDraft({ ...scheduleDraft, active: e.target.checked })
              }
            />
            {t("machinery.maintenance.active")}
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-note">{t("machinery.maintenance.notes")}</Label>
            <textarea
              id="ms-note"
              value={scheduleDraft.notes}
              onChange={(e) => setScheduleDraft({ ...scheduleDraft, notes: e.target.value })}
              rows={2}
              className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={savingSchedule || scheduleDraft.name.trim() === ""}
              className="min-h-[var(--touch-min)] flex-1"
            >
              {savingSchedule ? t("logbook.common.saving") : t("machinery.maintenance.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleOpen(false)}
              className="min-h-[var(--touch-min)]"
            >
              {t("logbook.common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {interventionOpen && (
        <form
          onSubmit={handleSubmitIntervention}
          className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mi-piano">{t("machinery.maintenance.linkedSchedule")}</Label>
            <Select
              id="mi-piano"
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
            >
              <option value="">{t("machinery.maintenance.noSchedule")}</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-data">{t("machinery.maintenance.performedAt")}</Label>
              <Input
                id="mi-data"
                type="date"
                value={performedAt}
                onChange={(e) => setPerformedAt(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-contatore">{t("machinery.maintenance.counterHours")}</Label>
              <Input
                id="mi-contatore"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={counterHours}
                onChange={(e) => setCounterHours(e.target.value)}
                className="agro-num"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mi-descrizione">{t("machinery.maintenance.description")}</Label>
            <Input
              id="mi-descrizione"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-costo">{t("machinery.maintenance.cost")}</Label>
              <Input
                id="mi-costo"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mi-ricambi">{t("machinery.maintenance.parts")}</Label>
              <Input
                id="mi-ricambi"
                value={parts}
                onChange={(e) => setParts(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("machinery.maintenance.partsFromWarehouse")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mi-lotto">{t("machinery.maintenance.partsLot")}</Label>
                <Select
                  id="mi-lotto"
                  value={lotId}
                  onChange={(e) => {
                    setLotId(e.target.value);
                    setPartsQuantity("");
                  }}
                >
                  <option value="">{t("machinery.maintenance.noLot")}</option>
                  {availableLots.map(({ lot, product }) => (
                    <option key={lot.id} value={lot.id}>
                      {(product?.name ?? "?") +
                        " · " +
                        (lot.lot_number ?? lot.id.slice(0, 8)) +
                        " (" +
                        t("machinery.maintenance.partsAvailable", {
                          qty: Number(lot.quantity_on_hand).toLocaleString("it-IT"),
                          unit: product?.unit ?? "",
                        }) +
                        ")"}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mi-quantita">{t("machinery.maintenance.partsQuantity")}</Label>
                <Input
                  id="mi-quantita"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={partsQuantity}
                  onChange={(e) => setPartsQuantity(e.target.value)}
                  className="agro-num"
                  disabled={!lotId}
                />
              </div>
            </div>
            {lotQuantityInvalid && (
              <p className="text-[11px] text-[var(--danger)]">
                {t("machinery.maintenance.partsAvailable", {
                  qty: Number(selectedLot?.lot.quantity_on_hand ?? 0).toLocaleString("it-IT"),
                  unit: selectedLot?.product?.unit ?? "",
                })}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={savingIntervention || lotQuantityInvalid}
              className="min-h-[var(--touch-min)] flex-1"
            >
              {savingIntervention
                ? t("logbook.common.saving")
                : t("machinery.maintenance.submitIntervention")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInterventionOpen(false)}
              className="min-h-[var(--touch-min)]"
            >
              {t("logbook.common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {schedules.length === 0 ? (
        <p className="py-2 text-center text-xs text-[var(--ink-3)]">
          {t("machinery.maintenance.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {schedules.map((s) => {
            const evaln = evaluateMaintenance(
              {
                trigger_type: s.trigger_type,
                due_date: s.due_date != null ? dateOnly(s.due_date) : null,
                due_hours: s.due_hours != null ? Number(s.due_hours) : null,
              },
              currentCounter,
              new Date(),
              { warningDays: MACHINERY_WARNING_DAYS, warningHours: MACHINERY_WARNING_HOURS },
            );
            const remaining = remainingLabel(evaln);
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] p-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                    {s.name}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        URGENCY_STYLE[evaln.urgency],
                      )}
                    >
                      {t(URGENCY_LABEL_KEY[evaln.urgency] as never)}
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--ink-3)]">
                      {t(
                        s.category === "routine"
                          ? "machinery.maintenance.categoryRoutine"
                          : "machinery.maintenance.categoryExtraordinary",
                      )}
                    </span>
                    {!s.active && (
                      <span className="shrink-0 rounded-full bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--ink-3)]">
                        {t("machinery.maintenance.inactive")}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-[var(--ink-3)]">
                    {remaining ?? ""}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteSchedule(s.id)}
                  aria-label={t("machinery.maintenance.delete")}
                  title={t("machinery.maintenance.delete")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)]"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-[var(--ink-2)]">
          {t("machinery.maintenance.history")}
        </p>
        {logs.length === 0 ? (
          <p className="py-2 text-center text-xs text-[var(--ink-3)]">
            {t("machinery.maintenance.noHistory")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {logs.map((log) => {
              const lotInfo = log.product_lot_id
                ? availableLots.find((x) => x.lot.id === log.product_lot_id)
                : null;
              return (
                <li
                  key={log.id}
                  className="rounded-[var(--r-2)] border border-[var(--line)] px-2 py-1 text-xs"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[var(--ink-2)]">
                      {new Date(log.performed_at).toLocaleDateString("it-IT")}
                      {log.description ? ` · ${log.description}` : ""}
                    </span>
                    {log.cost != null && (
                      <span className="agro-num shrink-0 text-[var(--ink-3)]">
                        {Number(log.cost).toFixed(2)} €
                      </span>
                    )}
                  </span>
                  {(log.parts || log.product_lot_id) && (
                    <span className="block text-[11px] text-[var(--ink-3)]">
                      {log.parts}
                      {log.product_lot_id && log.parts_quantity != null
                        ? (log.parts ? " · " : "") +
                          t("machinery.maintenance.usedPart", {
                            qty: Number(log.parts_quantity).toLocaleString("it-IT"),
                            unit: lotInfo?.product?.unit ?? "",
                            lot: lotInfo?.lot.lot_number ?? log.product_lot_id.slice(0, 8),
                          })
                        : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
