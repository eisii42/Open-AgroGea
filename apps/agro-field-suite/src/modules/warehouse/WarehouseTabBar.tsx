import {
  type DashboardModuleId,
  type WarehouseTab,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Package, Tractor, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Barra delle sotto-schede del modulo Magazzino (0.3.0): Prodotti/Lotti · Mezzi.
 * Ogni scheda è governata dal proprio flag di dashboard (abilitabile in
 * Impostazioni, §6.1); con una sola scheda visibile la barra si nasconde. Il
 * Refill carburante NON è qui: è un pannello a sé, aperto solo dal FAB.
 */

const TABS: {
  id: WarehouseTab;
  labelKey: string;
  Icon: LucideIcon;
  flag: DashboardModuleId;
}[] = [
  { id: "products", labelKey: "warehouse.tabs.products", Icon: Package, flag: "panelMagazzino" },
  { id: "machines", labelKey: "warehouse.tabs.machines", Icon: Tractor, flag: "panelMezzi" },
];

export function WarehouseTabBar() {
  const { t } = useTranslation();
  const tab = useAgroStore((s) => s.warehouseTab);
  const setTab = useAgroStore((s) => s.setWarehouseTab);
  const flags = useSettingsStore((s) => s.dashboardLayout);
  const visible = TABS.filter((x) => flags[x.flag]);
  if (visible.length <= 1) return null;
  return (
    <div className="mb-3 flex gap-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-1">
      {visible.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => setTab(x.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] px-2 py-1.5 text-xs font-medium transition-colors",
            tab === x.id
              ? "bg-[var(--accent-l)] text-[var(--accent)]"
              : "text-[var(--ink-3)] hover:bg-[var(--panel)]",
          )}
        >
          <x.Icon size={14} />
          {t(x.labelKey as never)}
        </button>
      ))}
    </div>
  );
}
