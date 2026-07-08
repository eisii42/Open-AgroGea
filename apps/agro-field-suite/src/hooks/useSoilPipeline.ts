import { boundingBox, useAgroStore } from "@agrogea/core";
import type { Plot } from "@agrogea/core";
import {
  searchSceneSeries,
  filterWindowFromLatest,
  type VegetationIndex,
} from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OverlayRaster,
  SeriesPoint,
  SuoloJob,
  SuoloProgress,
} from "../workers/soil.worker";

/**
 * Pipeline indici del modulo Suolo (refactor STAC). Orchestrazione main-thread
 * della ricerca STAC (multi-index, multi-plot, filtro cloud cover,
 * strategie temporali) e del worker di calcolo. Per ogni plot:
 *
 *   1. bbox del poligono → `searchSceneSeries` (series storica filtrata);
 *   2. worker `soil.worker` → medie per index e per data + overlay RGBA
 *      dell'index primario sulla scena più recente;
 *   3. l'overlay viene iniettato come layer `image` georeferenziato nello store
 *      GeoLibre (sopra la basemap, persistente al cambio basemap via syncLayers);
 *   4. la media NDVI più recente è salvata nella cache offline (DAL).
 */

export type StrategiaTemporale =
  | { tipo: "ultima" }
  | { tipo: "intervallo"; giorni: number }
  /** Intervallo esplicito (ISO date "YYYY-MM-DD"), max 60 giorni. */
  | { tipo: "personalizzato"; inizio: string; fine: string };

/** Tetto dell'analisi personalizzata: l'intervallo non può superare i 60 giorni. */
export const MAX_GIORNI_PERSONALIZZATO = 60;

export interface SoilOptions {
  indici: VegetationIndex[];
  indicePrimario: VegetationIndex;
  cloudCoverMax: number;
  strategia: StrategiaTemporale;
}

export interface PlotResult {
  plotId: string;
  name: string;
  series: SeriesPoint[];
}

export type SuoloStato =
  | { phase: "idle" }
  | {
      phase: "lavorazione";
      label: string;
      appezzamentoCorrente: number;
      appezzamentiTotali: number;
    }
  | {
      phase: "completato";
      risultati: PlotResult[];
      indici: VegetationIndex[];
      indicePrimario: VegetationIndex;
    }
  | { phase: "errore"; message: string };

const OVERLAY_PREFIX = "agrogea-overlay-";

