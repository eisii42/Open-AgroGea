import { type AppView, useAgroStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import {
  CalendarDays,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  NotebookPen,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type NavTarget = "map" | "calendar" | "command-center" | "logbook" | "modules";

/**
 * Barra di navigazione in basso su telefono, presente in TUTTE le viste (prima
 * esisteva solo sulla mappa, e da Calendario o Command Center non c'era modo di
 * aprire Quaderno o Moduli).
 *
 * Cinque destinazioni, raggiungibili col pollice: le tre viste (Mappa,
 * Calendario, Dashboard) più Quaderno e Moduli, che sono pannelli della mappa e
 * quindi riportano lì. Una sola voce è evidenziata alla volta.
 */
export function MobileBottomNav({
  modulesOpen,
  onModulesOpenChange,
}: {
  modulesOpen: boolean;
  onModulesOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const activeView = useAgroStore((s) => s.activeView);
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);

  const logbookOpen = activeView === "map" && openPanels.includes("quaderno");
  const current: NavTarget = modulesOpen
    ? "modules"
    : logbookOpen
      ? "logbook"
      : activeView;

  /** Chiude ciò che copre le viste: la pagina profilo e il foglio Moduli. */
  const clearOverlays = () => {
    onModulesOpenChange(false);
    if (useAgroStore.getState().openPanels.includes("profile")) {
      togglePanel("profile");
    }
  };

  const goToView = (view: AppView) => {
    clearOverlays();
    // "Mappa" mostra la mappa: il Quaderno ha la sua voce, quindi si chiude.
    if (view === "map" && logbookOpen) togglePanel("quaderno");
    setActiveView(view);
  };

  const toggleLogbook = () => {
    clearOverlays();
    // Secondo tocco sulla voce attiva = chiudi, come nelle altre app.
    if (logbookOpen) {
      togglePanel("quaderno");
      return;
    }
    setActiveView("map");
    if (!openPanels.includes("quaderno")) togglePanel("quaderno");
  };

  const toggleModules = () => {
    if (useAgroStore.getState().openPanels.includes("profile")) {
      togglePanel("profile");
    }
    onModulesOpenChange(!modulesOpen);
  };

  return (
    <nav
      aria-label={t("mobileNav.label")}
      className="relative z-[45] flex shrink-0 items-stretch border-t border-[var(--line)] bg-[var(--panel)] pb-[env(safe-area-inset-bottom)]"
    >
      <NavButton
        label={t("appHeader.map")}
        icon={<MapIcon size={21} />}
        active={current === "map"}
        onClick={() => goToView("map")}
      />
      <NavButton
        label={t("appHeader.calendar")}
        icon={<CalendarDays size={21} />}
        active={current === "calendar"}
        onClick={() => goToView("calendar")}
      />
      <NavButton
        label={t("mobileNav.dashboard")}
        icon={<LayoutDashboard size={21} />}
        active={current === "command-center"}
        onClick={() => goToView("command-center")}
      />
      <NavButton
        label={t("mobileNav.logbook")}
        icon={<NotebookPen size={21} />}
        active={current === "logbook"}
        onClick={toggleLogbook}
      />
      <NavButton
        label={t("mobileNav.modules")}
        icon={<Menu size={21} />}
        active={current === "modules"}
        onClick={toggleModules}
      />
    </nav>
  );
}

function NavButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
        active ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
      )}
    >
      {/* Pillola dietro l'icona attiva: si vede dove si è anche senza leggere. */}
      <span
        className={cn(
          "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
          active && "bg-[var(--accent-l)]",
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
