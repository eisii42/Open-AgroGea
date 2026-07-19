import {
  type ProductLot,
  type Product,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, Input, Label, Select, cn } from "@geolibre/ui";
import { Fuel, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Pannello "Refill carburante" (0.3.0, §5.5/§6.2), STACCATO dal Magazzino:
 * raggiungibile solo dal pulsante rapido a bordo campo (FAB, sotto le note
 * geotaggate). Inserisce i rifornimenti che SCARICANO un lot `carburante`
 * (cisterna aziendale) dal Magazzino con blocco atomico, ed elenca i
 * rifornimenti filtrabili per mezzo e per cisterna. Il form chiede l'essenziale
 * (mezzo, litri, cisterna, contaore opz.) e deriva l'UMA dal product carburante.
 * Allo store flag `quickRefillPending` apre SUBITO il form precompilato (data
 * odierna, ultimo mezzo, cisterna suggerita).
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

interface CisternOption {
  lot: ProductLot;
  product: Product;
}

export function FuelRefillTab({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const machines = useAgroStore((s) => s.machines);
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  const fuelRefills = useAgroStore((s) => s.fuelRefills);
  const recordFuelRefill = useAgroStore((s) => s.recordFuelRefill);
  const deleteFuelRefill = useAgroStore((s) => s.deleteFuelRefill);
  const quickRefill = useAgroStore((s) => s.quickRefillPending);
  const consumeQuickRefill = useAgroStore((s) => s.consumeQuickRefill);

  // Cisterne = lots di prodotti di categoria `carburante` (giacenza > 0 per il
  // form; tutte per l'etichettatura dell'elenco storico).
  const cisterns = useMemo<CisternOption[]>(() => {
    const productById = new Map(products.map((p) => [p.id, p]));
    return lots
      .filter((l) => !l.deleted_at)
      .map((lot) => ({ lot, product: productById.get(lot.product_id) }))
      .filter((x): x is CisternOption => x.product?.category === "fuel");
  }, [lots, products]);
  const availableCisterns = useMemo(
    () => cisterns.filter((c) => Number(c.lot.quantity_on_hand) > 0),
    [cisterns],
  );

  // I mezzi dismessi non sono un target valido per un nuovo rifornimento.
  const selectableMachines = useMemo(
    () => machines.filter((m) => m.status !== "decommissioned"),
    [machines],
  );
  const machineById = useMemo(
    () => new Map(machines.map((m) => [m.id, m])),
    [machines],
  );
  const cisternByLotId = useMemo(
    () => new Map(cisterns.map((c) => [c.lot.id, c])),
    [cisterns],
  );

  // -- form -------------------------------------------------------------------
  const [formOpen, setFormOpen] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [lotId, setLotId] = useState("");
  const [liters, setLiters] = useState("");
  const [date, setDate] = useState(todayIso());
  const [counterHours, setCounterHours] = useState("");
  const [operator, setOperator] = useState("");
  const [fullTank, setFullTank] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openForm = () => {
    // Default intelligenti (§6.2): ultimo mezzo rifornito, cisterna con più
    // giacenza, data odierna. Riducono l'attrito senza vincolare.
    const lastMachineId =
      fuelRefills.find((r) => !r.deleted_at && machineById.has(r.machine_id))
        ?.machine_id ?? selectableMachines[0]?.id ?? "";
    const suggestedCistern = [...availableCisterns].sort(
      (a, b) => Number(b.lot.quantity_on_hand) - Number(a.lot.quantity_on_hand),
    )[0];
    setMachineId(lastMachineId);
    setLotId(suggestedCistern?.lot.id ?? "");
    setLiters("");
    setDate(todayIso());
    setCounterHours("");
    setOperator("");
    setFullTank(true);
    setNotes("");
    setError(null);
    setFormOpen(true);
  };

  // Accesso rapido a bordo campo (FAB): apre il form precompilato una sola volta.
  useEffect(() => {
    if (!quickRefill) return;
    consumeQuickRefill();
    if (selectableMachines.length > 0 && availableCisterns.length > 0) {
      openForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRefill]);

  const selectedCistern = cisternByLotId.get(lotId) ?? null;
  const available = selectedCistern
    ? Number(selectedCistern.lot.quantity_on_hand)
    : null;
  const litersNum = Number.parseFloat(liters);
  const exceedsStock =
    available != null && Number.isFinite(litersNum) && litersNum > available;
  const selectedMachine = machineById.get(machineId) ?? null;
  const canSave =
    !saving &&
    machineId !== "" &&
    lotId !== "" &&
    Number.isFinite(litersNum) &&
    litersNum > 0 &&
    !exceedsStock;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await recordFuelRefill({
        machine_id: machineId,
        product_lot_id: lotId,
        liters: litersNum,
        refueled_at: date,
        counter_hours: counterHours.trim() === "" ? null : Number(counterHours),
        operator_name: operator.trim() || null,
        full_tank: fullTank,
        notes: notes.trim() || null,
      });
      setFormOpen(false);
    } catch (e) {
      // Blocco atomico (giacenza cisterna insufficiente): il form resta aperto.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // -- elenco filtrabile per mezzo e per cisterna -----------------------------
  const [filterMachineId, setFilterMachineId] = useState("");
  const [filterLotId, setFilterLotId] = useState("");

  const visibleRefills = useMemo(
    () =>
      fuelRefills.filter(
        (r) =>
          !r.deleted_at &&
          (filterMachineId === "" || r.machine_id === filterMachineId) &&
          (filterLotId === "" || r.product_lot_id === filterLotId),
      ),
    [fuelRefills, filterMachineId, filterLotId],
  );
  const totalLiters = useMemo(
    () => visibleRefills.reduce((sum, r) => sum + Number(r.liters), 0),
    [visibleRefills],
  );

  return (
    <FieldSheet
      wide={formOpen}
      title={formOpen ? t("machineryRefill.newRefill") : t("machineryRefill.title")}
      onClose={onClose}
      footer={
        formOpen ? undefined : (
          <Button
            className="min-h-[var(--touch-min)] w-full gap-1"
            disabled={selectableMachines.length === 0 || availableCisterns.length === 0}
            onClick={openForm}
          >
            <Plus size={16} /> {t("machineryRefill.newRefill")}
          </Button>
        )
      }
    >
      {formOpen ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="flex items-center gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--ink-3)]">
            <Fuel size={14} className="shrink-0 text-[var(--accent)]" />
            {t("machineryRefill.quickHint")}
          </p>

          {error && (
            <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rf-machine">{t("machineryRefill.machine")}</Label>
            <Select
              id="rf-machine"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              required
            >
              <option value="">{t("machineryRefill.selectMachine")}</option>
              {selectableMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.machine_type ? ` · ${m.machine_type}` : ""}
                </option>
              ))}
            </Select>
            {selectedMachine && selectedMachine.status !== "operational" && (
              <p className="text-[11px] font-medium text-[var(--warn)]">
                ⚠ {t("machineryRefill.notOperational")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rf-cistern">{t("machineryRefill.cistern")}</Label>
            <Select
              id="rf-cistern"
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              required
            >
              <option value="">{t("machineryRefill.selectCistern")}</option>
              {availableCisterns.map(({ lot, product }) => (
                <option key={lot.id} value={lot.id}>
                  {product.name}
                  {lot.lot_number ? ` · ${lot.lot_number}` : ""}
                  {" · "}
                  {t("machineryRefill.available", {
                    qty: Number(lot.quantity_on_hand).toLocaleString("it-IT"),
                  })}
                </option>
              ))}
            </Select>
            {selectedCistern?.product.uma_code && (
              <p className="text-[11px] text-[var(--ink-3)]">
                {t("machineryRefill.uma")}: {selectedCistern.product.uma_code}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-liters">{t("machineryRefill.liters")}</Label>
              <Input
                id="rf-liters"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                max={available ?? undefined}
                value={liters}
                onChange={(e) => setLiters(e.target.value)}
                className="agro-num"
                required
              />
              {exceedsStock && (
                <p className="text-[11px] text-[var(--danger)]">
                  {t("machineryRefill.insufficient")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-date">{t("machineryRefill.date")}</Label>
              <Input
                id="rf-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-counter">{t("machineryRefill.counterHours")}</Label>
              <Input
                id="rf-counter"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={counterHours}
                onChange={(e) => setCounterHours(e.target.value)}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-operator">{t("machineryRefill.operator")}</Label>
              <Input
                id="rf-operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={fullTank}
              onChange={(e) => setFullTank(e.target.checked)}
            />
            {t("machineryRefill.fullTank")}
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rf-notes">{t("machineryRefill.notes")}</Label>
            <textarea
              id="rf-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={!canSave} className="min-h-[var(--touch-min)] flex-1">
              {saving ? t("logbook.common.saving") : t("machineryRefill.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
              className="min-h-[var(--touch-min)]"
            >
              {t("logbook.common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {availableCisterns.length === 0 && (
            <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
              {t("machineryRefill.noFuelLots")}
            </p>
          )}
          {selectableMachines.length === 0 && (
            <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
              {t("machineryRefill.noMachines")}
            </p>
          )}

          {/* Filtri: per mezzo e per cisterna (§6.1). */}
          <div className="grid grid-cols-2 gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-f-machine">{t("machineryRefill.filterMachine")}</Label>
              <Select
                id="rf-f-machine"
                value={filterMachineId}
                onChange={(e) => setFilterMachineId(e.target.value)}
              >
                <option value="">{t("machineryRefill.allMachines")}</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rf-f-cistern">{t("machineryRefill.filterCistern")}</Label>
              <Select
                id="rf-f-cistern"
                value={filterLotId}
                onChange={(e) => setFilterLotId(e.target.value)}
              >
                <option value="">{t("machineryRefill.allCisterns")}</option>
                {cisterns.map(({ lot, product }) => (
                  <option key={lot.id} value={lot.id}>
                    {product.name}
                    {lot.lot_number ? ` · ${lot.lot_number}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {visibleRefills.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ink-3)]">
              {t("machineryRefill.empty")}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[var(--ink-3)]">
                {t("machineryRefill.byMachineTotal", {
                  liters: totalLiters.toLocaleString("it-IT"),
                })}
              </p>
              <ul className="flex flex-col gap-2">
                {visibleRefills.map((r) => {
                  const machine = machineById.get(r.machine_id);
                  const cistern = cisternByLotId.get(r.product_lot_id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                          <span className="truncate">{machine?.name ?? "—"}</span>
                          <span className="agro-num shrink-0 text-[var(--accent)]">
                            {Number(r.liters).toLocaleString("it-IT")}{" "}
                            {t("machineryRefill.litersShort")}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-[var(--ink-3)]">
                          {new Date(r.refueled_at).toLocaleDateString("it-IT")}
                          {cistern ? ` · ${cistern.product.name}` : ""}
                          {r.counter_hours != null
                            ? ` · ${Number(r.counter_hours).toLocaleString("it-IT")} h`
                            : ""}
                          {r.full_tank ? "" : ` · ${t("machineryRefill.partial")}`}
                          {r.operator_name ? ` · ${r.operator_name}` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteFuelRefill(r.id)}
                        title={t("machineryRefill.deleteRefill")}
                        aria-label={t("machineryRefill.deleteRefill")}
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)]",
                          "text-[var(--danger)] hover:bg-[var(--danger-l)]",
                        )}
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </FieldSheet>
  );
}
