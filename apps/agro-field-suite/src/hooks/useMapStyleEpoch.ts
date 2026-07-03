import type { MapController } from "@geolibre/map";
import { type RefObject, useEffect, useState } from "react";

/**
 * Conta i ricaricamenti di stile della mappa (`style.load`). Ogni cambio o
 * aggiunta di basemap fa ricaricare lo stile MapLibre, che parte da zero: la
 * basemap nuova porta con sé i propri layer ma i sorgenti/layer applicativi
 * vanno re-iniettati. GeoLibre re-sincronizza già i layer del suo store, ma le
 * proiezioni del dominio AgroGea (appezzamenti, infrastrutture, POI) si
 * rieseguono solo al cambio dei dati: senza un segnale legato allo stile non si
 * riaffermano dopo un cambio basemap.
 *
 * Questo hook espone un "epoch" incrementale da usare nelle dipendenze degli
 * effetti di proiezione: quando cambia, gli effetti ri-scrivono i layer nello
 * store (flusso unidirezionale invariato), che `MapController.syncLayers`
 * ri-inietta sul nuovo stile, sopra la basemap raster. Niente accesso diretto a
 * MapLibre da qui: solo l'ascolto dell'evento.
 */
export function useMapStyleEpoch(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): number {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapControllerRef.current?.getMap();
    if (!map) return;

    const onStyleLoad = () => setEpoch((e) => e + 1);
    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [mapControllerRef, mapReady]);

  return epoch;
}
