import { useAppStore } from "@geolibre/core";
import { type MapController, sourceId } from "@geolibre/map";
import type maplibregl from "maplibre-gl";
import { type RefObject, useEffect } from "react";
import { escapeMarkup, sanitizeAttribution } from "../lib/escape-markup";

/**
 * Porta nella barra delle attribuzioni della mappa (la "i" in basso a destra)
 * le fonti dei layer dello store che ne dichiarano una (`source.attribution`):
 * WMS aggiunti da "Aggiungi dati", satellite, catasto, celle degli indici
 * Sentinel-2.
 *
 * Il layer-sync di GeoLibre crea le sorgenti raster tile e GeoJSON senza
 * inoltrare `source.attribution` del layer (vendorizzato: non lo si modifica),
 * quindi un WMS caricato compariva sulla mappa senza che la sua fonte fosse
 * citata da nessuna parte. L'attribuzione è la condizione d'uso di quasi tutti i servizi
 * pubblici: deve stare lì.
 *
 * Si interviene sull'evento `sourcedataloading`, che MapLibre emette in modo
 * SINCRONO appena la sorgente viene aggiunta e prima di leggerne i metadati:
 * l'attribuzione impostata qui è quindi già presente quando il controllo delle
 * attribuzioni si aggiorna sull'evento `metadata` che segue. Vale anche dopo un
 * cambio di basemap, perché lo stile ricrea le sorgenti e l'evento si ripete.
 */
export function useLayerAttributions(
  mapControllerRef: RefObject<MapController | null>,
  mapReady: boolean,
): void {
  useEffect(() => {
    if (!mapReady) return;
    const map = mapControllerRef.current?.getMap();
    if (!map) return;

    const attributionFor = (id: string): string | null => {
      const layer = useAppStore
        .getState()
        .layers.find((l) => sourceId(l.id) === id);
      const attribution = layer?.source.attribution;
      // Le attribuzioni dei nostri layer sono solo testo (quelle WMS arrivano
      // dal GetCapabilities di server esterni): escape completo.
      return typeof attribution === "string" && attribution.trim()
        ? escapeMarkup(attribution.trim())
        : null;
    };

    // MapLibre 5.x inserisce l'attribuzione come HTML con un sanitizer
    // aggirabile (CVE-2026-85061): OGNI sorgente, anche quelle degli stili
    // remoti e dei plugin, passa da qui ridotta a testo + link http(s).
    const apply = (id: string) => {
      const source = map.getSource(id) as
        | (maplibregl.Source & { attribution?: string })
        | undefined;
      if (!source) return;
      const attribution =
        attributionFor(id) ??
        (typeof source.attribution === "string"
          ? sanitizeAttribution(source.attribution)
          : null);
      if (attribution !== null && source.attribution !== attribution) {
        source.attribution = attribution;
      }
    };

    const onSourceLoading = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId) apply(e.sourceId);
    };

    // Sorgenti già presenti al montaggio (es. basemap ripristinata prima che la
    // mappa fosse pronta): compariranno al prossimo aggiornamento del controllo.
    for (const id of Object.keys(map.getStyle()?.sources ?? {})) apply(id);

    map.on("sourcedataloading", onSourceLoading);
    return () => {
      map.off("sourcedataloading", onSourceLoading);
    };
  }, [mapControllerRef, mapReady]);
}
