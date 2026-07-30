import type {
  IndexCellsJob,
  IndexCellsResult,
  SceneRasterPayload,
  SoilJob,
  SoilProgress,
} from "../../workers/soil.worker";

/**
 * Client condiviso del worker Suolo: UN solo `Worker` per l'app e una coda che
 * ne serializza i job.
 *
 * Tre consumatori hanno bisogno dello stesso motore — il pannello Suolo
 * (analisi su richiesta), il time slider (calcolo di una singola scena al volo)
 * e il job di aggiornamento in background — e istanziarne uno a testa
 * significherebbe tre copie di geotiff/PROJ in memoria e tre download paralleli
 * in concorrenza sulla stessa banda. La coda garantisce invece che il lavoro
 * pesante avvenga uno alla volta.
 *
 * Il worker è creato alla prima richiesta e resta vivo per la sessione: ricrearlo
 * a ogni apertura del pannello butterebbe via il token SAS della collezione
 * Sentinel-2 che il worker tiene in cache (era la causa dei 429 da burst di
 * firme).
 */

let worker: Worker | null = null;
/** Coda dei job: ogni submit si accoda al precedente, mai due in parallelo. */
let queue: Promise<unknown> = Promise.resolve();

function ensureWorker(): Worker {
  worker ??= new Worker(new URL("../../workers/soil.worker.ts", import.meta.url), {
    type: "module",
  });
  return worker;
}

/**
 * Accoda un job e risolve con la risposta. `settle` traduce il messaggio
 * terminale del worker nel risultato tipizzato del chiamante; i messaggi di
 * progresso sono inoltrati a `onProgress` senza chiudere la richiesta.
 */
function enqueue<T>(
  job: SoilJob | IndexCellsJob,
  settle: (
    message: SoilProgress,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => void,
  onProgress?: (progress: SoilProgress) => void,
): Promise<T> {
  const run = () =>
    new Promise<T>((resolve, reject) => {
      const instance = ensureWorker();
      const onMessage = (event: MessageEvent<SoilProgress>) => {
        const message = event.data;
        if (message.type === "progress") {
          onProgress?.(message);
          return;
        }
        instance.removeEventListener("message", onMessage);
        if (message.type === "error") {
          reject(new Error(message.message));
          return;
        }
        settle(message, resolve, reject);
      };
      instance.addEventListener("message", onMessage);
      instance.postMessage(job);
    });

  // La coda non deve MAI rompersi: un job fallito rigetta il suo chiamante ma
  // lascia la catena in stato risolto, altrimenti tutti i successivi
  // erediterebbero il rifiuto.
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Elabora le scene indicate (download COG + indici) e ne ritorna i raster per la cache. */
export function submitSceneJob(
  job: SoilJob,
  onProgress?: (progress: SoilProgress) => void,
): Promise<SceneRasterPayload[]> {
  return enqueue<SceneRasterPayload[]>(
    job,
    (message, resolve, reject) => {
      if (message.type === "done") resolve(message.sceneRasters);
      else reject(new Error("Risposta inattesa dal worker Suolo."));
    },
    onProgress,
  );
}

/** Vettorializza una scena a partire dai suoi raster (appena calcolati o da cache). */
export function submitCellsJob(job: IndexCellsJob): Promise<IndexCellsResult> {
  return enqueue<IndexCellsResult>(job, (message, resolve, reject) => {
    if (message.type === "cells") resolve(message.cells);
    else reject(new Error("Risposta inattesa dal worker Suolo."));
  });
}
