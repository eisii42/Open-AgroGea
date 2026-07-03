import {
  type AgroTheme,
  controlPlane,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import {
  Building2,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Moon,
  RefreshCw,
  Settings,
  Sprout,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AddDataControl } from "./AddDataControl";
import { HelpMenu } from "./help/HelpMenu";
import { MeteoCard } from "./MeteoCard";

/**
 * Header della suite (Modulo UI §6): logo, switcher azienda, LED di stato sync
 * (verde/ambra/rosso/grigio sull'outbox PGlite), selettore tema e menu profilo.
 * Barra fissa in alto; la mappa vive sotto e non viene mai rimontata.
 */

const THEME_OPTIONS: { id: AgroTheme; labelKey: string; Icon: typeof Sun }[] = [
  { id: "light", labelKey: "nav.themeLight", Icon: Sun },
  { id: "dark", labelKey: "nav.themeDark", Icon: Moon },
  { id: "green", labelKey: "nav.themeGreen", Icon: Sprout },
];

function syncLed(
  state: string,
  pending: number,
  t: TFunction,
): { color: string; label: string } {
  if (state === "error") return { color: "var(--danger)", label: t("nav.syncError") };
  if (state === "offline") return { color: "var(--ink-4)", label: t("nav.syncOffline") };
  if (state === "syncing") return { color: "var(--warn)", label: t("nav.syncing") };
  if (pending > 0) return { color: "var(--warn)", label: t("nav.syncQueued", { count: pending }) };
  return { color: "var(--ok)", label: t("nav.synced") };
}

export function AppHeader({
  onOpenCommandPalette,
}: {
  /**
   * Apre la Command Palette globale (gestita dalla FieldDashboard). Assente nel
   * Data Command Center, dove la palette mappa-centrica non è disponibile.
   */
  onOpenCommandPalette?: () => void;
}) {
  const { t } = useTranslation();
  const aziende = useAgroStore((s) => s.aziende);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const sync = useAgroStore((s) => s.sync);
  const theme = useAgroStore((s) => s.theme);
  const setTheme = useAgroStore((s) => s.setTheme);
  const endSession = useAgroStore((s) => s.endSession);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const activeView = useAgroStore((s) => s.activeView);
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const flags = useSettingsStore((s) => s.dashboardLayout);

  const azienda = aziende.find((a) => a.id === aziendaAttivaId);
  const led = syncLed(sync.state, sync.pendingCount, t);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  async function logout() {
    setMenuOpen(false);
    try {
      await controlPlane().signOut?.();
    } catch {
      /* offline o senza control plane: esci comunque dalla sessione locale */
    }
    endSession();
  }

  return (
    <header className="flex h-[56px] shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-3">
      {/* Logo + brand */}
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <Sprout size={18} />
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
          AgroGea
        </span>
      </div>

      {/* Indicatore azienda: una sola azienda attiva, nessun cambio possibile.
          Display statico (non più un pulsante): mostra "-" finché il nome non è
          impostato, poi il nome dell'azienda. */}
      <div
        className="flex min-h-[36px] min-w-0 items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-2 text-left"
        title={azienda?.business_name ?? undefined}
      >
        <Building2 size={15} className="shrink-0 text-[var(--ink-3)]" />
        <span className="truncate text-sm font-medium">
          {azienda?.business_name ?? "-"}
        </span>
      </div>

      {/* Add Data globale (GeoLibre 1.2): ingresso unico dei file esterni. */}
      {flags.headerAddData && <AddDataControl />}

      {/* Scheda meteo: condizioni del giorno + previsione 4 giorni (Open-Meteo). */}
      {flags.headerMeteoCard && <MeteoCard />}

      {/* Switcher di vista (Modulo 1): Mappa ↔ Data Command Center. Cambiare
          vista smonta/rimonta la mappa ma conserva il contesto aziendale. */}
      <div className="ml-2 flex items-center gap-0.5 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
        <button
          type="button"
          onClick={() => setActiveView("map")}
          title={t("appHeader.mapView")}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-[var(--r-1)] px-2.5 text-xs font-medium",
            activeView === "map"
              ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
              : "text-[var(--ink-3)]",
          )}
        >
          <MapIcon size={14} />
          <span className="hidden md:inline">{t("appHeader.map")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveView("command-center")}
          title={t("appHeader.commandCenter")}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-[var(--r-1)] px-2.5 text-xs font-medium",
            activeView === "command-center"
              ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
              : "text-[var(--ink-3)]",
          )}
        >
          <LayoutDashboard size={14} />
          <span className="hidden md:inline">{t("appHeader.commandCenter")}</span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* LED stato sync → apre la coda di sincronizzazione */}
        {flags.headerSyncLed && (
          <button
            type="button"
            onClick={() => togglePanel("sync")}
            className="flex items-center gap-1.5 rounded-[var(--r-2)] px-2 py-1.5 hover:bg-[var(--panel-2)]"
            title={t("nav.syncOpenQueue", { label: led.label })}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: led.color, boxShadow: `0 0 6px ${led.color}` }}
            />
            {sync.state === "syncing" ? (
              <RefreshCw size={13} className="animate-spin text-[var(--ink-3)]" />
            ) : (
              <span className="hidden text-xs text-[var(--ink-3)] md:inline">
                {led.label}
              </span>
            )}
          </button>
        )}

        {/* Selettore tema */}
        <div className="flex items-center gap-0.5 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
          {THEME_OPTIONS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              title={t("nav.themeTooltip", { name: t(labelKey as never) })}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[var(--r-1)]",
                theme === id
                  ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
                  : "text-[var(--ink-3)]",
              )}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>

        {/* Menu di Aiuto: Command Palette, scorciatoie, diagnostica, feedback,
            aggiornamenti, informazioni. Accanto al menu profilo. */}
        <HelpMenu onOpenCommandPalette={onOpenCommandPalette ?? (() => {})} />

        {/* Menu profilo */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--ink-2)] hover:bg-[var(--panel-3)]"
            title={t("nav.profile")}
          >
            <User size={17} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--sh-pop)]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (!useAgroStore.getState().openPanels.includes("profilo")) {
                    togglePanel("profilo");
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]"
              >
                <Settings size={15} className="text-[var(--ink-3)]" />
                {t("commandPalette.actions.profileSettings")}
              </button>
              <div className="my-1 border-t border-[var(--line)]" />
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-l)]"
              >
                <LogOut size={15} />
                {t("nav.logout")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
