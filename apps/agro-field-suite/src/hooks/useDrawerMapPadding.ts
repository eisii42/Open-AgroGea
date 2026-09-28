import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect } from "react";

/**
 * Desktop: con un pannello laterale aperto (`.agro-drawer`, FieldSheet) la
 * mappa riceve un padding destro pari alla sua larghezza. MapLibre lo somma a
 * quello di `fitBounds`, del centro e dello zoom: "centra appezzamento",
 * i +/− e la ricerca lavorano sull'area davvero visibile invece di mettere il
 * soggetto sotto il pannello.
 *
 * Cambiare il padding sposta il centro logico della mappa: per non far
 * "saltare" la vista, nello stesso istante il centro diventa il punto che era
 * già al centro dell'area visibile. Chi guarda non vede nulla muoversi.
 *
 * Sul telefono i pannelli sono fogli dal basso: nessun padding.
 */
export function useDrawerMapPadding(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
  areaRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const area = areaRef.current;
    const map = mapControllerRef.current?.getMap();
    if (!mapReady || !area || !map) return;

    let current = 0;
    const apply = () => {
      const drawer = enabled
        ? area.querySelector<HTMLElement>(":scope .agro-drawer")
        : null;
      const next = drawer ? Math.round(drawer.getBoundingClientRect().width) : 0;
      if (next === current) return;
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // Punto oggi al centro dell'area visibile (con il padding attuale):
      // resta il centro anche con il nuovo padding.
      const visibleCenter = map.unproject([(width - next) / 2, height / 2]);
      const padding = map.getPadding();
      map.jumpTo({
        center: visibleCenter,
        padding: { ...padding, right: next },
      });
      current = next;
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(area, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (current !== 0) {
        const canvas = map.getCanvas();
        const center = map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
        map.jumpTo({ center, padding: { ...map.getPadding(), right: 0 } });
      }
    };
  }, [mapControllerRef, mapReady, areaRef, enabled]);
}
