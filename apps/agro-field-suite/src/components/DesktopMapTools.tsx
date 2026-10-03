import { useSettingsStore } from "@agrogea/core";
import { useEscapeDismiss } from "@agrogea/ui";
import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { History, Layers, Ruler, SlidersHorizontal, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useBasemapControls } from "../hooks/useBasemapControls";
import { useMapTools } from "../hooks/useMapTools";
import { useTopRightControlGroup } from "../hooks/useTopRightControlGroup";
import { MapLayersList } from "./MapLayersSheet";

/**
 * Strumenti di mappa del desktop, in testa all'UNICA colonna dei controlli
 * MapLibre (in alto a destra), come sul telefono: Livelli, Misura e — se
 * abilitata — Wayback. Prima Misura e sfondo stavano in una seconda colonna a
 * sinistra, e il Gestore livelli era un altro bottone con un altro pannello.
 *
 * Livelli apre un popover a fianco della colonna con lo stesso elenco del
 * foglio del telefono (sfondo, catasto, livelli dell'azienda). "Gestione
 * avanzata" apre il Gestore livelli NATIVO (opacità, stili, ordine), il cui
 * bottone resta nascosto: il suo pannello viene ancorato alla colonna via CSS
 * (index.css, classe `agro-ctrl-popover`).
 *
 * Qui gira `useBasemapControls` del desktop: il componente resta sempre
 * montato, anche a popover chiuso, perché l'effetto di pulizia legato ai flag
 * del layout vive nel hook.
 */
export function DesktopMapTools({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const tools = useMapTools(mapControllerRef);
  const basemap = useBasemapControls(mapControllerRef);
  const advancedEnabled = useSettingsStore((s) => s.dashboardLayout.mapLayerControl);
  const host = useTopRightControlGroup();
  const [layersOpen, setLayersOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const layersButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        layersButtonRef.current?.contains(target)
      ) {
        return;
      }
      setLayersOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [layersOpen]);
  useEscapeDismiss(() => setLayersOpen(false), layersOpen);

  const openAdvanced = () => {
    setLayersOpen(false);
    // Rinviato: il Gestore nativo si richiude a ogni clic sul documento fuori
    // dal suo bottone, compreso QUESTO clic, che sta ancora risalendo.
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".agro-field-map .maplibregl-ctrl-layer-control button",
        )
        ?.click();
    }, 0);
  };

  const anyBackground = basemap.satelliteOn || basemap.activeWmsId !== null;

  return (
    <>
      {host &&
        createPortal(
          <>
            <button
              ref={layersButtonRef}
              type="button"
              onClick={() => setLayersOpen((o) => !o)}
              title={t("mapLayers.title")}
              aria-label={t("mapLayers.title")}
              aria-expanded={layersOpen}
              className={cn((layersOpen || anyBackground) && "agro-map-ctrl-active")}
            >
              <Layers size={20} strokeWidth={2} />
            </button>
            {tools.showMeasure && (
              <button
                type="button"
                onClick={tools.toggleMeasure}
                title={t("mapControls.measure")}
                aria-label={t("mapControls.measure")}
                className={cn(tools.measureOn && "agro-map-ctrl-active")}
              >
                <Ruler size={20} strokeWidth={2} />
              </button>
            )}
            {tools.showWayback && (
              <button
                type="button"
                onClick={tools.toggleWayback}
                title={t("mapControls.wayback")}
                aria-label={t("mapControls.wayback")}
                className={cn(tools.waybackOn && "agro-map-ctrl-active")}
              >
                <History size={20} strokeWidth={2} />
              </button>
            )}
          </>,
          host,
        )}

      {layersOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t("mapLayers.title")}
          className="agro-ctrl-popover absolute z-40 flex max-h-[calc(100%-20px)] w-72 flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--line)] py-1.5 pl-3 pr-1.5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              {t("mapLayers.title")}
            </h2>
            <button
              type="button"
              onClick={() => setLayersOpen(false)}
              aria-label={t("mapLayers.close")}
              title={t("mapLayers.close")}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
            >
              <X size={16} />
            </button>
          </div>
          <MapLayersList
            basemap={basemap}
            dense
            className="min-h-0 overflow-y-auto px-1.5 py-2"
          />
          {advancedEnabled && (
            <button
              type="button"
              onClick={openAdvanced}
              className="flex min-h-10 items-center gap-2.5 border-t border-[var(--line)] px-4 text-left text-sm text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
            >
              <SlidersHorizontal size={16} className="text-[var(--ink-3)]" />
              <span className="flex-1">{t("mapLayers.advanced")}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
