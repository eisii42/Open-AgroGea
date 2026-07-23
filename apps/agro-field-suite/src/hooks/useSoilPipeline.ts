import { boundingBox, useAgroStore } from "@agrogea/core";
import type { Plot } from "@agrogea/core";
import {
  indexCellColorExpression,
  indexCellValues,
  relativeDomain,
  relativeRamp,
  searchSceneSeries,
  filterWindowFromLatest,
  type VegetationIndex,
} from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  type LayerStyle,
  useAppStore,
} from "@geolibre/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IndexCellsResult,
  SeriesPoint,
  SoilJob,
  SoilProgress,
} from "../workers/soil.worker";

/**
 * Pipeline indici del module Suolo (refactor STAC + rendering vettoriale).
 * Orchestrazione main-thread della ricerca STAC (multi-index, multi-plot,
 * filtro cloud cover, strategie temporali) e del worker di calcolo. Per ogni
 * plot:
 *
 *   1. bbox del poligono → `searchSceneSeries` (series storica filtrata);
 *   2. worker `soil.worker` → medie per index e per data + celle vettoriali
 *      (10×10 m, una per pixel raster) dell'index primario sulla scena più
 *      recente, con i value di tutti gli indici come properties;
 *   3. le celle vengono iniettate come layer `geojson` (fill-color = espressione
 *      `interpolate` sulla property `value`) nello store GeoLibre, sopra la
 *      basemap e persistenti al cambio basemap via syncLayers. La color scale
 *      è RELATIVA: pooled sui value di TUTTI i plots calcolati in questa run,
 *      ricalcolata e riallineata su ogni layer a fine run;
 *   4. la media NDVI più recente è salvata nella cache offline (DAL).
 */

export type StrategiaTemporale =
  | { type: "ultima" }
  | { type: "intervallo"; days: number }
  /** Intervallo esplicito (ISO date "YYYY-MM-DD"), max 60 giorni. */
  | { type: "personalizzato"; inizio: string; fine: string };

/** Tetto dell'analisi personalizzata: l'intervallo non può superare i 60 giorni. */
export const MAX_CUSTOM_DAYS = 60;

export interface SoilOptions {
  indices: VegetationIndex[];
  primaryIndex: VegetationIndex;
  cloudCoverMax: number;
  strategia: StrategiaTemporale;
}

export interface PlotResult {
  plotId: string;
  name: string;
  series: SeriesPoint[];
}

export type SoilStatus =
  | { phase: "idle" }
  | {
      phase: "lavorazione";
      label: string;
      appezzamentoCorrente: number;
      appezzamentiTotali: number;
    }
  | {
      phase: "completato";
      results: PlotResult[];
      indices: VegetationIndex[];
      primaryIndex: VegetationIndex;
      /** Dominio relativo (2-98 percentile) pooled sui plots della run; null se nessuna cella calcolata. */
      domain: [number, number] | null;
    }
  | { phase: "errore"; message: string };

/** Prefisso id dei layer celle indice (uno per plot, sostituisce il vecchio overlay immagine). */
export const INDEX_CELLS_PREFIX = "agrogea-index-cells-";

/** Rimuove tutti i layer celle indice dallo store (prima di un nuovo calcolo). */
function removeIndexCells(): void {
  const store = useAppStore.getState();
  for (const layer of store.layers) {
    if (layer.id.startsWith(INDEX_CELLS_PREFIX)) store.removeLayer(layer.id);
  }
}

/**
 * Normalizza l'intervallo personalizzato: ordina gli estremi e taglia la durata
 * a {@link MAX_CUSTOM_DAYS} giorni (difesa lato pipeline, oltre alla
 * validazione UI). La fine è inclusa fino a fine giornata.
 */
function clampRange(
  inizioISO: string,
  fineISO: string,
): { inizio: Date; fine: Date } {
  let inizio = new Date(inizioISO);
  let fine = new Date(fineISO);
  if (fine < inizio) [inizio, fine] = [fine, inizio];
  // La fine copre l'intera giornata selezionata.
  fine.setHours(23, 59, 59, 999);
  const maxMs = MAX_CUSTOM_DAYS * 24 * 3600 * 1000;
  if (fine.getTime() - inizio.getTime() > maxMs) {
    inizio = new Date(fine.getTime() - maxMs);
  }
  return { inizio, fine };
}

