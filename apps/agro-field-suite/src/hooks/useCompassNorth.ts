import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect } from "react";

/**
 * Marca il bottone bussola quando la mappa è orientata a NORD, così la veste
 * può mostrarci sopra una piccola "N" (vedi `index.css`) che sparisce appena la
 * mappa viene ruotata.
 *
 * La rotazione si legge dal `bearing` della mappa e non dal `transform` inline
 * che MapLibre scrive sull'icona: quello è un dettaglio interno del controllo,
 * qui interessa lo stato della vista. Nessun accesso a MapLibre oltre
 * all'ascolto dell'evento, come in `useMapStyleEpoch`.
 */

/**
 * Tolleranza in gradi entro cui la mappa si considera a nord: sotto il grado
 * la differenza non è percepibile, e un residuo di rotazione dopo l'animazione
 * di "rimetti il nord in alto" non deve far sparire la N.
 */
const NORTH_TOLERANCE_DEG = 1;

/** Classe applicata al bottone bussola quando la vista è a nord. */
export const COMPASS_NORTH_CLASS = "agro-compass-north";

export function useCompassNorth(
  mapControllerRef: RefObject<MapController | null>,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    const container = containerRef.current;
    if (!map || !container) return;

    const sync = () => {
      const compass = container.querySelector(".maplibregl-ctrl-compass");
      if (!compass) return;
      // Bearing normalizzato in [0, 360): a nord sia ~0 sia ~360.
      const bearing = ((map.getBearing() % 360) + 360) % 360;
      const atNorth =
        bearing <= NORTH_TOLERANCE_DEG || bearing >= 360 - NORTH_TOLERANCE_DEG;
      compass.classList.toggle(COMPASS_NORTH_CLASS, atNorth);
    };

    sync();
    map.on("rotate", sync);
    map.on("rotateend", sync);
    // Lo stile ricaricato (cambio basemap) non tocca il bearing, ma il bottone
    // può essere stato rimontato: si riafferma la classe.
    map.on("style.load", sync);

    return () => {
      map.off("rotate", sync);
      map.off("rotateend", sync);
      map.off("style.load", sync);
    };
  }, [mapControllerRef, containerRef]);
}
