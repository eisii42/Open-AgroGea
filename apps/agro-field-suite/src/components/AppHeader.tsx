import {
  type AppView,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import {
  Building2,
  CalendarDays,
  LayoutDashboard,
  Map as MapIcon,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import agrogeaLogo from "../assets/agrogea-logo.png";
import { usePlatform } from "../hooks/usePlatform";
import { AccountMenu } from "./AccountMenu";
import { AddDataControl } from "./AddDataControl";
import { HeaderSearch } from "./HeaderSearch";
import { useDiagnostics } from "./help/useDiagnostics";
import { MobileAppMenu } from "./MobileAppMenu";
import { WeatherCard } from "../modules/weather/WeatherCard";

/**
 * Header della suite (Modulo UI §6): logo, azienda, campo "Cerca… Ctrl K",
 * viste, LED di stato sync (verde/ambra/rosso/grigio sull'outbox PGlite),
 * meteo, Aggiungi dati e menu account (tema, aiuto, profilo).
 * Barra fissa in alto; la mappa vive sotto e non viene mai rimontata.
 */

/**
 * Viste di primo livello dello switcher. Ogni vista ha il PROPRIO colore
 * (token `--view-*`): il bottone attivo si riempie di quel colore, così a
 * colpo d'occhio si capisce dove si è anche senza leggere l'etichetta.
 */
const VIEW_OPTIONS: {
  id: AppView;
  labelKey: string;
  titleKey: string;
  Icon: typeof MapIcon;
  color: string;
}[] = [
  {
    id: "map",
    labelKey: "appHeader.map",
    titleKey: "appHeader.mapView",
    Icon: MapIcon,
    color: "--view-map",
  },
  {
    id: "calendar",
    labelKey: "appHeader.calendar",
    titleKey: "appHeader.calendar",
    Icon: CalendarDays,
    color: "--view-calendar",
  },
  {
    id: "command-center",
    labelKey: "appHeader.commandCenter",
    titleKey: "appHeader.commandCenter",
    Icon: LayoutDashboard,
    color: "--view-command-center",
  },
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

export function AppHeader() {
  const { t } = useTranslation();
  const companies = useAgroStore((s) => s.companies);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const sync = useAgroStore((s) => s.sync);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const activeView = useAgroStore((s) => s.activeView);
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const flags = useSettingsStore((s) => s.dashboardLayout);

  const company = companies.find((a) => a.id === activeCompanyId);
  const led = syncLed(sync.state, sync.pendingCount, t);

  const { isMobile } = usePlatform();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const diagnostics = useDiagnostics();

  // Telefono: header essenziale. Le viste passano alla barra in basso
  // (MobileBottomNav), il resto (Aggiungi dati, tema, aiuto, profilo) al menu
  // "⋯". Il meteo invece resta in vista, qui: è la cosa più consultata.
  if (isMobile) {
    return (
      // Margine per la barra di stato/notch (Android edge-to-edge, iPhone):
      // con viewport-fit=cover l'header vi sale sotto; altrove vale 0.
      <header className="flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--panel)] pl-3 pr-1 pt-[env(safe-area-inset-top)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <img src={agrogeaLogo} alt="AgroGea" className="h-6 w-6 object-contain" />
        </span>
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          title={company?.business_name ?? undefined}
        >
          <Building2 size={15} className="shrink-0 text-[var(--ink-3)]" />
          <span className="truncate text-[15px] font-semibold">
            {company?.business_name ?? "-"}
          </span>
        </div>
        {flags.headerMeteoCard && <WeatherCard sheet />}
        {flags.headerSyncLed && (
          <button
            type="button"
            onClick={() => togglePanel("sync")}
            aria-label={t("nav.syncOpenQueue", { label: led.label })}
            title={led.label}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-2)] active:bg-[var(--panel-2)]"
          >
            {sync.state === "syncing" ? (
              <RefreshCw size={16} className="animate-spin text-[var(--ink-3)]" />
            ) : (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: led.color, boxShadow: `0 0 6px ${led.color}` }}
              />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label={t("mobileMenu.open")}
          aria-haspopup="dialog"
          aria-expanded={mobileMenuOpen}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-2)] active:bg-[var(--panel-2)]"
        >
          <MoreHorizontal size={22} />
          {diagnostics.count > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
              {diagnostics.count}
            </span>
          )}
        </button>
        <MobileAppMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
      </header>
    );
  }

  // Desktop: logo · azienda · Cerca · viste | sync · meteo · Aggiungi dati ·
  // account. Il tema, l'aiuto e il profilo stanno nel menu account (come nel
  // "⋯" del telefono); il Riquadro comandi ha il suo campo "Cerca… Ctrl K".
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--panel)] px-3 lg:gap-3">
      {/* Logo + brand */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent)] text-white">
          <img src={agrogeaLogo} alt="AgroGea" className="h-6 w-6 object-contain" />
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">
          AgroGea
        </span>
      </div>

      {/* Azienda attiva: una sola, nessun cambio possibile (display statico). */}
      <div
        className="flex min-h-[36px] min-w-0 shrink items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-2 text-left"
        title={company?.business_name ?? undefined}
      >
        <Building2 size={15} className="shrink-0 text-[var(--ink-3)]" />
        <span className="truncate text-sm font-medium">
          {company?.business_name ?? "-"}
        </span>
      </div>

      <HeaderSearch />

      {/* Switcher di vista (Modulo 1): Mappa ↔ Calendario ↔ Data Command
          Center. Cambiare vista nasconde la mappa (keep-alive) ma conserva il
          contesto aziendale. */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
        {VIEW_OPTIONS.map(({ id, labelKey, titleKey, Icon, color }) => {
          const active = activeView === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveView(id)}
              title={t(titleKey as never)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[var(--r-1)] px-2.5 text-xs font-medium transition-colors",
                active
                  ? "text-white shadow-[var(--sh-1)]"
                  : "hover:bg-[var(--panel)]",
              )}
              style={
                active
                  ? { background: `var(${color})` }
                  : { color: `var(${color})`, opacity: 0.75 }
              }
            >
              <Icon size={14} />
              {/* Etichette solo da 1280 px: sotto l'header sforava; restano
                  icona e tooltip. */}
              <span className="hidden xl:inline">{t(labelKey as never)}</span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2">
        {/* LED stato sync → apre la coda di sincronizzazione */}
        {flags.headerSyncLed && (
          <button
            type="button"
            onClick={() => togglePanel("sync")}
            className="flex h-9 items-center gap-1.5 rounded-[var(--r-2)] px-2 hover:bg-[var(--panel-2)]"
            title={t("nav.syncOpenQueue", { label: led.label })}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: led.color, boxShadow: `0 0 6px ${led.color}` }}
            />
            {sync.state === "syncing" ? (
              <RefreshCw size={13} className="animate-spin text-[var(--ink-3)]" />
            ) : (
              <span className="hidden text-xs text-[var(--ink-3)] xl:inline">
                {led.label}
              </span>
            )}
          </button>
        )}

        {/* Scheda meteo: condizioni del giorno + previsione (Open-Meteo). */}
        {flags.headerMeteoCard && <WeatherCard />}

        {/* Add Data globale: ingresso unico dei file esterni. */}
        {flags.headerAddData && <AddDataControl />}

        <AccountMenu />
      </div>
    </header>
  );
}
