import { boundingBox, useAgroStore } from "@agrogea/core";
import type { Plot } from "@agrogea/core";
import { cercaSerieScene, type IndiceVegetazionale } from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuoloJob, SuoloProgress, VraCells } from "../../workers/soil.worker";
import {
  generaZoneVra,
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
  indice: IndiceVegetazionale;
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
  | { fase: "lavorazione"; etichetta: string }
  | { fase: "completato"; risultato: RisultatoZoneVra }
  | { fase: "errore"; messaggio: string };

const VRA_LAYER_PREFIX = "agrogea-vra-";

function iniettaVraLayer(appezzamentoId: string, risultato: RisultatoZoneVra) {
  const store = useAppStore.getState();
  const id = `${VRA_LAYER_PREFIX}${appezzamentoId}`;
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
    sourcePath: `agrogea://vra-${appezzamentoId}`,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, { geojson: risultato.fc, style: layer.style });
  } else {
    store.addLayer(layer);
  }
}

function scarica(nome: string, contenuto: string | Uint8Array, mime: string) {
  // Uint8Array (zip fflate) ha buffer ArrayBufferLike: cast a BlobPart, valido a runtime.
  const blob = new Blob([contenuto as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function useVraGenerator() {
  const [stato, setStato] = useState<VraStato>({ fase: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const registraTrasferimento = useAgroStore((s) => s.registraTrasferimento);

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

  const eseguiJob = useCallback(
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
          if (msg.tipo === "error") reject(new Error(msg.messaggio));
          else resolve(msg.vraCells);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(job);
      }),
    [],
  );

  const genera = useCallback(
    async (appezzamento: Plot, opzioni: OpzioniGeneraVra) => {
      try {
        setStato({ fase: "lavorazione", etichetta: "Ricerca scena satellitare…" });
        const bbox = boundingBox(appezzamento.geometry);
        const scene = await cercaSerieScene(bbox, {
          indici: [opzioni.indice],
          cloudCoverMax: opzioni.cloudCoverMax ?? 20,
          giorniIndietro: 120,
        });
        if (scene.length === 0) {
          setStato({
            fase: "errore",
            messaggio: "Nessuna scena utile per i filtri scelti.",
          });
          return;
        }

        setStato({ fase: "lavorazione", etichetta: "Calcolo indice e celle…" });
        const cells = await eseguiJob({
          tipo: "suolo",
          scene: [scene[0]],
          indici: [opzioni.indice],
          indicePrimario: opzioni.indice,
          geometria: appezzamento.geometry,
          bbox,
          vra: { step: opzioni.step },
        });
        if (!cells || cells.features.length === 0) {
          setStato({
            fase: "errore",
            messaggio: "Nessuna cella valida nell'appezzamento.",
          });
          return;
        }

        const risultato = generaZoneVra(cells, {
          zone: opzioni.zone,
          lavorazione: opzioni.lavorazione,
          ratei: opzioni.ratei,
        });
        iniettaVraLayer(appezzamento.id, risultato);
        setStato({ fase: "completato", risultato });
      } catch (error) {
        setStato({
          fase: "errore",
          messaggio: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [eseguiJob],
  );

  const esporta = useCallback(
    (formato: "geojson" | "isoxml" | "shapefile", nomeBase: string) => {
      if (stato.fase !== "completato") return;
      const base = nomeBase.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "vra";
      let nomeFile: string;
      if (formato === "geojson") {
        nomeFile = `${base}.geojson`;
        scarica(nomeFile, vraToGeoJson(stato.risultato), "application/geo+json");
      } else if (formato === "shapefile") {
        // Uint8Array → Blob; archivio .zip con shp/shx/dbf/prj.
        nomeFile = `${base}_shapefile.zip`;
        scarica(
          nomeFile,
          vraToShapefileZip(stato.risultato, base),
          "application/zip",
        );
      } else {
        nomeFile = `${base}_TASKDATA.xml`;
        scarica(
          nomeFile,
          vraToIsoXml(stato.risultato, { taskName: nomeBase }),
          "application/xml",
        );
      }
      // Tracciabilità: tag di export nel giornale dei trasferimenti.
      void registraTrasferimento({
        operation_type: "export",
        file_format: formato,
        file_name: nomeFile,
      });
    },
    [stato, registraTrasferimento],
  );

  const reset = useCallback(() => setStato({ fase: "idle" }), []);

  return { stato, genera, esporta, reset };
}