/**
 * Normalizza l'intervallo personalizzato: ordina gli estremi e taglia la durata
 * a {@link MAX_GIORNI_PERSONALIZZATO} giorni (difesa lato pipeline, oltre alla
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
  const maxMs = MAX_GIORNI_PERSONALIZZATO * 24 * 3600 * 1000;
  if (fine.getTime() - inizio.getTime() > maxMs) {
    inizio = new Date(fine.getTime() - maxMs);
  }
  return { inizio, fine };
}

/** Converte il buffer RGBA dell'overlay in un data-URL PNG (solo main thread). */
function rgbaToDataUrl(overlay: OverlayRaster): string {
  const canvas = document.createElement("canvas");
  canvas.width = overlay.width;
  canvas.height = overlay.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile per l'overlay.");
  // Copia in un buffer ArrayBuffer dedicato: dopo il transfer dal worker il
  // tipo è Uint8ClampedArray<ArrayBufferLike>, che ImageData non accetta.
  const pixels = new Uint8ClampedArray(overlay.rgba);
  ctx.putImageData(
    new ImageData(pixels, overlay.width, overlay.height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

/** Rimuove tutti gli overlay d'index dallo store (prima di un nuovo calcolo). */
function rimuoviOverlay(): void {
  const store = useAppStore.getState();
  for (const layer of store.layers) {
    if (layer.id.startsWith(OVERLAY_PREFIX)) store.removeLayer(layer.id);
  }
}

/** Inietta l'overlay raster come layer `image` sopra gli altri layer (in cima). */
function iniettaOverlay(plotId: string, overlay: OverlayRaster): void {
  const store = useAppStore.getState();
  const id = `${OVERLAY_PREFIX}${plotId}`;
  const layer: GeoLibreLayer = {
    id,
    name: `Indice ${overlay.index.toUpperCase()}`,
    type: "image",
    source: {
      type: "image",
      url: rgbaToDataUrl(overlay),
      coordinates: overlay.coordinates,
    },
    visible: true,
    opacity: 0.85,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: { agrogea: true, overlay: true, index: overlay.index },
    sourcePath: `agrogea://overlay-${plotId}`,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, {
      source: layer.source,
      name: layer.name,
      metadata: layer.metadata,
    });
  } else {
    // Append (in cima): il raster dell'index resta visibile sopra il poligono.
    store.addLayer(layer);
  }
}

export function useSoilPipeline() {
  const saveMeanNdvi = useAgroStore((s) => s.saveMeanNdvi);
  const [stato, setStato] = useState<SuoloStato>({ phase: "idle" });
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

  const eseguiJob = useCallback(
    (job: SuoloJob, onProgress: (p: SuoloProgress) => void) =>
      new Promise<{ series: SeriesPoint[]; overlay: OverlayRaster | null }>(
        (resolve, reject) => {
          const worker = workerRef.current;
          if (!worker) {
            reject(new Error("Worker non inizializzato."));
            return;
          }
          const onMessage = (e: MessageEvent<SuoloProgress>) => {
            const msg = e.data;
            if (msg.tipo === "progress") {
              onProgress(msg);
              return;
            }
            worker.removeEventListener("message", onMessage);
            if (msg.tipo === "error") reject(new Error(msg.message));
            else resolve({ series: msg.series, overlay: msg.overlay });
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage(job);
        },
      ),
    [],
  );

  const calcola = useCallback(
    async (plots: Plot[], opzioni: SoilOptions) => {
      if (plots.length === 0 || opzioni.indici.length === 0) return;
      rimuoviOverlay();
      const risultati: PlotResult[] = [];

      try {
        const strategia = opzioni.strategia;
        // Parametri di ricerca STAC comuni a tutti gli plots: intervallo
        // esplicito per l'analisi personalizzata (capato a 60 gg), altrimenti N
        // giorni indietro ("ultima" usa una finestra ampia per trovare l'ultimo
        // passaggio utile).
        const datetimeRange =
          strategia.tipo === "personalizzato"
            ? clampRange(strategia.inizio, strategia.fine)
            : undefined;
        // Finestra di RICERCA STAC: sempre generosa, così si aggancia l'ultimo
        // passaggio utile anche se più vecchio del periodo richiesto (i passaggi
        // recenti possono essere tutti nuvolosi). Per le strategie a intervallo
        // la series viene poi ancorata agli ultimi N giorni dall'ultima scena.
        const giorniRicerca =
          strategia.tipo === "intervallo" ? strategia.giorni + 90 : 120;

        for (let i = 0; i < plots.length; i++) {
          const apz = plots[i];
          setStato({
            phase: "lavorazione",
            label: `Ricerca scene · ${apz.user_plot_name}`,
            appezzamentoCorrente: i + 1,
            appezzamentiTotali: plots.length,
          });

          const bbox = boundingBox(apz.geometry);
          let serieScene = await searchSceneSeries(bbox, {
            indici: opzioni.indici,
            cloudCoverMax: opzioni.cloudCoverMax,
            ...(datetimeRange
              ? { datetimeRange }
              : { giorniIndietro: giorniRicerca }),
          });
          // Intervallo "ultimi N gg": ancora la finestra all'ultima scena utile.
          if (strategia.tipo === "intervallo") {
            serieScene = filterWindowFromLatest(serieScene, strategia.giorni);
          }
          if (serieScene.length === 0) {
            risultati.push({
              plotId: apz.id,
              name: apz.user_plot_name,
              series: [],
            });
            continue;
          }

          // "ultima": solo la scena più recente; intervallo/personalizzato:
          // tutta la series (per il grafico di trend).
          const scene =
            strategia.tipo === "ultima" ? [serieScene[0]] : serieScene;

          const job: SuoloJob = {
            tipo: "suolo",
            scene,
            indici: opzioni.indici,
            indicePrimario: opzioni.indicePrimario,
            geometria: apz.geometry,
            bbox,
          };
          const { series, overlay } = await eseguiJob(job, (p) => {
            if (p.tipo !== "progress") return;
            setStato({
              phase: "lavorazione",
              label: `Calcolo indici · ${apz.user_plot_name} (scena ${p.scenaCorrente}/${p.sceneTotali})`,
              appezzamentoCorrente: i + 1,
              appezzamentiTotali: plots.length,
            });
          });

          if (overlay) iniettaOverlay(apz.id, overlay);

          // Cache offline della media NDVI più recente (series crescente: ultimo
          // = più recente), così la scheda plot la mostra offline.
          const ndviRecente = series.at(-1)?.medie.ndvi;
          if (ndviRecente != null && !Number.isNaN(ndviRecente)) {
            await saveMeanNdvi(apz.id, Math.round(ndviRecente * 1000) / 1000);
          }

          risultati.push({
            plotId: apz.id,
            name: apz.user_plot_name,
            series,
          });
        }

        setStato({
          phase: "completato",
          risultati,
          indici: opzioni.indici,
          indicePrimario: opzioni.indicePrimario,
        });
      } catch (error) {
        setStato({
          phase: "errore",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [eseguiJob, saveMeanNdvi],
  );

  const reset = useCallback(() => {
    rimuoviOverlay();
    setStato({ phase: "idle" });
  }, []);

  return { stato, calcola, reset };
}