/** Stile del layer celle: espressione `interpolate` sulla rampa relativa dell'index. */
function cellStyle(
  index: VegetationIndex,
  domain: [number, number],
): LayerStyle {
  const ramp = relativeRamp(index, domain);
  const middleColor = ramp[Math.floor(ramp.length / 2)]?.[1] ?? ramp[0]?.[1] ?? DEFAULT_LAYER_STYLE.fillColor;
  return {
    ...DEFAULT_LAYER_STYLE,
    fillColor: middleColor,
    fillOpacity: 0.85,
    strokeWidth: 0,
    vectorStyleMode: "expression",
    vectorStyleExpression: JSON.stringify(indexCellColorExpression(ramp)),
  };
}

/**
 * Inietta (o aggiorna) il layer `geojson` delle celle indice del plot, con la
 * color scale relativa al dominio corrente (pooled fin lì nella run).
 */
function iniettaIndexCells(
  plot: Plot,
  result: IndexCellsResult,
  domain: [number, number],
): void {
  const store = useAppStore.getState();
  const id = `${INDEX_CELLS_PREFIX}${plot.id}`;
  const style = cellStyle(result.index, domain);
  const metadata = {
    agrogea: true,
    overlay: true,
    indexCells: true,
    index: result.index,
    domain,
    cellSizeM: result.cellSizeM,
    datetime: result.datetime,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, { geojson: result.cells, style, metadata });
    return;
  }
  const layer: GeoLibreLayer = {
    id,
    name: `Indice ${result.index.toUpperCase()} · ${plot.user_plot_name}`,
    type: "geojson",
    source: { type: "geojson" },
    geojson: result.cells,
    visible: true,
    opacity: 1,
    style,
    metadata,
    sourcePath: `agrogea://index-cells-${plot.id}`,
  };
  // Append (in cima): le celle indice restano visibili sopra il poligono.
  store.addLayer(layer);
}

/** Riallinea SOLO lo stile/dominio del layer celle di un plot già iniettato. */
function aggiornaScalaIndexCells(
  plotId: string,
  index: VegetationIndex,
  domain: [number, number],
): void {
  const store = useAppStore.getState();
  const id = `${INDEX_CELLS_PREFIX}${plotId}`;
  const layer = store.layers.find((l) => l.id === id);
  if (!layer) return;
  store.updateLayer(id, {
    style: cellStyle(index, domain),
    metadata: { ...layer.metadata, domain },
  });
}

