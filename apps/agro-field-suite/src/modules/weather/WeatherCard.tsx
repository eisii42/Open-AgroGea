import { centroid, useAgroStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Droplets, RefreshCw, Wind } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
 * altrimenti il primo plot con geometria. Si update all'avvio dell'app
 * (montaggio) e ogni ora (lucchetto orario condiviso con il resto del meteo).
 */

/** Coordinate [lon, lat] dell'azienda attiva, o null se non localizzabile. */
function useCompanyCoordinates(): [number, number] | null {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const companies = useAgroStore((s) => s.companies);
  const plots = useAgroStore((s) => s.plots);

  return useMemo(() => {
    const company = companies.find((a) => a.id === activeCompanyId);
    const sede = company?.centroid?.coordinates;
    if (sede && sede.length >= 2) return [sede[0], sede[1]];
    const withGeometry = plots.find((a) => a.geometry);
    if (withGeometry) return centroid(withGeometry.geometry);
    return null;
  }, [activeCompanyId, companies, plots]);
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

export function WeatherCard() {
  const { t, i18n } = useTranslation();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const coordinate = useCompanyCoordinates();

  const [previsione, setPrevisione] = useState<PrevisioneDashboard | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "errore">("idle");
  const [aperto, setAperto] = useState(false);
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
    if (!aperto) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setAperto(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setAperto(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [aperto]);

  // Senza coordinate non c'è nulla da localizzare: scheda nascosta.
  if (!activeCompanyId || !coordinate) return null;

  const current = previsione?.current;
  const currentInfo = weatherCodeInfo(current?.weatherCode);
  const CurrentIcon = currentInfo.Icon;

  return (
    <div className="relative" ref={cardRef}>
      {/* Chip compatto nell'header */}
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

      {aperto && (
        <div className="absolute left-0 top-11 z-50 w-[300px] overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-pop)]">
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
        </div>
      )}
    </div>
  );
}
