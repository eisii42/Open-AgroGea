import { useAgroStore, useSettingsStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Settings,
  X,
} from "lucide-react";
import { useBackDismiss, useEscapeDismiss, useSheetDrag } from "@agrogea/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDataControl } from "./AddDataControl";
import { HelpMenu } from "./help/HelpMenu";
import { ThemePicker } from "./ThemePicker";

type MenuPage = "root" | "addData";

/**
 * Menu "⋯" dell'header su telefono: raccoglie ciò che sul desktop sta in fila
 * nell'header (Aggiungi dati, tema, aiuto, profilo) e che su 375 px o
 * spariva o si riduceva a icone da 32 px. Il meteo no: sta nell'header del
 * telefono, sempre in vista (WeatherCard `sheet`).
 *
 * Foglio dal basso, raggiungibile col pollice; le voci ricche (Aggiungi dati)
 * si aprono come pagina interna con "indietro", riusando i componenti del
 * desktop nella variante `inline`.
 *
 * Resta SEMPRE montato e si nasconde via transform: le finestre dell'Aiuto
 * (feedback, informazioni, diagnostica) vivono dentro `HelpMenu`, e smontarlo
 * alla chiusura del menu le chiuderebbe appena aperte.
 */
export function MobileAppMenu({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const flags = useSettingsStore((s) => s.dashboardLayout);
  const [page, setPage] = useState<MenuPage>("root");

  // Ogni apertura riparte dall'elenco principale.
  useEffect(() => {
    if (open) setPage("root");
  }, [open]);

  useEscapeDismiss(onClose, open);

  // Tasto indietro: da una pagina interna torna all'elenco, dall'elenco chiude.
  useBackDismiss(() => (page !== "root" ? setPage("root") : onClose()), open);

  // Trascinando giù maniglia o intestazione il menu si chiude, come gli altri fogli.
  const [dragOffset, setDragOffset] = useState(0);
  const startHeight = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag({
    enabled: open,
    getHeight: () => {
      startHeight.current = sheetRef.current?.getBoundingClientRect().height ?? 0;
      return startHeight.current;
    },
    onDrag: (height) => setDragOffset(Math.max(0, startHeight.current - height)),
    onRelease: (height, velocity) => {
      setDragOffset(0);
      if (startHeight.current - height > 80 || velocity > 0.5) onClose();
    },
  });

  const openProfile = () => {
    onClose();
    if (!useAgroStore.getState().openPanels.includes("profile")) {
      togglePanel("profile");
    }
  };

  const title =
    page === "addData" ? t("addDataControl.addData") : t("mobileMenu.title");

  return (
    <div
      className={cn("fixed inset-0 z-[70]", !open && "pointer-events-none")}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={title}
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]",
          !drag.dragging && "transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div
          {...drag.handlers}
          onClickCapture={(e) => {
            if (drag.consumeDrag()) e.stopPropagation();
          }}
          className="shrink-0 touch-none"
        >
        <div className="flex h-5 items-end justify-center">
          <span className="block h-1.5 w-10 rounded-full bg-[var(--line)]" />
        </div>
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
          {page !== "root" ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setPage("root")}
              aria-label={t("mobileMenu.back")}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-2)] active:bg-[var(--panel-2)]"
            >
              <ChevronLeft size={20} />
            </button>
          ) : (
            <span className="w-2" />
          )}
          <span className="flex-1 text-[15px] font-semibold">{title}</span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            aria-label={t("mobileMenu.close")}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] active:bg-[var(--panel-2)]"
          >
            <X size={18} />
          </button>
        </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2">
          {page === "addData" && <AddDataControl inline />}

          {/* Elenco principale: nascosto (non smontato) nelle pagine interne,
              perché contiene l'Aiuto con le sue finestre. */}
          <div className={cn("flex flex-col gap-3", page !== "root" && "hidden")}>
            {/* Il meteo non sta qui: è nell'header, sempre in vista. */}
            {flags.headerAddData && (
              <MenuSection>
                <MenuRow
                  icon={<Database size={18} />}
                  label={t("addDataControl.addData")}
                  onClick={() => setPage("addData")}
                  chevron
                />
              </MenuSection>
            )}

            <MenuSection title={t("mobileMenu.theme")}>
              <ThemePicker />
            </MenuSection>

            <MenuSection title={t("help.menu")}>
              <HelpMenu onItemSelected={onClose} />
            </MenuSection>

            <MenuSection>
              <MenuRow
                icon={<Settings size={18} />}
                label={t("commandPalette.actions.profileSettings")}
                onClick={openProfile}
                chevron
              />
            </MenuSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      {title && (
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {title}
        </p>
      )}
      {children}
    </section>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  chevron = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-[var(--r-2)] px-3 text-left text-[15px] text-[var(--ink-2)] active:bg-[var(--panel-2)]"
    >
      <span className="text-[var(--ink-3)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight size={16} className="text-[var(--ink-4)]" />}
    </button>
  );
}
