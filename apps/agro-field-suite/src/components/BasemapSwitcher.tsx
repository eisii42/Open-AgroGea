import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { Check, Globe, Layers, Map as MapIcon, Satellite } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBasemapControls } from "../hooks/useBasemapControls";

/**
 * Selettore basemap di field (Modulo 1 §FIX, esteso). Apre un menù con:
 *   * basemap di base mutuamente esclusivi (stradario · satellite · WMS salvati
 *     da "Aggiungi dati"): un solo raster di sfondo alla volta, in fondo allo
 *     stack. Un WMS scelto prende il posto del satellite;
 *   * un overlay catastale (WMS Agenzia delle Entrate) attivabile in modo
 *     indipendente, sopra il basemap ma sotto i vettori agronomici.
 *
 * L'imagery storica Esri Wayback NON è qui: è un controllo nativo di GeoLibre
 * (con selettore di release) montato on-demand dal flag `mapBasemapWayback`.
 *
 * La logica (flag del layout, esclusività, catasto) sta in `useBasemapControls`,
 * condivisa col foglio Livelli del telefono. Solo desktop: su telefono lo
 * sfondo si sceglie da `MapLayersSheet`.
 */

export function BasemapSwitcher({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const {
    baseOptions,
    current,
    savedWms,
    activeWmsId,
    satelliteOn,
    cadastreOn,
    showCadastre,
    selectBase,
    selectWms,
    toggleCadastre,
  } = useBasemapControls(mapControllerRef);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const anyActive = satelliteOn || cadastreOn || activeWmsId !== null;

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
        {activeWmsId ? (
          <Globe size={18} />
        ) : satelliteOn ? (
          <Satellite size={18} />
        ) : (
          <MapIcon size={18} />
        )}
      </button>

      {open && (
        <div className="absolute left-12 top-0 z-40 w-60 overflow-hidden rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--sh-pop)]">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("basemapSwitcher.basemap")}
          </p>
          {baseOptions.map((o) => (
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
          {/* WMS salvati da "Aggiungi dati": alternative al satellite. */}
          {savedWms.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectWms(item.id)}
              title={item.attribution || item.baseUrl}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]"
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {activeWmsId === item.id && (
                  <Check size={15} className="text-[var(--accent)]" />
                )}
              </span>
              <Globe size={14} className="shrink-0 text-[var(--ink-3)]" />
              <span className="flex-1 truncate">{item.name}</span>
              <span className="text-[10px] font-semibold uppercase text-[var(--ink-4)]">
                WMS
              </span>
            </button>
          ))}

          {showCadastre && (
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
