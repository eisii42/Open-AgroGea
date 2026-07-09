import { boundingBox, useAgroStore } from "@agrogea/core";
import type { Plot } from "@agrogea/core";
import { searchSceneSeries, type VegetationIndex } from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SoilJob, SoilProgress, VraCells } from "../../workers/soil.worker";
import {
  generateVraZones,
  type VraZoneResult,
  type TillageType,
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

export interface VraGenerateOptions {
  /** Indice di base su cui zonare (default NDVI). */
  index: VegetationIndex;
  /** Lato della cella in pixel (sottocampionamento del raster). */
  step: number;
  /** Numero di zone gestionali (cluster). */
  zone: number;
  tillage: TillageType;
  /** Rateo per zona, in ordine crescente di indice. */
  rates: number[];
  cloudCoverMax?: number;
}

export type VraStatus =
  | { fase: "idle" }
  | { fase: "lavorazione"; label: string }
  | { fase: "completato"; result: VraZoneResult }
  | { fase: "errore"; message: string };

const VRA_LAYER_PREFIX = "agrogea-vra-";

function iniettaVraLayer(plotId: string, result: VraZoneResult) {
  const store = useAppStore.getState();
  const id = `${VRA_LAYER_PREFIX}${plotId}`;
  const layer: GeoLibreLayer = {
    id,
    name: `VRA · ${result.tillage}`,
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
      vectorStyleStops: stopsVra(result.zone.length),
    },
    metadata: { agrogea: true, vra: true },
    geojson: result.fc,
    sourcePath: `agrogea://vra-${plotId}`,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, { geojson: result.fc, style: layer.style });
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
  const [status, setStatus] = useState<VraStatus>({ fase: "idle" });
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
    (job: SoilJob) =>
      new Promise<VraCells | null>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error("Worker non inizializzato."));
          return;
        }
        const onMessage = (e: MessageEvent<SoilProgress>) => {
          const msg = e.data;
          if (msg.type === "progress") return;
          worker.removeEventListener("message", onMessage);
          if (msg.type === "error") reject(new Error(msg.message));
          else resolve(msg.vraCells);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(job);
      }),
    [],
  );

  const generate = useCallback(
    async (plot: Plot, options: VraGenerateOptions) => {
      try {
        setStatus({ fase: "lavorazione", label: "Ricerca scena satellitare…" });
        const bbox = boundingBox(plot.geometry);
        const scene = await searchSceneSeries(bbox, {
          indices: [options.index],
          cloudCoverMax: options.cloudCoverMax ?? 20,
          giorniIndietro: 120,
        });
        if (scene.length === 0) {
          setStatus({
            fase: "errore",
            message: "Nessuna scena utile per i filters scelti.",
          });
          return;
        }

        setStatus({ fase: "lavorazione", label: "Calcolo indice e celle…" });
        const cells = await runJob({
          type: "suolo",
          scene: [scene[0]],
          indices: [options.index],
          primaryIndex: options.index,
          geometria: plot.geometry,
          bbox,
          vra: { step: options.step },
        });
        if (!cells || cells.features.length === 0) {
          setStatus({
            fase: "errore",
            message: "Nessuna cella valida nell'appezzamento.",
          });
          return;
        }

        const result = generateVraZones(cells, {
          zone: options.zone,
          tillage: options.tillage,
          rates: options.rates,
        });
        iniettaVraLayer(plot.id, result);
        setStatus({ fase: "completato", result });
      } catch (error) {
        setStatus({
          fase: "errore",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [runJob],
  );

  const runExport = useCallback(
    (formato: "geojson" | "isoxml" | "shapefile", nomeBase: string) => {
      if (status.fase !== "completato") return;
      const base = nomeBase.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "vra";
      let fileName: string;
      if (formato === "geojson") {
        fileName = `${base}.geojson`;
        download(fileName, vraToGeoJson(status.result), "application/geo+json");
      } else if (formato === "shapefile") {
        // Uint8Array → Blob; archivio .zip con shp/shx/dbf/prj.
        fileName = `${base}_shapefile.zip`;
        download(
          fileName,
          vraToShapefileZip(status.result, base),
          "application/zip",
        );
      } else {
        fileName = `${base}_TASKDATA.xml`;
        download(
          fileName,
          vraToIsoXml(status.result, { taskName: nomeBase }),
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
    [status, recordTransfer],
  );

  const reset = useCallback(() => setStatus({ fase: "idle" }), []);

  return { status, generate, runExport, reset };
}
