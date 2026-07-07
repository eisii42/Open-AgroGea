import { centroid, useAgroStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Droplets, RefreshCw, Wind } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type PrevisioneDashboard,
  WeatherSyncService,
} from "../../lib/WeatherSyncService";
import { infoMeteoCodice } from "../../lib/weather-codes";

/**
 * Scheda meteo dell'header (di fianco allo switcher azienda): condizioni
 * correnti + previsione di oggi e dei 4 giorni successivi, con icone.
 *
 * Sorgente: `WeatherSyncService.previsioneDashboard` (Open-Meteo, endpoint
 * daily/current), localizzata sul centroid dell'azienda — la sede se nota,
 * altrimenti il primo appezzamento con geometria. Si aggiorna all'avvio dell'app
 * (montaggio) e ogni ora (lucchetto orario condiviso con il resto del meteo).
 */

/** Coordinate [lon, lat] dell'azienda attiva, o null se non localizzabile. */
function useCoordinateAzienda(): [number, number] | null {
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const aziende = useAgroStore((s) => s.aziende);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);

  return useMemo(() => {
    const azienda = aziende.find((a) => a.id === aziendaAttivaId);
    const sede = azienda?.centroid?.coordinates;
    if (sede && sede.length >= 2) return [sede[0], sede[1]];
    const conGeometria = appezzamenti.find((a) => a.geometry);
    if (conGeometria) return centroid(conGeometria.geometry);
    return null;
  }, [aziendaAttivaId, aziende, appezzamenti]);
}

function gradi(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}°`;
}

/** Etichetta breve del giorno: "Oggi" per l'indice 0, altrimenti il weekday. */
function etichettaGiorno(
  dataIso: string,
  indice: number,
  locale: string,
  todayLabel: string,
): string {
  if (indice === 0) return todayLabel;
  const d = new Date(`${dataIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dataIso;
  return d.toLocaleDateString(locale, { weekday: "short" });
}

export function WeatherCard() {
  const { t, i18n } = useTranslation();
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const coordinate = useCoordinateAzienda();

  const [previsione, setPrevisione] = useState<PrevisioneDashboard | null>(null);
  const [stato, setStato] = useState<"idle" | "loading" | "errore">("idle");
  const [aperto, setAperto] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const carica = useCallback(
    async (force: boolean) => {
      if (!aziendaAttivaId || !coordinate) return;
      setStato("loading");
      try {
        const data = await WeatherSyncService.previsioneDashboard({
          aziendaId: aziendaAttivaId,
          lon: coordinate[0],
          lat: coordinate[1],
          force,
        });
        setPrevisione(data);
        setStato("idle");
      } catch {
        // Offline o fetch fallito: si conserva l'ultima previsione disponibile.
        setStato("errore");
      }
    },
    [aziendaAttivaId, coordinate],
  );

  // Cambio azienda → si azzera la scheda (i dati appartengono a un'altra sede).
  useEffect(() => {
    setPrevisione(null);
  }, [aziendaAttivaId]);

  // Avvio app / coordinate disponibili → caricamento (cache oraria a valle).
  useEffect(() => {
    void carica(false);
  }, [carica]);

  // Aggiornamento automatico orario (timeout come nel resto del modulo meteo).
  useEffect(() => {
    const id = window.setInterval(() => void carica(true), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [carica]);

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
  if (!aziendaAttivaId || !coordinate) return null;

  const corrente = previsione?.corrente;
  const infoCorrente = infoMeteoCodice(corrente?.weatherCode);
  const IconaCorrente = infoCorrente.Icon;

  return (
    <div className="relative" ref={cardRef}>
      {/* Chip compatto nell'header */}
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        title={t("meteoCard.title")}
        className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-2 text-left hover:bg-[var(--panel-2)]"
      >
        <IconaCorrente size={17} className="shrink-0 text-[var(--accent)]" />
        <span className="agro-num text-sm font-medium tabular-nums">
          {stato === "loading" && !previsione ? "…" : gradi(corrente?.temperatura)}
        </span>
      </button>

      {aperto && (
        <div className="absolute left-0 top-11 z-50 w-[300px] overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-pop)]">
          {/* Intestazione: stato + aggiorna */}
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {infoCorrente.label}
            </p>
            <button
              type="button"
              onClick={() => void carica(true)}
              title={t("meteoCard.refreshNow")}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
            >
              <RefreshCw
                size={13}
                className={cn(stato === "loading" && "animate-spin")}
              />
            </button>
          </div>

          {stato === "errore" && !previsione ? (
            <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
              {t("meteoCard.unavailable")}
            </p>
          ) : (
            <>
              {/* Condizioni correnti */}
              <div className="flex items-center gap-3">
                <IconaCorrente size={40} className="shrink-0 text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <p className="agro-num text-[28px] font-semibold leading-none tabular-nums">
                    {gradi(corrente?.temperatura)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--ink-3)]">
                    <span className="flex items-center gap-1">
                      <Droplets size={12} />
                      {corrente?.umidita == null
                        ? "—"
                        : `${Math.round(corrente.umidita)}%`}
                    </span>
                    <span className="flex items-center gap-1">
                      <Wind size={12} />
                      {corrente?.vento == null
                        ? "—"
                        : `${Math.round(corrente.vento)} km/h`}
                    </span>
                    <span className="flex items-center gap-1">
                      <Droplets size={12} className="text-[var(--accent)]" />
                      {corrente?.pioggia == null
                        ? "—"
                        : `${corrente.pioggia.toFixed(1)} mm`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Previsione giornaliera (oggi + successivi) */}
              <div className="mt-3 grid grid-cols-5 gap-1 border-t border-[var(--line)] pt-2.5">
                {(previsione?.giorni ?? []).map((g, i) => {
                  const info = infoMeteoCodice(g.weatherCode);
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
                        {etichettaGiorno(g.data, i, i18n.language, t("meteoCard.today"))}
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
