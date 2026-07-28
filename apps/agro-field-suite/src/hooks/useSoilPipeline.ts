import { boundingBox, useAgroStore } from "@agrogea/core";
import type { AgroDal, Plot, VegetationIndexScene } from "@agrogea/core";
import {
  indexCellValues,
  relativeDomain,
  searchSceneSeries,
  filterWindowFromLatest,
  type IndicesScene,
  type VegetationIndex,
} from "@agrogea/tools";
import { useCallback, useState } from "react";
import {
  CACHE_RETENTION_MONTHS,
  cellsForScene,
  processScenes,
  sceneCoversIndices,
  seriesPointFromPayload,
  seriesPointFromScene,
} from "../modules/soil/index-cache";
import {
  injectIndexCells,
  removeIndexCells,
  updateIndexCellsScale,
} from "../modules/soil/index-cells-layer";
import {
  buildTimelineScenes,
  publishTimeline,
  resetIndexTimeline,
  type TimelineScene,
} from "../modules/soil/index-timeline-store";
import type { SeriesPoint } from "../workers/soil.worker";

/**
 * Pipeline indici del module Suolo (refactor STAC + rendering vettoriale),
 * CACHE-FIRST: una scena satellitare si elabora UNA volta sola per plot, poi
 * vive nel data plane locale (`vegetation_index_scenes` +
 * `vegetation_index_rasters`, tabelle local-only). Per ogni plot:
 *
 *   1. bbox del poligono → `searchSceneSeries` (series storica filtrata);
 *   2. le scene già in cache che coprono TUTTI gli indici richiesti vengono
 *      lette dal DAL; solo le mancanti vanno al worker, che scarica i COG,
 *      compute medie e raster mascherati e li restituisce già compressi;
 *   3. la scena a video viene vettorializzata dal worker partendo dai raster:
 *      stesso identico percorso sia che vengano dal calcolo appena fatto sia
 *      dalla cache;
 *   4. le celle vengono iniettate come layer `geojson` nello store GeoLibre. La
 *      color scale è RELATIVA: pooled sui value di TUTTI i plots della run,
 *      ricalcolata e riallineata su ogni layer a fine run;
 *   5. la media NDVI più recente è salvata nella cache offline (DAL), le scene
 *      oltre la finestra di ritenzione vengono potate e la timeline del time
 *      slider viene pubblicata.
 *
 * Le operazioni condivise con il time slider e con il job in background stanno
 * in `modules/soil/index-cache.ts`; il worker è quello condiviso a coda
 * (`soil-worker-client`), non uno per hook.
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

export function useSoilPipeline() {
  const saveMeanNdvi = useAgroStore((s) => s.saveMeanNdvi);
  const [status, setStatus] = useState<SoilStatus>({ phase: "idle" });

  const compute = useCallback(
    async (plots: Plot[], options: SoilOptions) => {
      if (plots.length === 0 || options.indices.length === 0) return;
      removeIndexCells();
      // Senza DAL (nessuna company aperta) la pipeline resta funzionante ma
      // senza cache: ogni run torna in rete, come prima del refactor.
      const dal: AgroDal | null = useAgroStore.getState().dal;
      const results: PlotResult[] = [];
      // Value pooled per plot (property `value` = index primario di ogni cella):
      // la color scale relativa si ricalcola man mano su TUTTI i plots già
      // calcolati, e viene riallineata su tutti i layer a fine run.
      const cellValuesByPlot = new Map<string, number[]>();
      // Timeline del PRIMO plot con scene: è quello su cui si apre lo slider.
      let timeline: {
        plotId: string;
        scenes: TimelineScene[];
        activeSceneId: string | null;
      } | null = null;

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

          let sceneSeries = await searchSceneSeries(boundingBox(plot.geometry), {
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

          // Cache locale: le scene già elaborate che coprono gli indici
          // richiesti non tornano in rete. È il salto di prestazioni della
          // pipeline — su una serie storica il secondo giro è quasi istantaneo.
          const cached = dal ? await dal.listVegetationIndexScenes(plot.id) : [];
          const cachedBySceneId = new Map(cached.map((s) => [s.scene_id, s]));

          if (sceneSeries.length === 0) {
            results.push({
              plotId: plot.id,
              name: plot.user_plot_name,
              series: [],
            });
            // Anche senza passaggi nella finestra richiesta lo storico in cache
            // resta navigabile dallo slider.
            timeline ??= cached.length
              ? {
                  plotId: plot.id,
                  scenes: buildTimelineScenes([], cached),
                  activeSceneId: null,
                }
              : null;
            continue;
          }

          // "ultima": solo la scena più recente; intervallo/personalizzato:
          // tutta la series (per il grafico di trend).
          const scene =
            strategia.type === "ultima" ? [sceneSeries[0]] : sceneSeries;

          const daElaborare = scene.filter((s) => {
            const hit = cachedBySceneId.get(s.itemId);
            return !hit || !sceneCoversIndices(hit, options.indices);
          });

          const fresh = await processScenes({
            dal,
            plot,
            scenes: daElaborare,
            indices: options.indices,
            primaryIndex: options.primaryIndex,
            onProgress: (p) => {
              if (p.type !== "progress") return;
              setStatus({
                phase: "lavorazione",
                label: `Calcolo indices · ${plot.user_plot_name} (scena ${p.scenaCorrente}/${p.sceneTotali})`,
                appezzamentoCorrente: i + 1,
                appezzamentiTotali: plots.length,
              });
            },
            onScenePersisted: (saved) =>
              cachedBySceneId.set(saved.scene_id, saved),
          });

          // Serie storica = scene fresche + scene da cache, in ordine
          // cronologico crescente (il grafico di trend legge da sinistra).
          const series = scene
            .map((s) => {
              const payload = fresh.get(s.itemId);
              if (payload) return seriesPointFromPayload(payload);
              const hit = cachedBySceneId.get(s.itemId);
              return hit ? seriesPointFromScene(hit) : null;
            })
            .filter((p): p is SeriesPoint => p !== null)
            .sort((a, b) => a.datetime.localeCompare(b.datetime));

          const cells = await cellsForScene({
            dal,
            plotId: plot.id,
            datetime: scene[0].datetime,
            primaryIndex: options.primaryIndex,
            indices: options.indices,
            fresh: fresh.get(scene[0].itemId) ?? null,
            cachedScene: cachedBySceneId.get(scene[0].itemId) ?? null,
          });

          if (cells) {
            cellValuesByPlot.set(plot.id, indexCellValues(cells.cells));
            // Dominio "in corso": pooled sui plots calcolati finora, così
            // l'utente vede progressivamente la mappa mentre gli altri plots
            // sono ancora in lavorazione.
            const runningDomain = relativeDomain(
              [...cellValuesByPlot.values()].flat(),
            );
            injectIndexCells(plot, cells, runningDomain);
          }

          timeline ??= {
            plotId: plot.id,
            scenes: buildTimelineScenes(sceneSeries, [
              ...cachedBySceneId.values(),
            ]),
            activeSceneId: cells ? scene[0].itemId : null,
          };

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
            updateIndexCellsScale(plotId, options.primaryIndex, domain);
          }
        }

        // Potatura della cache fuori finestra: a fine run, quando il risultato
        // è già in mano all'utente. Un fallimento qui non deve far fallire
        // l'analisi — al massimo la cache resta più grande del previsto.
        try {
          await dal?.pruneVegetationIndexScenes({
            retentionMonths: CACHE_RETENTION_MONTHS,
          });
        } catch (error) {
          console.warn("Potatura della cache indici non riuscita.", error);
        }

        if (timeline) {
          publishTimeline({
            plots: plots.map((p) => ({ id: p.id, name: p.user_plot_name })),
            focusPlotId: timeline.plotId,
            scenes: timeline.scenes,
            activeSceneId: timeline.activeSceneId,
            indices: options.indices,
            primaryIndex: options.primaryIndex,
          });
        } else {
          resetIndexTimeline();
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
    [saveMeanNdvi],
  );

  const reset = useCallback(() => {
    removeIndexCells();
    resetIndexTimeline();
    setStatus({ phase: "idle" });
  }, []);

  return { status, compute, reset };
}
