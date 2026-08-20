import { useSettingsStore } from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import {
  closeMeasurePanel,
  isMeasurePanelVisible,
  maplibreEsriWaybackPlugin,
  openMeasurePanel,
  subscribeMeasurePanel,
} from "@geolibre/plugins";
import { cn } from "@geolibre/ui";
import { History, Ruler } from "lucide-react";
import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { createFieldAppApi } from "../lib/fieldAppApi";

/**
 * Cluster di controlli mappa fluttuante (Modulo UI §4). Espone il controllo
 * Measure NATIVO di GeoLibre (pannello righello per distanze/aree al volo) via
 * le API `openMeasurePanel`/`closeMeasurePanel` del plugin components: nessuna
 * logica di misura riscritta.
 *
 * Il Terrain Control è anch'esso nativo ma ha già il suo pulsante MapLibre
 * (built-in "terrain", abilitato in `useFieldPlugins`) montato in alto a
 * destra sulla mappa, quindi non va duplicato qui. Stessa colonna di destra per
 * "Cerca luogo" (vedi `MapSearchControl`), che sta sotto il gestore livelli.
 */
export function MapControls({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const measureOn = useSyncExternalStore(
    subscribeMeasurePanel,
    isMeasurePanelVisible,
    isMeasurePanelVisible,
  );
  const showMeasure = useSettingsStore((s) => s.dashboardLayout.mapMeasure);
  // Esri Wayback: il flag rende available il TOOL; la scheda storica e il suo
  // layer compaiono solo al click sul tool (e spariscono al click di chiusura).
  const showWayback = useSettingsStore(
    (s) => s.dashboardLayout.mapBasemapWayback,
  );
  const [waybackOn, setWaybackOn] = useState(false);

  const toggleMeasure = () => {
    const app = createFieldAppApi(mapControllerRef);
    if (isMeasurePanelVisible()) closeMeasurePanel(app);
    else openMeasurePanel(app);
  };

  const toggleWayback = () => {
    const app = createFieldAppApi(mapControllerRef);
    if (waybackOn) {
      try {
        maplibreEsriWaybackPlugin.deactivate(app);
      } catch (e) {
        console.error("Disattivazione Esri Wayback fallita.", e);
      }
      setWaybackOn(false);
      return;
    }
    try {
      if (maplibreEsriWaybackPlugin.activate(app) === false) return;
      // Bottom-right: posizione stabile della scheda Wayback (il top-left dava
      // bug di layout). Il toggle nativo è nascosto via CSS: comanda solo questo
      // bottone.
      maplibreEsriWaybackPlugin.setMapControlPosition?.(app, "bottom-right");
      setWaybackOn(true);
    } catch (e) {
      console.error("Attivazione Esri Wayback fallita.", e);
    }
  };

  // Se il flag viene spento mentre Wayback è active, smonta scheda + layer.
  useEffect(() => {
    if (showWayback || !waybackOn) return;
    try {
      maplibreEsriWaybackPlugin.deactivate(createFieldAppApi(mapControllerRef));
    } catch (e) {
      console.error("Disattivazione Esri Wayback fallita.", e);
    }
    setWaybackOn(false);
  }, [showWayback, waybackOn, mapControllerRef]);

  return (
    <>
      {showMeasure && (
        <button
          type="button"
          onClick={toggleMeasure}
          title={t("mapControls.measure")}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border bg-[var(--panel)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]",
            measureOn
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink-2)]",
          )}
        >
          <Ruler size={18} />
        </button>
      )}
      {showWayback && (
        <button
          type="button"
          onClick={toggleWayback}
          title={t("mapControls.wayback")}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border bg-[var(--panel)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]",
            waybackOn
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink-2)]",
          )}
        >
          <History size={18} />
        </button>
      )}
    </>
  );
}
