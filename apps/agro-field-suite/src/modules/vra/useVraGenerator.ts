import { boundingBox, useAgroStore } from "@agrogea/core";
import type { Plot } from "@agrogea/core";
import { searchSceneSeries, type VegetationIndex } from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuoloJob, SuoloProgress, VraCells } from "../../workers/soil.worker";
import {
  generateVraZones,
  type RisultatoZoneVra,
  type TipoLavorazione,
} from "./vra-zones";
import { vraToGeoJson, vraToIsoXml, vraToShapefileZip } from "./vra-export";
import { stopsVra } from "./vra-palette";

/**
 * Generatore di mappe a rateo variabile (VRA). Modulo SEPARATO dal calcolo
 * indici (pannello "Analisi indici"): qui l'indice è solo la materia prima.
 * Riusa il worker Suolo con il flag `vra` per ottenere le celle dell'indice,
 * poi clusterizza (K-means) in zone, assegna i ratei e prepara l'export per i
 * terminali dei trattori.
 */

export interface OpzioniGeneraVra {
  /** Indice di base su cui zonare (default NDVI). */
  indice: VegetationIndex;
  /** Lato della cella in pixel (sottocampionamento del raster). */
  step: number;
  /** Numero di zone gestionali (cluster). */
  zone: number;
  lavorazione: TipoLavorazione;
  /** Rateo per zona, in ordine crescente di indice. */
  ratei: number[];
  cloudCoverMax?: number;
}

export type VraStato =
  | { fase: "idle" }
  | { fase: "lavorazione"; label: string }
  | { fase: "completato"; risultato: RisultatoZoneVra }
  | { fase: "errore"; message: string };

const VRA_LAYER_PREFIX = "agrogea-vra-";

function iniettaVraLayer(plotId: string, risultato: RisultatoZoneVra) {
  const store = useAppStore.getState();
  const id = `${VRA_LAYER_PREFIX}${plotId}`;
  const layer: GeoLibreLayer = {
    id,
    name: `VRA · ${risultato.lavorazione}`,
    type: "geojson",
    source: { type: "geojson" },
    visible: true,
    opacity: 0.85,
    // Choropleth data-driven: fill-color = match sulla proprietà `zona`
    // (vedi vectorColorExpression nel motore), palette agronomica RdYlGn.
    style: {
      ...DEFAULT_LAYER_STYLE,
      fillColor: "#e8833a",
      fillOpacity: 0.6,
      strokeColor: "#ffffff",
      strokeWidth: 0.4,
      vectorStyleMode: "categorized",
      vectorStyleProperty: "zona",
      vectorStyleStops: stopsVra(risultato.zone.length),
    },
    metadata: { agrogea: true, vra: true },
    geojson: risultato.fc,
    sourcePath: `agrogea://vra-${plotId}`,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, { geojson: risultato.fc, style: layer.style });
  } else {
    store.addLayer(layer);
  }
}

function download(name: string, contenuto: string | Uint8Array, mime: string) {
  // Uint8Array (zip fflate) ha buffer ArrayBufferLike: cast a BlobPart, valido a runtime.
  const blob = new Blob([contenuto as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function useVraGenerator() {
  const [stato, setStato] = useState<VraStato>({ fase: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const recordTransfer = useAgroStore((s) => s.recordTransfer);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/soil.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runJob = useCallback(
    (job: SuoloJob) =>
      new Promise<VraCells | null>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error("Worker non inizializzato."));
          return;
        }
        const onMessage = (e: MessageEvent<SuoloProgress>) => {
          const msg = e.data;
          if (msg.tipo === "progress") return;
          worker.removeEventListener("message", onMessage);
          if (msg.tipo === "error") reject(new Error(msg.message));
          else resolve(msg.vraCells);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(job);
      }),
    [],
  );

  const generate = useCallback(
    async (plot: Plot, options: OpzioniGeneraVra) => {
      try {
        setStato({ fase: "lavorazione", label: "Ricerca scena satellitare…" });
        const bbox = boundingBox(plot.geometry);
        const scene = await searchSceneSeries(bbox, {
          indici: [options.indice],
          cloudCoverMax: options.cloudCoverMax ?? 20,
          giorniIndietro: 120,
        });
        if (scene.length === 0) {
          setStato({
            fase: "errore",
            message: "Nessuna scena utile per i filters scelti.",
          });
          return;
        }

        setStato({ fase: "lavorazione", label: "Calcolo indice e celle…" });
        const cells = await runJob({
          tipo: "suolo",
          scene: [scene[0]],
          indici: [options.indice],
          indicePrimario: options.indice,
          geometria: plot.geometry,
          bbox,
          vra: { step: options.step },
        });
        if (!cells || cells.features.length === 0) {
          setStato({
            fase: "errore",
            message: "Nessuna cella valida nell'appezzamento.",
          });
          return;
        }

        const risultato = generateVraZones(cells, {
          zone: options.zone,
          lavorazione: options.lavorazione,
          ratei: options.ratei,
        });
        iniettaVraLayer(plot.id, risultato);
        setStato({ fase: "completato", risultato });
      } catch (error) {
        setStato({
          fase: "errore",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [runJob],
  );

  const runExport = useCallback(
    (formato: "geojson" | "isoxml" | "shapefile", nomeBase: string) => {
      if (stato.fase !== "completato") return;
      const base = nomeBase.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "vra";
      let fileName: string;
      if (formato === "geojson") {
        fileName = `${base}.geojson`;
        download(fileName, vraToGeoJson(stato.risultato), "application/geo+json");
      } else if (formato === "shapefile") {
        // Uint8Array → Blob; archivio .zip con shp/shx/dbf/prj.
        fileName = `${base}_shapefile.zip`;
        download(
          fileName,
          vraToShapefileZip(stato.risultato, base),
          "application/zip",
        );
      } else {
        fileName = `${base}_TASKDATA.xml`;
        download(
          fileName,
          vraToIsoXml(stato.risultato, { taskName: nomeBase }),
          "application/xml",
        );
      }
      // Tracciabilità: tag di export nel giornale dei trasferimenti.
      void recordTransfer({
        operation_type: "export",
        file_format: formato,
        file_name: fileName,
      });
    },
    [stato, recordTransfer],
  );

  const reset = useCallback(() => setStato({ fase: "idle" }), []);

  return { stato, generate, runExport, reset };
}
