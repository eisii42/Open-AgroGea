import { useAgroStore, useSettingsStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Fuel, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Azioni rapide di campo sul desktop, in basso a destra come sul telefono
 * (`MobileMapFabs`): rifornimento carburante (se abilitato) e Rilievo GPS,
 * pulsante principale con etichetta. Prima stavano nella colonna di sinistra,
 * mescolate ai controlli di mappa.
 *
 * Non si posiziona da solo: sta in fondo alla pila in basso a destra di
 * FieldDashboard (feed attività · legende · azioni), che si sposta a fianco
 * del pannello laterale quando è aperto.
 */
export function DesktopMapFabs() {
  const { t } = useTranslation();
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const openRefillPanel = useAgroStore((s) => s.openRefillPanel);
  const refillEnabled = useSettingsStore((s) => s.dashboardLayout.panelRefill);
  const scoutingOn = openPanels.includes("scouting");

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      {refillEnabled && (
        <button
          type="button"
          onClick={() => openRefillPanel({ quickRefill: true })}
          title={t("machineryRefill.quickAction")}
          aria-label={t("machineryRefill.quickAction")}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] shadow-[var(--sh-pop)] hover:bg-[var(--panel-2)]"
        >
          <Fuel size={18} />
        </button>
      )}
      <button
        type="button"
        onClick={() => togglePanel("scouting")}
        title={t("fieldDashboard.scoutingTitle")}
        aria-pressed={scoutingOn}
        className={cn(
          "flex h-11 items-center gap-2 rounded-full pl-3.5 pr-4 text-sm font-medium shadow-[var(--sh-pop)]",
          scoutingOn
            ? "bg-[var(--panel)] text-[var(--accent)] ring-2 ring-inset ring-[var(--accent)]"
            : "bg-[var(--accent)] text-white hover:opacity-90",
        )}
      >
        <MapPin size={18} />
        {t("fieldDashboard.scoutingShort")}
      </button>
    </div>
  );
}
