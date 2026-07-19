import { type Equipment, type Machine, useAgroStore } from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button } from "@geolibre/ui";
import { FileUp, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { WarehouseTabBar } from "../warehouse/WarehouseTabBar";
import { AttentionPanel } from "./AttentionPanel";
import { buildAttentionEntries, type AttentionEntry } from "./machinery-view";
import { MachineDetail } from "./MachineDetail";
import { MachineForm } from "./MachineForm";
import { MachineImportDialog } from "./MachineImportDialog";
import { MachineStatusBadge } from "./StatusBadge";

/**
 * Sotto-scheda "Mezzi" del modulo Magazzino (0.3.0): anagrafica mezzi/attrezzi,
 * contatori ore/usura, stato, documenti, scadenziario manutenzione, consumo
 * l/h, cruscotto "Richiede attenzione" (§5.8) e import CSV (§5.9). Vista a
 * stati (elenco → form crea/modifica → dettaglio → import), come le altre
 * sotto-schede del Magazzino: un'unica FieldSheet il cui titolo/larghezza
 * cambiano con la vista active.
 */

type View =
  | { kind: "list" }
  | { kind: "newMachine" }
  | { kind: "newEquipment" }
  | { kind: "editMachine"; id: string }
  | { kind: "editEquipment"; id: string }
  | { kind: "machine"; id: string }
  | { kind: "equipment"; id: string }
  | { kind: "import" };

const WIDE_KINDS = new Set<View["kind"]>([
  "newMachine",
  "newEquipment",
  "editMachine",
  "editEquipment",
  "import",
]);

export function MachineryTab({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const machines = useAgroStore((s) => s.machines);
  const equipment = useAgroStore((s) => s.equipment);
  const maintenanceSchedules = useAgroStore((s) => s.maintenanceSchedules);
  const machineDocuments = useAgroStore((s) => s.machineDocuments);
  const fuelRefills = useAgroStore((s) => s.fuelRefills);

  const [view, setView] = useState<View>({ kind: "list" });
  const [showDecommissioned, setShowDecommissioned] = useState(false);

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  const attentionEntries = useMemo(
    () =>
      buildAttentionEntries({
        machines,
        equipment,
        schedules: maintenanceSchedules,
        documents: machineDocuments,
        fuelRefills,
      }),
    [machines, equipment, maintenanceSchedules, machineDocuments, fuelRefills],
  );

  const visibleMachines = useMemo(
    () =>
      machines.filter((m) => showDecommissioned || m.status !== "decommissioned"),
    [machines, showDecommissioned],
  );
  const visibleEquipment = useMemo(
    () =>
      equipment.filter((e) => showDecommissioned || e.status !== "decommissioned"),
    [equipment, showDecommissioned],
  );

  function handleAttentionSelect(entry: AttentionEntry) {
    if (entry.machineId) setView({ kind: "machine", id: entry.machineId });
    else if (entry.equipmentId) setView({ kind: "equipment", id: entry.equipmentId });
  }

  const title = (() => {
    switch (view.kind) {
      case "list":
        return t("warehouse.tabs.machines");
      case "newMachine":
        return t("machinery.newMachine");
      case "newEquipment":
        return t("machinery.newEquipment");
      case "editMachine":
        return machineById.get(view.id)?.name ?? t("machinery.editMachine");
      case "editEquipment":
        return equipmentById.get(view.id)?.name ?? t("machinery.editEquipment");
      case "machine":
        return machineById.get(view.id)?.name ?? t("warehouse.tabs.machines");
      case "equipment":
        return equipmentById.get(view.id)?.name ?? t("warehouse.tabs.machines");
      case "import":
        return t("machinery.import.title");
    }
  })();

  return (
    <FieldSheet
      wide={WIDE_KINDS.has(view.kind)}
      title={title}
      onClose={onClose}
    >
      {view.kind === "list" && <WarehouseTabBar />}

      {view.kind === "list" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-[var(--touch-min)] flex-1 gap-1"
              onClick={() => setView({ kind: "newMachine" })}
            >
              <Plus size={16} /> {t("machinery.newMachine")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[var(--touch-min)] flex-1 gap-1"
              onClick={() => setView({ kind: "newEquipment" })}
            >
              <Plus size={16} /> {t("machinery.newEquipment")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[var(--touch-min)] gap-1"
              onClick={() => setView({ kind: "import" })}
            >
              <FileUp size={16} /> {t("machinery.importCsv")}
            </Button>
          </div>

          <AttentionPanel entries={attentionEntries} onSelect={handleAttentionSelect} />

          <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={showDecommissioned}
              onChange={(e) => setShowDecommissioned(e.target.checked)}
            />
            {t("machinery.showDecommissioned")}
          </label>

          <MachineListSection
            titleKey="machinery.list.machinesSection"
            items={visibleMachines}
            emptyKey="machinery.noMachines"
            counterOf={(m) => Number((m as Machine).hour_counter)}
            typeOf={(m) => (m as Machine).machine_type}
            onSelect={(id) => setView({ kind: "machine", id })}
          />
          <MachineListSection
            titleKey="machinery.list.equipmentSection"
            items={visibleEquipment}
            emptyKey="machinery.noEquipment"
            counterOf={(e) => Number((e as Equipment).usage_counter)}
            typeOf={(e) => (e as Equipment).equipment_type}
            onSelect={(id) => setView({ kind: "equipment", id })}
          />
        </div>
      )}

      {view.kind === "newMachine" && (
        <MachineForm
          kind="machine"
          onCancel={() => setView({ kind: "list" })}
          onSaved={(id) => setView({ kind: "machine", id })}
        />
      )}
      {view.kind === "newEquipment" && (
        <MachineForm
          kind="equipment"
          onCancel={() => setView({ kind: "list" })}
          onSaved={(id) => setView({ kind: "equipment", id })}
        />
      )}
      {view.kind === "editMachine" && (
        <MachineForm
          key={view.id}
          kind="machine"
          existing={machineById.get(view.id) ?? null}
          onCancel={() => setView({ kind: "machine", id: view.id })}
          onSaved={(id) => setView({ kind: "machine", id })}
        />
      )}
      {view.kind === "editEquipment" && (
        <MachineForm
          key={view.id}
          kind="equipment"
          existing={equipmentById.get(view.id) ?? null}
          onCancel={() => setView({ kind: "equipment", id: view.id })}
          onSaved={(id) => setView({ kind: "equipment", id })}
        />
      )}

      {view.kind === "machine" && (
        <MachineDetail
          kind="machine"
          id={view.id}
          onBack={() => setView({ kind: "list" })}
          onEdit={() => setView({ kind: "editMachine", id: view.id })}
        />
      )}
      {view.kind === "equipment" && (
        <MachineDetail
          kind="equipment"
          id={view.id}
          onBack={() => setView({ kind: "list" })}
          onEdit={() => setView({ kind: "editEquipment", id: view.id })}
        />
      )}

      {view.kind === "import" && (
        <MachineImportDialog onClose={() => setView({ kind: "list" })} />
      )}
    </FieldSheet>
  );
}

/** Sezione elenco (mezzi o attrezzi): riga cliccabile con badge stato + contatore. */
function MachineListSection({
  titleKey,
  items,
  emptyKey,
  counterOf,
  typeOf,
  onSelect,
}: {
  titleKey: string;
  items: (Machine | Equipment)[];
  emptyKey: string;
  counterOf: (item: Machine | Equipment) => number;
  typeOf: (item: Machine | Equipment) => string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t(titleKey as never)}
      </p>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--ink-3)]">{t(emptyKey as never)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="flex w-full items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2 text-left hover:bg-[var(--panel-2)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.name}</span>
                  <span className="block truncate text-xs text-[var(--ink-3)]">
                    {typeOf(item) ? `${typeOf(item)} · ` : ""}
                    <strong className="agro-num">
                      {counterOf(item).toLocaleString("it-IT")} h
                    </strong>
                  </span>
                </span>
                <MachineStatusBadge status={item.status} />
                <span className="text-[var(--ink-4)]">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
