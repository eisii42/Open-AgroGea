import type { MapController } from "@geolibre/map";
import {
  closeSearchPlacesPanel,
  isSearchPlacesPanelVisible,
  openSearchPlacesPanel,
  subscribeSearchPlacesPanel,
} from "@geolibre/plugins";
import { cn } from "@geolibre/ui";
import { Search } from "lucide-react";
import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { createFieldAppApi } from "../lib/fieldAppApi";

/**
 * "Cerca luogo" nella colonna dei controlli MapLibre, in basso: sta con zoom,
 * bussola, schermo intero e gestore livelli invece che nella colonna AgroGea di
 * sinistra, dove finiva sotto la barra moduli.
 *
 * Il pannello di ricerca toponomastica è quello NATIVO di GeoLibre, pilotato
 * dalle API standalone (apri/chiudi) come il righello: qui c'è solo il bottone.
 * Vive in un gruppo `maplibregl-ctrl-group` appeso al contenitore top-right,
 * così eredita la veste degli altri controlli (vedi index.css) senza duplicare
 * stili. Un osservatore lo rimette sempre SUBITO DOPO l'ultimo gruppo di
 * bottoni: MapLibre appende in fondo sia i controlli che rimonta (es. al toggle
 * del gestore livelli) sia i pannelli aperti — compreso quello della ricerca,
 * che altrimenti si infilerebbe fra il gestore livelli e il suo bottone.
 */
export function MapSearchControl({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const searchOn = useSyncExternalStore(
    subscribeSearchPlacesPanel,
    isSearchPlacesPanelVisible,
    isSearchPlacesPanelVisible,
  );

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(
      ".agro-field-map .maplibregl-ctrl-top-right",
    );
    if (!container) return;

    const group = document.createElement("div");
    group.className = "maplibregl-ctrl maplibregl-ctrl-group";

    /** Ultimo posto fra i gruppi di bottoni, prima di eventuali pannelli. */
    const place = () => {
      const lastGroup = [...container.children]
        .filter(
          (el) => el !== group && el.classList.contains("maplibregl-ctrl-group"),
        )
        .at(-1);
      if (lastGroup) {
        if (lastGroup.nextElementSibling !== group) lastGroup.after(group);
      } else if (container.firstElementChild !== group) {
        container.prepend(group);
      }
    };

    place();
    setHost(group);

    const keepInPlace = new MutationObserver(place);
    keepInPlace.observe(container, { childList: true });

    return () => {
      keepInPlace.disconnect();
      group.remove();
      setHost(null);
    };
  }, []);

  if (!host) return null;

  const toggle = () => {
    const app = createFieldAppApi(mapControllerRef);
    if (isSearchPlacesPanelVisible()) closeSearchPlacesPanel();
    else openSearchPlacesPanel(app);
  };

  return createPortal(
    <button
      type="button"
      onClick={toggle}
      title={t("mapControls.searchPlace")}
      aria-label={t("mapControls.searchPlace")}
      className={cn(searchOn && "agro-map-ctrl-active")}
    >
      <Search size={20} strokeWidth={2} />
    </button>,
    host,
  );
}
