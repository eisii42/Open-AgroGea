import {
  type Equipment,
  type Machine,
  type MachineStatus,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateOnly } from "./machinery-view";

const STATUSES: MachineStatus[] = [
  "operational",
  "maintenance",
  "breakdown",
  "decommissioned",
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const numFloat = (s: string) => (s.trim() === "" ? null : Number(s));
const numInt = (s: string) => (s.trim() === "" ? null : Math.round(Number(s)));

/**
 * Form unico di anagrafica del Parco macchine (0.3.0), per MEZZI e ATTREZZI:
 * i campi specifici (targa/telaio/marca/modello/anno per i mezzi, larghezza
 * di lavoro per gli attrezzi) si alternano in base a `kind`, i campi comuni
 * (nome, stato, note, sezione Ammortamento 0.4.0) restano invariati. In
 * creazione offre una lettura iniziale del contatore: dopo il salvataggio,
 * se > 0, registra una rettifica `initial_reading` (il contatore NON è
 * impostabile da `saveMachine`/`saveEquipment`, solo da `adjustCounter`).
 */
export function MachineForm({
  kind,
  existing,
  onCancel,
  onSaved,
}: {
  kind: "machine" | "equipment";
  /** null/undefined = creazione; valorizzato = modifica (contatore non editabile qui). */
  existing?: Machine | Equipment | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const saveMachine = useAgroStore((s) => s.saveMachine);
  const saveEquipment = useAgroStore((s) => s.saveEquipment);
  const adjustCounter = useAgroStore((s) => s.adjustCounter);

  const existingMachine = kind === "machine" ? (existing as Machine | null) : null;
  const existingEquipment =
    kind === "equipment" ? (existing as Equipment | null) : null;

  const [name, setName] = useState(existing?.name ?? "");
  const [typeField, setTypeField] = useState(
    (existingMachine?.machine_type ?? existingEquipment?.equipment_type) ?? "",
  );
  const [licensePlate, setLicensePlate] = useState(existingMachine?.license_plate ?? "");
  const [chassisNumber, setChassisNumber] = useState(
    existingMachine?.chassis_number ?? "",
  );
  const [brand, setBrand] = useState(existingMachine?.brand ?? "");
  const [model, setModel] = useState(existingMachine?.model ?? "");
  const [year, setYear] = useState(
    existingMachine?.year != null ? String(existingMachine.year) : "",
  );
  const [workingWidth, setWorkingWidth] = useState(
    existingEquipment?.working_width_m != null
      ? String(existingEquipment.working_width_m)
      : "",
  );
  const [status, setStatus] = useState<MachineStatus>(existing?.status ?? "operational");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [purchaseValue, setPurchaseValue] = useState(
    existing?.purchase_value != null ? String(existing.purchase_value) : "",
  );
  const [purchaseDate, setPurchaseDate] = useState(
    existing?.purchase_date != null ? dateOnly(existing.purchase_date) : "",
  );
  const [usefulLifeHours, setUsefulLifeHours] = useState(
    existing?.useful_life_hours != null ? String(existing.useful_life_hours) : "",
  );
  const [usefulLifeYears, setUsefulLifeYears] = useState(
    existing?.useful_life_years != null ? String(existing.useful_life_years) : "",
  );
  const [residualValue, setResidualValue] = useState(
    existing?.residual_value != null ? String(existing.residual_value) : "",
  );
  const [initialCounter, setInitialCounter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = name.trim() === "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || missing) return;
    setSaving(true);
    setError(null);
    try {
      if (kind === "machine") {
        const record = await saveMachine({
          id: existingMachine?.id,
          name: name.trim(),
          machine_type: typeField.trim() || null,
          license_plate: licensePlate.trim() || null,
          chassis_number: chassisNumber.trim() || null,
          brand: brand.trim() || null,
          model: model.trim() || null,
          year: numInt(year),
          status,
          purchase_value: numFloat(purchaseValue),
          purchase_date: purchaseDate || null,
          useful_life_hours: numFloat(usefulLifeHours),
          useful_life_years: numFloat(usefulLifeYears),
          residual_value: numFloat(residualValue),
          notes: notes.trim() || null,
        });
        if (!record) return;
        const initial = numFloat(initialCounter);
        if (!existingMachine && initial != null && initial > 0) {
          await adjustCounter({
            machine_id: record.id,
            type: "initial_reading",
            new_value: initial,
            adjusted_at: todayIso(),
          });
        }
        onSaved(record.id);
      } else {
        const record = await saveEquipment({
          id: existingEquipment?.id,
          name: name.trim(),
          equipment_type: typeField.trim() || null,
          working_width_m: numFloat(workingWidth),
          status,
          purchase_value: numFloat(purchaseValue),
          purchase_date: purchaseDate || null,
          useful_life_hours: numFloat(usefulLifeHours),
          useful_life_years: numFloat(usefulLifeYears),
          residual_value: numFloat(residualValue),
          notes: notes.trim() || null,
        });
        if (!record) return;
        const initial = numFloat(initialCounter);
        if (!existingEquipment && initial != null && initial > 0) {
          await adjustCounter({
            equipment_id: record.id,
            type: "initial_reading",
            new_value: initial,
            adjusted_at: todayIso(),
          });
        }
        onSaved(record.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mf-name">{t("machinery.form.name")}</Label>
          <Input
            id="mf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mf-type">
            {kind === "machine"
              ? t("machinery.form.machineType")
              : t("machinery.form.equipmentType")}
          </Label>
          <Input
            id="mf-type"
            value={typeField}
            onChange={(e) => setTypeField(e.target.value)}
            placeholder={
              kind === "machine"
                ? t("machinery.form.machineTypePlaceholder")
                : t("machinery.form.equipmentTypePlaceholder")
            }
          />
        </div>
      </div>

      {kind === "machine" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-targa">{t("machinery.form.licensePlate")}</Label>
            <Input
              id="mf-targa"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-telaio">{t("machinery.form.chassisNumber")}</Label>
            <Input
              id="mf-telaio"
              value={chassisNumber}
              onChange={(e) => setChassisNumber(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-marca">{t("machinery.form.brand")}</Label>
            <Input id="mf-marca" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-modello">{t("machinery.form.model")}</Label>
            <Input id="mf-modello" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-anno">{t("machinery.form.year")}</Label>
            <Input
              id="mf-anno"
              type="number"
              inputMode="numeric"
              min="1900"
              step="1"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="agro-num"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mf-larghezza">{t("machinery.form.workingWidth")}</Label>
          <Input
            id="mf-larghezza"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={workingWidth}
            onChange={(e) => setWorkingWidth(e.target.value)}
            className="agro-num"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mf-stato">{t("machinery.form.status")}</Label>
        <Select
          id="mf-stato"
          value={status}
          onChange={(e) => setStatus(e.target.value as MachineStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`machinery.status.${s}` as never)}
            </option>
          ))}
        </Select>
      </div>

      {!existing && (
        <div className="flex flex-col gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
          <Label htmlFor="mf-contatore-iniziale">
            {t("machinery.form.initialCounter")}
          </Label>
          <Input
            id="mf-contatore-iniziale"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={initialCounter}
            onChange={(e) => setInitialCounter(e.target.value)}
            className="agro-num"
          />
          <p className="text-[11px] text-[var(--ink-3)]">
            {t("machinery.form.initialCounterHint")}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mf-note">{t("machinery.form.notes")}</Label>
        <textarea
          id="mf-note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      <details className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("machinery.form.advancedSection")}
        </summary>
        <p className="mb-3 mt-2 text-[11px] text-[var(--ink-3)]">
          {t("machinery.form.advancedHint")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-valore">{t("machinery.form.purchaseValue")}</Label>
            <Input
              id="mf-valore"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={purchaseValue}
              onChange={(e) => setPurchaseValue(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-data-acquisto">{t("machinery.form.purchaseDate")}</Label>
            <Input
              id="mf-data-acquisto"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-vita-ore">{t("machinery.form.usefulLifeHours")}</Label>
            <Input
              id="mf-vita-ore"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={usefulLifeHours}
              onChange={(e) => setUsefulLifeHours(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-vita-anni">{t("machinery.form.usefulLifeYears")}</Label>
            <Input
              id="mf-vita-anni"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={usefulLifeYears}
              onChange={(e) => setUsefulLifeYears(e.target.value)}
              className="agro-num"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mf-residuo">{t("machinery.form.residualValue")}</Label>
            <Input
              id="mf-residuo"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={residualValue}
              onChange={(e) => setResidualValue(e.target.value)}
              className="agro-num"
            />
          </div>
        </div>
      </details>

      {missing && name !== "" && (
        <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          {t("machinery.form.nameRequired")}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={saving || missing}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving
            ? t("logbook.common.saving")
            : kind === "machine"
              ? t("machinery.form.saveMachine")
              : t("machinery.form.saveEquipment")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[var(--touch-min)]"
        >
          {t("logbook.common.cancel")}
        </Button>
      </div>
    </form>
  );
}
