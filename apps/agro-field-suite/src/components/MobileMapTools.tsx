import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { History, Layers, Ruler } from "lucide-react";
import { type RefObject, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useMapTools } from "../hooks/useMapTools";
import { useTopRightControlGroup } from "../hooks/useTopRightControlGroup";
import { MapLayersSheet } from "./MapLayersSheet";

/**
 * Strumenti di mappa del telefono, nella STESSA colonna dei controlli MapLibre
 * (in alto a destra), in testa: Livelli, Misura e — se abilitata — Wayback.
 *
 * Su telefono la colonna nativa è sfoltita via CSS (niente +/−, schermo intero,
 * terreno 3D e Gestore livelli; bussola solo a mappa ruotata, vedi index.css):
 * quello che resta è un'unica colonna, invece delle due di prima ai lati.
 *
 * Il gruppo è un `maplibregl-ctrl-group` anteposto agli altri, così eredita la
 * veste dei controlli nativi (vedi `useTopRightControlGroup`). Sul desktop la
 * stessa colonna la monta `DesktopMapTools`, con Livelli in un popover.
 */
export function MobileMapTools({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const tools = useMapTools(mapControllerRef);
  const host = useTopRightControlGroup();
  const [layersOpen, setLayersOpen] = useState(false);

  return (
    <>
      {host &&
        createPortal(
          <>
            <button
              type="button"
              onClick={() => setLayersOpen(true)}
              title={t("mapLayers.title")}
              aria-label={t("mapLayers.title")}
              className={cn(layersOpen && "agro-map-ctrl-active")}
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
      <MapLayersSheet
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        mapControllerRef={mapControllerRef}
      />
    </>
  );
}
