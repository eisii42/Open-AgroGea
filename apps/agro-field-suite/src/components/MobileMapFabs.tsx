import { useAgroStore, useSettingsStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Fuel, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIndexTimeline } from "../modules/soil/index-timeline-store";

/**
 * Azioni rapide di campo sul telefono, in basso a destra dove arriva il
 * pollice: Rilievo GPS (pulsante principale, pieno) e, se abilitato, il
 * rifornimento carburante. Sul desktop le stesse azioni stanno nella colonna
 * di sinistra.
 *
 * Salgono sopra il time slider degli indici quando è aperto, così non ci
 * finiscono sotto.
 */
export function MobileMapFabs() {
  const { t } = useTranslation();
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const openRefillPanel = useAgroStore((s) => s.openRefillPanel);
  const refillEnabled = useSettingsStore((s) => s.dashboardLayout.panelRefill);
  const timeline = useIndexTimeline();
  const timelineOpen = timeline.scenes.length > 0 && !timeline.hidden;
  const scoutingOn = openPanels.includes("scouting");

  return (
    <div
      className={cn(
        "absolute right-3 z-30 flex flex-col items-center gap-3",
        timelineOpen ? "bottom-[8rem]" : "bottom-9",
      )}
    >
      {refillEnabled && (
        <button
          type="button"
          onClick={() => openRefillPanel({ quickRefill: true })}
          title={t("machineryRefill.quickAction")}
          aria-label={t("machineryRefill.quickAction")}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] shadow-[var(--sh-pop)] active:bg-[var(--panel-2)]"
        >
          <Fuel size={20} />
        </button>
      )}
      <button
        type="button"
        onClick={() => togglePanel("scouting")}
        title={t("fieldDashboard.scoutingTitle")}
        aria-label={t("fieldDashboard.scoutingTitle")}
        aria-pressed={scoutingOn}
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full shadow-[var(--sh-pop)]",
          scoutingOn
            ? "bg-[var(--panel)] text-[var(--accent)] ring-2 ring-[var(--accent)]"
            : "bg-[var(--accent)] text-white active:opacity-90",
        )}
      >
        <MapPin size={24} />
      </button>
    </div>
  );
}
