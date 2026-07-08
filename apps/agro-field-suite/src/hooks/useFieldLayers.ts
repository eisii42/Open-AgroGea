import {
  assetsToFeatureCollection,
  centroid,
  poiToFeatureCollection,
  harvestsToFeatureCollection,
  useAgroStore,
} from "@agrogea/core";
import type { Point } from "geojson";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  type LayerStyle,
  useAppStore,
} from "@geolibre/core";
import { useEffect } from "react";
import type { FeatureCollection } from "geojson";
import {
  buildPoiClusterProperties,
  clusterMeanExpression,
} from "../modules/soil/soil-analytics";

/**
 * Proietta i layer "infrastrutture" e "poi" del dominio agronomico nello store
 * layer di GeoLibre. La visibilità è gestita dal Layer Manager NATIVO di
 * GeoLibre (built-in "layer-control"): qui si scrivono solo i dati, sempre nel
 * flusso unidirezionale (mai su MapLibre direttamente), come `usePlotsLayer`.
 */

interface ManagedLayer {
  id: string;
  name: string;
  geojson: FeatureCollection;
  style: Partial<LayerStyle>;
  visible: boolean;
  opacity: number;
  /**
   * Spec sorgente opzionale. Per i POI abilita il clustering nativo MapLibre
   * (cluster/clusterProperties): l'engine la legge in layer-sync.
   */
  source?: Record<string, unknown>;
}

const INFRASTRUTTURE_ID = "agrogea-infrastrutture";
const POI_ID = "agrogea-poi";
const RACCOLTE_ID = "agrogea-harvests";

function syncLayer(layer: ManagedLayer): void {
  const store = useAppStore.getState();
  const existing = store.layers.find((l) => l.id === layer.id);
  if (existing) {
    store.updateLayer(layer.id, {
      geojson: layer.geojson,
      // Visibilità NON forzata sugli update: è gestita dal Layer Manager nativo
      // (e dal valore iniziale alla creazione). Così un layer creato nascosto
      // resta nascosto e una scelta dell'utente non viene sovrascritta a ogni
      // nuovo dato (es. inserendo un'operazione nel Quaderno).
      opacity: layer.opacity,
      // Propaga la spec sorgente: un POI creato prima dell'attivazione del
      // clustering viene così aggiornato e l'engine ricrea la sorgente.
      ...(layer.source ? { source: layer.source } : {}),
    });
    return;
  }
  const full: GeoLibreLayer = {
    id: layer.id,
    name: layer.name,
    type: "geojson",
    source: layer.source ?? { type: "geojson" },
    visible: layer.visible,
    opacity: layer.opacity,
    style: { ...DEFAULT_LAYER_STYLE, ...layer.style },
    metadata: { agrogea: true },
    geojson: layer.geojson,
    sourcePath: `agrogea://${layer.id}`,
  };
  store.addLayer(full);
}

export function useFieldLayers(
  // Cambiando ad ogni `style.load`, forza la re-iniezione dei layer dopo un
  // cambio basemap (lo stile MapLibre riparte da zero). Vedi useMapStyleEpoch.
  styleEpoch = 0,
): void {
  const assets = useAgroStore((s) => s.assets);
  const soilSamples = useAgroStore((s) => s.soilSamples);
  const harvests = useAgroStore((s) => s.harvests);
  const plots = useAgroStore((s) => s.plots);

  // Visibilità e opacità sono gestite dal Layer Manager NATIVO di GeoLibre:
  // qui proiettiamo solo i dati con i layer creati visibili.
  useEffect(() => {
    syncLayer({
      id: INFRASTRUTTURE_ID,
      name: "Infrastrutture",
      geojson: assetsToFeatureCollection(assets),
      // Line/polygon: condotte e recinzioni in linea, fabbricati in poligono.
      style: {
        strokeColor: "#3b4654",
        strokeWidth: 2,
        fillColor: "#3b4654",
        fillOpacity: 0.15,
      },
      visible: true,
      opacity: 1,
    });
  }, [assets, styleEpoch]);

  useEffect(() => {
    syncLayer({
      id: POI_ID,
      name: "Punti di interesse",
      geojson: poiToFeatureCollection(soilSamples),
      // Punti: marker circolari (pozzi, trappole, stazioni, soilSamples).
      style: {
        circleRadius: 6,
        fillColor: "#1f6feb",
        fillOpacity: 0.9,
        strokeColor: "#ffffff",
        strokeWidth: 1.5,
      },
      visible: true,
      opacity: 1,
      // Clustering nativo: in zoom-out i POI si raggruppano e l'etichetta del
      // cluster mostra la MEDIA della zona (qui il pH dei soilSamples).
      source: {
        type: "geojson",
        cluster: true,
        clusterRadius: 50,
        clusterProperties: buildPoiClusterProperties("ph"),
        clusterLabel: [
          "number-format",
          clusterMeanExpression(),
          { "min-fraction-digits": 1, "max-fraction-digits": 1 },
        ],
      },
    });
  }, [soilSamples, styleEpoch]);

  // Modulo Harvest: proietta gli eventi di harvest come layer puntuale. Le
  // harvests senza geometria propria ereditano il centroid dell'appezzamento
  // collegato, così compaiono in mappa; le loro properties (cultivar,
  // destinazione, quantita_kg) alimentano i grafici della tabella attributi.
  useEffect(() => {
    const centroidi = new Map<string, Point>();
    for (const a of plots) {
      centroidi.set(a.id, {
        type: "Point",
        coordinates: centroid(a.geometry),
      });
    }
    syncLayer({
      id: RACCOLTE_ID,
      name: "Raccolte",
      geojson: harvestsToFeatureCollection(harvests, centroidi),
      style: {
        circleRadius: 6,
        fillColor: "#e3a008",
        fillOpacity: 0.9,
        strokeColor: "#ffffff",
        strokeWidth: 1.5,
      },
      // Nascosto di default: le harvests NON devono creare un punto in mappa
      // all'inserimento (richiesta UX). I dati restano per la tabella attributi
      // e per il Command Center; l'utente può attivarli dal Layer Manager.
      visible: false,
      opacity: 1,
    });
  }, [harvests, plots, styleEpoch]);

  // NB: le operazioni del Quaderno (treatments) NON sono più proiettate qui
  // come layer fisso. Sono mostrate on-demand come simboli (icone per tipo,
  // disposti intorno al centroid) tramite il toggle "Mostra sulla mappa" del
  // LogbookPanel → vedi OperationMarkers.tsx (marker rimossi allo spegnimento).
}