export function useSoilPipeline() {
  const saveMeanNdvi = useAgroStore((s) => s.saveMeanNdvi);
  const [status, setStatus] = useState<SoilStatus>({ phase: "idle" });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/soil.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runJob = useCallback(
    (job: SoilJob, onProgress: (p: SoilProgress) => void) =>
      new Promise<{ series: SeriesPoint[]; cells: IndexCellsResult | null }>(
        (resolve, reject) => {
          const worker = workerRef.current;
          if (!worker) {
            reject(new Error("Worker non inizializzato."));
            return;
          }
          const onMessage = (e: MessageEvent<SoilProgress>) => {
            const msg = e.data;
            if (msg.type === "progress") {
              onProgress(msg);
              return;
            }
            worker.removeEventListener("message", onMessage);
            if (msg.type === "error") reject(new Error(msg.message));
            else resolve({ series: msg.series, cells: msg.cells });
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage(job);
        },
      ),
    [],
  );

  const compute = useCallback(
    async (plots: Plot[], options: SoilOptions) => {
      if (plots.length === 0 || options.indices.length === 0) return;
      removeIndexCells();
      const results: PlotResult[] = [];
      // Value pooled per plot (property `value` = index primario di ogni cella):
      // la color scale relativa si ricalcola man mano su TUTTI i plots già
      // calcolati, e viene riallineata su tutti i layer a fine run.
      const cellValuesByPlot = new Map<string, number[]>();

      try {
        const strategia = options.strategia;
        // Parametri di ricerca STAC comuni a tutti gli plots: intervallo
        // esplicito per l'analisi personalizzata (capato a 60 gg), altrimenti N
        // giorni indietro ("ultima" usa una finestra ampia per trovare l'ultimo
        // passaggio utile).
        const datetimeRange =
          strategia.type === "personalizzato"
            ? clampRange(strategia.inizio, strategia.fine)
            : undefined;
        // Finestra di RICERCA STAC: sempre generosa, così si aggancia l'ultimo
        // passaggio utile anche se più vecchio del periodo richiesto (i passaggi
        // recenti possono essere tutti nuvolosi). Per le strategie a intervallo
        // la series viene poi ancorata agli ultimi N giorni dall'ultima scena.
        const searchDays =
          strategia.type === "intervallo" ? strategia.days + 90 : 120;

        for (let i = 0; i < plots.length; i++) {
          const plot = plots[i];
          setStatus({
            phase: "lavorazione",
            label: `Ricerca scene · ${plot.user_plot_name}`,
            appezzamentoCorrente: i + 1,
            appezzamentiTotali: plots.length,
          });

          const bbox = boundingBox(plot.geometry);
          let sceneSeries = await searchSceneSeries(bbox, {
            indices: options.indices,
            cloudCoverMax: options.cloudCoverMax,
            ...(datetimeRange
              ? { datetimeRange }
              : { giorniIndietro: searchDays }),
          });
          // Intervallo "ultimi N gg": ancora la finestra all'ultima scena utile.
          if (strategia.type === "intervallo") {
            sceneSeries = filterWindowFromLatest(sceneSeries, strategia.days);
          }
          if (sceneSeries.length === 0) {
            results.push({
              plotId: plot.id,
              name: plot.user_plot_name,
              series: [],
            });
            continue;
          }

          // "ultima": solo la scena più recente; intervallo/personalizzato:
          // tutta la series (per il grafico di trend).
          const scene =
            strategia.type === "ultima" ? [sceneSeries[0]] : sceneSeries;

          const job: SoilJob = {
            type: "suolo",
            scene,
            indices: options.indices,
            primaryIndex: options.primaryIndex,
            geometria: plot.geometry,
            bbox,
            plotId: plot.id,
          };
          const { series, cells } = await runJob(job, (p) => {
            if (p.type !== "progress") return;
            setStatus({
              phase: "lavorazione",
              label: `Calcolo indices · ${plot.user_plot_name} (scena ${p.scenaCorrente}/${p.sceneTotali})`,
              appezzamentoCorrente: i + 1,
              appezzamentiTotali: plots.length,
            });
          });

          if (cells) {
            cellValuesByPlot.set(plot.id, indexCellValues(cells.cells));
            // Dominio "in corso": pooled sui plots calcolati finora, così
            // l'utente vede progressivamente la mappa mentre gli altri plots
            // sono ancora in lavorazione.
            const runningDomain = relativeDomain(
              [...cellValuesByPlot.values()].flat(),
            );
            iniettaIndexCells(plot, cells, runningDomain);
          }

          // Cache offline della media NDVI più recente (series crescente: ultimo
          // = più recente), così la scheda plot la mostra offline.
          const ndviRecente = series.at(-1)?.medie.ndvi;
          if (ndviRecente != null && !Number.isNaN(ndviRecente)) {
            await saveMeanNdvi(plot.id, Math.round(ndviRecente * 1000) / 1000);
          }

          results.push({
            plotId: plot.id,
            name: plot.user_plot_name,
            series,
          });
        }

        // Dominio FINALE: pooled su tutti i plots della run, riallineato su
        // ogni layer già iniettato così condividono tutti la stessa scala.
        let domain: [number, number] | null = null;
        if (cellValuesByPlot.size > 0) {
          domain = relativeDomain([...cellValuesByPlot.values()].flat());
          for (const plotId of cellValuesByPlot.keys()) {
            aggiornaScalaIndexCells(plotId, options.primaryIndex, domain);
          }
        }

        setStatus({
          phase: "completato",
          results,
          indices: options.indices,
          primaryIndex: options.primaryIndex,
          domain,
        });
      } catch (error) {
        setStatus({
          phase: "errore",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [runJob, saveMeanNdvi],
  );

  const reset = useCallback(() => {
    removeIndexCells();
    setStatus({ phase: "idle" });
  }, []);

  return { status, compute, reset };
}
