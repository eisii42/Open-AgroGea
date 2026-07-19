import { type Equipment, type Machine, useAgroStore } from "@agrogea/core";
import { Button } from "@geolibre/ui";
import { useTranslation } from "react-i18next";
import { CounterSection } from "./CounterSection";
import { DocumentsSection } from "./DocumentsSection";
import { FuelConsumptionSection } from "./FuelConsumptionSection";
import { MaintenanceSection } from "./MaintenanceSection";
import { MachineStatusBadge } from "./StatusBadge";

/**
 * Dettaglio unico di un mezzo/attrezzo del Parco macchine (0.3.0): anagrafica
 * + stato, contatore/rettifiche (§4.6), documenti/scadenze (§5.4), scadenziario
 * manutenzione (§5.3) e — solo per i mezzi — consumo carburante (§5.6). La
 * lettura del record vive nello store (sempre aggiornata dopo ogni mutazione);
 * le sotto-sezioni gestiscono da sole le proprie letture DAL on-demand.
 */
export function MachineDetail({
  kind,
  id,
  onBack,
  onEdit,
}: {
  kind: "machine" | "equipment";
  id: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const record = useAgroStore((s) =>
    kind === "machine"
      ? (s.machines.find((m) => m.id === id) ?? null)
      : (s.equipment.find((e) => e.id === id) ?? null),
  ) as Machine | Equipment | null;
  const deleteMachine = useAgroStore((s) => s.deleteMachine);
  const deleteEquipment = useAgroStore((s) => s.deleteEquipment);

  if (!record) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="self-start text-xs text-[var(--accent)]">
          {t("machinery.detail.backToList")}
        </button>
        <p className="py-8 text-center text-sm text-[var(--ink-3)]">
          {t("machinery.detail.notFound")}
        </p>
      </div>
    );
  }

  const machine = kind === "machine" ? (record as Machine) : null;
  const equipment = kind === "equipment" ? (record as Equipment) : null;
  const counterValue = machine ? Number(machine.hour_counter) : Number(equipment!.usage_counter);
  const counterLabel = machine
    ? t("machinery.detail.hourCounter")
    : t("machinery.detail.usageCounter");

  async function handleDelete() {
    if (kind === "machine") {
      await deleteMachine(id);
    } else {
      await deleteEquipment(id);
    }
    onBack();
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="self-start text-xs text-[var(--accent)]">
        {t("machinery.detail.backToList")}
      </button>

      <div className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm font-semibold text-[var(--ink)]">{record.name}</span>
          <MachineStatusBadge status={record.status} />
        </div>
        <p className="text-xs text-[var(--ink-2)]">
          {machine
            ? [
                machine.machine_type,
                machine.brand,
                machine.model,
                machine.year != null ? String(machine.year) : null,
                machine.license_plate,
              ]
                .filter(Boolean)
                .join(" · ")
            : [
                equipment!.equipment_type,
                equipment!.working_width_m != null ? `${equipment!.working_width_m} m` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
        {record.notes && <p className="text-xs text-[var(--ink-3)]">{record.notes}</p>}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="min-h-[36px] flex-1 text-xs"
            onClick={onEdit}
          >
            {t("machinery.detail.edit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[36px] flex-1 text-xs text-[var(--danger)]"
            onClick={() => void handleDelete()}
          >
            {kind === "machine"
              ? t("machinery.detail.deleteMachine")
              : t("machinery.detail.deleteEquipment")}
          </Button>
        </div>
      </div>

      <CounterSection
        kind={kind}
        id={id}
        counterValue={counterValue}
        counterLabel={counterLabel}
      />

      {machine && <FuelConsumptionSection machineId={machine.id} />}

      <MaintenanceSection kind={kind} id={id} currentCounter={counterValue} />

      <DocumentsSection kind={kind} id={id} />
    </div>
  );
}
