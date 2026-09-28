import { centroid, useAgroStore } from "@agrogea/core";
import { useEscapeDismiss } from "@agrogea/ui";
import { BottomSheet } from "../../components/BottomSheet";
import { cn } from "@geolibre/ui";
import {
  CloudSun,
  Droplets,
  MapPin,
  RadioTower,
  RefreshCw,
  Settings,
  Wind,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { openExternal } from "../../components/help/helpActions";
import {
  type PrevisioneDashboard,
  WeatherSyncService,
} from "../../lib/WeatherSyncService";
import { weatherCodeInfo } from "../../lib/weather-codes";

/**
 * Scheda meteo dell'header (di fianco allo switcher company): condizioni
 * correnti + previsione di oggi e dei 4 giorni successivi, con icone.
 *
 * Sorgente: `WeatherSyncService.previsioneDashboard` (Open-Meteo, endpoint
 * daily/current), localizzata sul centroid dell'azienda — la sede se nota,
 * altrimenti il primo plot con geometria. In fondo la scheda dichiara servizio,
 * coordinate e loro origine, e l'eventuale centralina aziendale. Si update all'avvio dell'app
 * (montaggio) e ogni ora (lucchetto orario condiviso con il resto del meteo).
 */

/** Punto su cui è localizzato il meteo e da dove viene (mostrato nella scheda). */
interface WeatherLocation {
  /** [lon, lat] */
  coordinates: [number, number];
  /** Sede aziendale, o centroide del primo appezzamento con geometria. */
  origin: "company" | "plot";
  plotName?: string;
}

/** Coordinate dell'azienda attiva, o null se non localizzabile. */
function useCompanyCoordinates(): WeatherLocation | null {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const companies = useAgroStore((s) => s.companies);
  const plots = useAgroStore((s) => s.plots);

  return useMemo(() => {
    const company = companies.find((a) => a.id === activeCompanyId);
    const sede = company?.centroid?.coordinates;
    if (sede && sede.length >= 2) {
      return { coordinates: [sede[0], sede[1]], origin: "company" };
    }
    const withGeometry = plots.find((a) => a.geometry);
    if (withGeometry) {
      return {
        coordinates: centroid(withGeometry.geometry),
        origin: "plot",
        plotName: withGeometry.user_plot_name,
      };
    }
    return null;
  }, [activeCompanyId, companies, plots]);
}

const OPEN_METEO_URL = "https://open-meteo.com/";

/**
 * Foglio del telefono aperto dall'header: si monta nell'area sopra la barra in
 * basso (`#agro-sheet-host`, App.tsx), come il foglio Moduli. Dentro l'header
 * resterebbe coperto dalla barra.
 */
function SheetPortal({ children }: { children: ReactNode }) {
  const host =
    typeof document === "undefined"
      ? null
      : (document.getElementById("agro-sheet-host") ?? document.body);
  return host ? createPortal(children, host) : null;
}

/** Coordinata in gradi decimali con emisfero (4 decimali ≈ 11 m). */
function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

function gradi(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}°`;
}

/** Etichetta breve del giorno: "Oggi" per l'indice 0, altrimenti il weekday. */
function dayLabel(
  dataIso: string,
  index: number,
  locale: string,
  todayLabel: string,
): string {
  if (index === 0) return todayLabel;
  const d = new Date(`${dataIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dataIso;
  return d.toLocaleDateString(locale, { weekday: "short" });
}

export function WeatherCard({
  inline = false,
  sheet = false,
  onNavigate,
}: {
  /**
   * true → telefono: chip grande nell'header (temperatura e pioggia di oggi)
   * e, al tocco, la scheda completa in un foglio dal basso. Il meteo è la
   * cosa che l'agricoltore guarda più spesso: sta sempre in vista, non dentro
   * al menu "⋯".
   */
  sheet?: boolean;
  /**
   * true → solo il contenuto della scheda, sempre aperto e senza chip (da
   * incorporare in un altro contenitore). Il desktop usa chip + popover
   * (default), il telefono chip + foglio (`sheet`).
   */
  inline?: boolean;
  /** Chiamato quando la scheda porta altrove (configurazione centralina). */
  onNavigate?: () => void;
} = {}) {
  const { t, i18n } = useTranslation();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const weatherConfig = useAgroStore((s) => s.weatherConfig);
  const location = useCompanyCoordinates();
  const coordinate = location?.coordinates ?? null;

  const [previsione, setPrevisione] = useState<PrevisioneDashboard | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "errore">("idle");
  const [aperto, setAperto] = useState(inline);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (force: boolean) => {
      if (!activeCompanyId || !coordinate) return;
      setStatus("loading");
      try {
        const data = await WeatherSyncService.previsioneDashboard({
          companyId: activeCompanyId,
          lon: coordinate[0],
          lat: coordinate[1],
          force,
        });
        setPrevisione(data);
        setStatus("idle");
      } catch {
        // Offline o fetch fallito: si conserva l'ultima previsione available.
        setStatus("errore");
      }
    },
    [activeCompanyId, coordinate],
  );

  // Cambio company → si azzera la scheda (i dati appartengono a un'altra sede).
  useEffect(() => {
    setPrevisione(null);
  }, [activeCompanyId]);

  // Avvio app / coordinate disponibili → caricamento (cache oraria a valle).
  useEffect(() => {
    void load(false);
  }, [load]);

  // Aggiornamento automatico orario (timeout come nel resto del module meteo).
  useEffect(() => {
    const id = window.setInterval(() => void load(true), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [load]);

  // Chiusura del popover su click esterno / Esc.
  useEffect(() => {
    if (!aperto || inline || sheet) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setAperto(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [aperto, inline, sheet]);
  // Il foglio del telefono gestisce Esc da sé (BottomSheet).
  useEscapeDismiss(() => setAperto(false), aperto && !inline && !sheet);

  // Senza coordinate non c'è nulla da localizzare: scheda nascosta (nel menu
  // mobile si dice perché, invece di lasciare una pagina vuota).
  if (!activeCompanyId || !location) {
    const noLocation = (
      <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-3 text-sm text-[var(--ink-3)]">
        {t("weatherCard.noLocation")}
      </p>
    );
    // Telefono: il chip resta in vista anche senza posizione e, toccato,
    // spiega cosa serve (invece di sparire senza motivo).
    if (sheet && activeCompanyId) {
      return (
        <>
          <button
            type="button"
            onClick={() => setAperto(true)}
            aria-label={t("weatherCard.title")}
            aria-haspopup="dialog"
            aria-expanded={aperto}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--panel-2)] px-2.5 text-[var(--ink-3)] active:bg-[var(--panel-3)]"
          >
            <CloudSun size={20} className="shrink-0" />
            <span className="agro-num text-[16px] font-semibold">—°</span>
          </button>
          <SheetPortal>
            <BottomSheet
              open={aperto}
              onClose={() => setAperto(false)}
              title={t("weatherCard.title")}
            >
              <div className="px-4 pb-4 pt-2">{noLocation}</div>
            </BottomSheet>
          </SheetPortal>
        </>
      );
    }
    return inline ? noLocation : null;
  }

  const current = previsione?.current;
  const currentInfo = weatherCodeInfo(current?.weatherCode);
  const CurrentIcon = currentInfo.Icon;

  const todayRain = previsione?.days?.[0]?.pioggiaMm ?? null;

  const body = (
    <>
      {/* Intestazione: stato + update */}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {currentInfo.label}
        </p>
        <button
          type="button"
          onClick={() => void load(true)}
          title={t("weatherCard.refreshNow")}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
        >
          <RefreshCw
            size={13}
            className={cn(status === "loading" && "animate-spin")}
          />
        </button>
      </div>

      {status === "errore" && !previsione ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
          {t("weatherCard.unavailable")}
        </p>
      ) : (
        <>
          {/* Condizioni correnti */}
          <div className="flex items-center gap-3">
            <CurrentIcon size={40} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <p className="agro-num text-[28px] font-semibold leading-none tabular-nums">
                {gradi(current?.temperatura)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--ink-3)]">
                <span className="flex items-center gap-1">
                  <Droplets size={12} />
                  {current?.umidita == null
                    ? "—"
                    : `${Math.round(current.umidita)}%`}
                </span>
                <span className="flex items-center gap-1">
                  <Wind size={12} />
                  {current?.vento == null
                    ? "—"
                    : `${Math.round(current.vento)} km/h`}
                </span>
                <span className="flex items-center gap-1">
                  <Droplets size={12} className="text-[var(--accent)]" />
                  {current?.rain == null
                    ? "—"
                    : `${current.rain.toFixed(1)} mm`}
                </span>
              </div>
            </div>
          </div>

          {/* Previsione giornaliera (oggi + successivi) */}
          <div className="mt-3 grid grid-cols-5 gap-1 border-t border-[var(--line)] pt-2.5">
            {(previsione?.days ?? []).map((g, i) => {
              const info = weatherCodeInfo(g.weatherCode);
              const Icona = info.Icon;
              return (
                <div
                  key={g.data}
                  className="flex flex-col items-center gap-1"
                  title={`${info.label}${
                    g.pioggiaMm != null
                      ? ` · ${g.pioggiaMm.toFixed(1)} mm`
                      : ""
                  }`}
                >
                  <span className="text-[11px] font-medium capitalize text-[var(--ink-3)]">
                    {dayLabel(g.data, i, i18n.language, t("weatherCard.today"))}
                  </span>
                  <Icona size={20} className="text-[var(--ink-2)]" />
                  <span className="agro-num text-xs font-semibold tabular-nums">
                    {gradi(g.tMax)}
                  </span>
                  <span className="agro-num text-[11px] tabular-nums text-[var(--ink-4)]">
                    {gradi(g.tMin)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Provenienza: servizio, punto localizzato, centralina aziendale. */}
      <WeatherSourceInfo
        location={location}
        stationModel={
          weatherConfig?.data_source === "private_station"
            ? (weatherConfig.station_model ?? "")
            : null
        }
        stationDeviceId={weatherConfig?.station_device_id ?? null}
        onConfigure={() => {
          if (!inline) setAperto(false);
          onNavigate?.();
        }}
      />
    </>
  );

  return (
    // `relative` solo per il popover desktop: col foglio del telefono farebbe da
    // riferimento al foglio stesso, che resterebbe chiuso dentro al chip.
    <div className={inline || sheet ? undefined : "relative"} ref={cardRef}>
      {/* Chip compatto nell'header */}
      {!inline && sheet && (
        <button
          type="button"
          onClick={() => setAperto(true)}
          aria-label={`${t("weatherCard.title")}: ${currentInfo.label}`}
          aria-haspopup="dialog"
          aria-expanded={aperto}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--panel-2)] px-2.5 active:bg-[var(--panel-3)]"
        >
          <CurrentIcon size={20} className="shrink-0 text-[var(--accent)]" />
          <span className="agro-num text-[16px] font-semibold tabular-nums">
            {status === "loading" && !previsione ? "…" : gradi(current?.temperatura)}
          </span>
          {todayRain != null && todayRain >= 0.1 && (
            <span className="agro-num flex items-center gap-0.5 text-[12px] font-medium tabular-nums text-[#0284c7]">
              <Droplets size={12} />
              {todayRain.toFixed(1)}
            </span>
          )}
        </button>
      )}
      {!inline && !sheet && (
        <button
          type="button"
          onClick={() => setAperto((v) => !v)}
          title={t("weatherCard.title")}
          className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-2 text-left hover:bg-[var(--panel-2)]"
        >
          <CurrentIcon size={17} className="shrink-0 text-[var(--accent)]" />
          <span className="agro-num text-sm font-medium tabular-nums">
            {status === "loading" && !previsione ? "…" : gradi(current?.temperatura)}
          </span>
        </button>
      )}

      {sheet ? (
        <SheetPortal>
          <BottomSheet
            open={aperto}
            onClose={() => setAperto(false)}
            title={t("weatherCard.title")}
          >
            <div className="px-4 pb-4 pt-2">{body}</div>
          </BottomSheet>
        </SheetPortal>
      ) : (
        aperto && (
          <div
            className={
              inline
                ? undefined
                : "absolute right-0 top-11 z-50 w-[300px] overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-pop)]"
            }
          >
            {body}
          </div>
        )
      )}
    </div>
  );
}

/**
 * Da dove arriva il meteo mostrato: servizio (Open-Meteo, con l'attribuzione
 * che la sua licenza CC BY 4.0 richiede), coordinate del punto interrogato e
 * loro origine. Se l'azienda ha una centralina configurata la si cita: le sue
 * letture alimentano i modelli DSS, mentre la previsione a 5 giorni resta di
 * Open-Meteo (una centralina misura, non prevede). Il pulsante porta alla
 * configurazione della fonte meteo, dove si imposta la centralina.
 */
function WeatherSourceInfo({
  location,
  stationModel,
  stationDeviceId,
  onConfigure,
}: {
  location: WeatherLocation;
  /** Modello della centralina se è la fonte attiva, altrimenti null. */
  stationModel: string | null;
  stationDeviceId: string | null;
  onConfigure: () => void;
}) {
  const { t } = useTranslation();
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const [lon, lat] = location.coordinates;

  const configure = () => {
    onConfigure();
    // Il pannello vive nella vista mappa: dal Calendario o dal Command Center
    // si torna lì, altrimenti si aprirebbe nella vista nascosta.
    setActiveView("map");
    if (!useAgroStore.getState().openPanels.includes("impostazioni")) {
      togglePanel("impostazioni");
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-1 border-t border-[var(--line)] pt-2 text-[11px] leading-snug text-[var(--ink-4)]">
      <p>
        {t("weatherCard.source")}{" "}
        <button
          type="button"
          onClick={() => void openExternal(OPEN_METEO_URL)}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Open-Meteo.com
        </button>
      </p>
      <p className="flex items-start gap-1">
        <MapPin size={11} className="mt-[1px] shrink-0" />
        <span>
          <span className="agro-num tabular-nums">
            {formatCoordinate(lat, "N", "S")}, {formatCoordinate(lon, "E", "W")}
          </span>{" "}
          ·{" "}
          {location.origin === "company"
            ? t("weatherCard.originCompany")
            : t("weatherCard.originPlot", { name: location.plotName ?? "—" })}
        </span>
      </p>
      {stationModel !== null && (
        <p className="flex items-start gap-1">
          <RadioTower size={11} className="mt-[1px] shrink-0" />
          <span>
            {t("weatherCard.station", {
              model: stationModel || "—",
              device: stationDeviceId || "—",
            })}{" "}
            {t("weatherCard.stationNote")}
          </span>
        </p>
      )}
      <button
        type="button"
        onClick={configure}
        className="mt-0.5 flex items-center gap-1 self-start text-[var(--accent)] underline-offset-2 hover:underline"
      >
        <Settings size={11} />
        {stationModel !== null
          ? t("weatherCard.configureStation")
          : t("weatherCard.addStation")}
      </button>
    </div>
  );
}
