import { useSettingsStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import { cn } from "@geolibre/ui";
import { Check, Layers, Map as MapIcon, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CADASTRE_LAYER_ID,
  SATELLITE_LAYER_ID,
  addBasemap,
  cadastreLayer,
  satelliteLayer,
} from "../lib/basemaps";

/**
 * Selettore basemap di campo (Modulo 1 §FIX, esteso). Apre un menù con:
 *   * basemap di base mutuamente esclusivi (stradario · satellite): un solo
 *     raster di sfondo alla volta, in fondo allo stack;
 *   * un overlay catastale (WMS Agenzia delle Entrate) attivabile in modo
 *     indipendente, sopra il basemap ma sotto i vettori agronomici.
 *
 * L'imagery storica Esri Wayback NON è qui: è un controllo nativo di GeoLibre
 * (con selettore di release) montato on-demand dal flag `mapBasemapWayback`.
 *
 * La disponibilità di satellite / catasto è governata dai flag del layout
 * dell'utente (`useSettingsStore`): se un flag è spento l'opzione sparisce dal
 * menù e l'eventuale layer attivo viene rimosso. Resta sempre disponibile lo
 * stradario di base. Si scrive solo nello store GeoLibre, mai su MapLibre.
 */

type BaseChoice = "stradario" | "satellite";

export function BasemapSwitcher() {
  const { t } = useTranslation();
  const layers = useAppStore((s) => s.layers);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const flags = useSettingsStore((s) => s.dashboardLayout);

  const satelliteOn = layers.some((l) => l.id === SATELLITE_LAYER_ID);
  const cadastreOn = layers.some((l) => l.id === CADASTRE_LAYER_ID);
  const current: BaseChoice = satelliteOn ? "satellite" : "stradario";

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Se un flag viene disattivato mentre il relativo layer è attivo, lo si toglie
  // (la UI non avrebbe più il controllo per rimuoverlo).
  useEffect(() => {
    if (!flags.mapBasemapSatellite && satelliteOn) removeLayer(SATELLITE_LAYER_ID);
    if (!flags.mapBasemapCadastre && cadastreOn) removeLayer(CADASTRE_LAYER_ID);
  }, [flags, satelliteOn, cadastreOn, removeLayer]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const selectBase = (choice: BaseChoice) => {
    // Basemap mutuamente esclusivi: rimuovi gli altri raster di sfondo.
    if (satelliteOn) removeLayer(SATELLITE_LAYER_ID);
    if (choice === "satellite") addBasemap(satelliteLayer());
  };

  const toggleCadastre = () => {
    if (cadastreOn) removeLayer(CADASTRE_LAYER_ID);
    else addBasemap(cadastreLayer(), true);
  };

  const baseOptions: { id: BaseChoice; labelKey: string; show: boolean }[] = [
    { id: "stradario", labelKey: "basemapSwitcher.streetMap", show: true },
    {
      id: "satellite",
      labelKey: "basemapSwitcher.satellite",
      show: flags.mapBasemapSatellite,
    },
  ];

  const anyActive = satelliteOn || cadastreOn;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("basemapSwitcher.background")}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border bg-[var(--panel)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]",
          anyActive
            ? "border-[var(--accent)] text-[var(--accent)]"
            : "border-[var(--line)] text-[var(--ink-2)]",
        )}
      >
        {satelliteOn ? <Satellite size={18} /> : <MapIcon size={18} />}
      </button>

      {open && (
        <div className="absolute left-12 top-0 z-40 w-60 overflow-hidden rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--sh-pop)]">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("basemapSwitcher.basemap")}
          </p>
          {baseOptions
            .filter((o) => o.show)
            .map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => selectBase(o.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]"
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {current === o.id && (
                    <Check size={15} className="text-[var(--accent)]" />
                  )}
                </span>
                <span className="flex-1">{t(o.labelKey as never)}</span>
              </button>
            ))}

          {flags.mapBasemapCadastre && (
            <>
              <div className="my-1 border-t border-[var(--line)]" />
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("basemapSwitcher.overlay")}
              </p>
              <button
                type="button"
                onClick={toggleCadastre}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]"
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {cadastreOn && <Check size={15} className="text-[var(--accent)]" />}
                </span>
                <Layers size={14} className="text-[var(--ink-3)]" />
                <span className="flex-1">{t("basemapSwitcher.cadastre")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
