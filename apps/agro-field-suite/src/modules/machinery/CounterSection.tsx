import { type CounterAdjustment, type CounterAdjustmentType, useAgroStore } from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const ADJUST_TYPES: CounterAdjustmentType[] = ["manual", "engine_reset"];
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Contatore + rettifica manuale (§4.6): mostra il valore corrente (dallo
 * store, sempre aggiornato) e uno storico rettifiche caricato via DAL
 * (`counter_adjustments` non è idratato nello store — solo consultabile su
 * richiesta). Dopo una rettifica il valore corrente si aggiorna da solo
 * (adjustCounter re-idrata mezzi/attrezzi): qui si ricarica solo lo storico.
 */
export function CounterSection({
  kind,
  id,
  counterValue,
  counterLabel,
}: {
  kind: "machine" | "equipment";
  id: string;
  counterValue: number;
  counterLabel: string;
}) {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const adjustCounter = useAgroStore((s) => s.adjustCounter);

  const [history, setHistory] = useState<CounterAdjustment[]>([]);
  const [type, setType] = useState<CounterAdjustmentType>("manual");
  const [newValue, setNewValue] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dal) return;
    let active = true;
    void dal
      .listCounterAdjustments(kind === "machine" ? { machineId: id } : { equipmentId: id })
      .then((rows) => {
        if (active) setHistory(rows);
      });
    return () => {
      active = false;
    };
  }, [dal, kind, id, counterValue]);

  const value = Number.parseFloat(newValue);
  const validValue = Number.isFinite(value) && value >= 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !validValue) return;
    setSaving(true);
    setError(null);
    try {
      await adjustCounter({
        machine_id: kind === "machine" ? id : undefined,
        equipment_id: kind === "equipment" ? id : undefined,
        type,
        new_value: value,
        adjusted_at: date,
        reason: reason.trim() || null,
      });
      setNewValue("");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {counterLabel}
      </p>
      <p className="agro-num text-2xl font-semibold text-[var(--ink)]">
        {counterValue.toLocaleString("it-IT")}
        <span className="ml-1 text-sm font-normal text-[var(--ink-3)]">h</span>
      </p>

      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2">
        <p className="text-xs font-semibold text-[var(--ink-2)]">
          {t("machinery.counter.adjustTitle")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-tipo">{t("machinery.counter.type")}</Label>
            <Select
              id="cs-tipo"
              value={type}
              onChange={(e) => setType(e.target.value as CounterAdjustmentType)}
            >
              {ADJUST_TYPES.map((a) => (
                <option key={a} value={a}>
                  {t(`machinery.adjustType.${a}` as never)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-valore">{t("machinery.counter.newValue")}</Label>
            <Input
              id="cs-valore"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="agro-num"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-data">{t("machinery.counter.date")}</Label>
            <Input
              id="cs-data"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-motivo">{t("machinery.counter.reason")}</Label>
            <Input
              id="cs-motivo"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("machinery.counter.reasonPlaceholder")}
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={saving || !validValue}
          className="min-h-[var(--touch-min)]"
        >
          {saving ? t("logbook.common.saving") : t("machinery.counter.submit")}
        </Button>
      </form>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-[var(--ink-2)]">
          {t("machinery.counter.history")}
        </p>
        {history.length === 0 ? (
          <p className="py-2 text-center text-xs text-[var(--ink-3)]">
            {t("machinery.counter.noHistory")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-[var(--r-2)] border border-[var(--line)] px-2 py-1 text-xs"
              >
                <span className="text-[var(--ink-2)]">
                  {t(`machinery.adjustType.${a.type}` as never)}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
                <span className="agro-num shrink-0 text-[var(--ink-3)]">
                  {a.previous_value != null
                    ? t("machinery.counter.from", { value: Number(a.previous_value) })
                    : ""}
                  {" → "}
                  <strong className="text-[var(--ink)]">{Number(a.new_value)}</strong>
                  {" · "}
                  {new Date(a.adjusted_at).toLocaleDateString("it-IT")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
