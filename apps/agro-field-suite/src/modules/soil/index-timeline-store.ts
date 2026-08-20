import type { VegetationIndexScene } from "@agrogea/core";
import type { IndicesScene, VegetationIndex } from "@agrogea/tools";
import { useSyncExternalStore } from "react";

/**
 * Stato del time slider degli indici, come mini "external store" a modulo
 * (stesso idioma di `live-sample-channel`): nessuna dipendenza, nessun
 * framework, e soprattutto NIENTE store globale di dominio.
 *
 * Serve perché produttore e consumatore vivono in due rami diversi
 * dell'albero: la timeline è alimentata dal pannello Suolo (`useSoilPipeline`)
 * e dal job di aggiornamento in background, mentre a disegnarla è un overlay
 * di mappa montato dalla FieldDashboard. Passarla per props vorrebbe dire
 * prop-drilling attraverso la dashboard intera; metterla in `useAgroStore`
 * vorrebbe dire far ri-renderizzare ogni consumer dello store (mappa in testa)
 * a ogni scrub del cursore.
 */

/** Una scena nella timeline di un appezzamento. */
export interface TimelineScene {
  /** Id dell'item STAC. */
  sceneId: string;
  /** Istante di acquisizione (ISO). */
  datetime: string;
  cloudCover: number | null;
  /**
   * true se i raster sono in cache: la scena si disegna all'istante. false =
   * scena esistente sul satellite ma mai elaborata, che si calcola al volo al
   * primo click (e da quel momento resta in cache).
   */
  cached: boolean;
  /**
   * true se è la scena MIGLIORE del suo giorno (nuvolosità più bassa), o
   * l'unica di quel giorno. false = doppione giornaliero: stessa data, nessuna
   * informazione in più, nascosto di default nello slider.
   */
  bestOfDay: boolean;
  /**
   * Scena STAC con gli href delle bande, presente solo per le scene trovate
   * dall'ultima ricerca. Senza di essa una scena non calcolata non è
   * elaborabile al volo (mancano gli asset da scaricare).
   */
  source: IndicesScene | null;
}

/**
 * Timeline di un appezzamento: unione delle scene TROVATE da una ricerca STAC
 * (elaborabili al volo anche se mai calcolate) e di quelle già in CACHE, che
 * possono essere più vecchie della finestra di ricerca perché lasciate da run
 * precedenti o dal controllo in background. È esattamente ciò che lo slider
 * deve mostrare: tutto il disponibile, distinguendo il pronto dal calcolabile.
 */
export function buildTimelineScenes(
  found: IndicesScene[],
  cached: VegetationIndexScene[],
): TimelineScene[] {
  const bySceneId = new Map<string, TimelineScene>();

  for (const scene of cached) {
    bySceneId.set(scene.scene_id, {
      sceneId: scene.scene_id,
      datetime: scene.captured_at,
      cloudCover: scene.cloud_cover,
      cached: true,
      bestOfDay: true,
      source: null,
    });
  }
  for (const scene of found) {
    const existing = bySceneId.get(scene.itemId);
    bySceneId.set(scene.itemId, {
      sceneId: scene.itemId,
      datetime: scene.datetime,
      cloudCover: scene.cloudCover,
      cached: existing?.cached ?? false,
      bestOfDay: true,
      // La scena STAC porta gli href delle bande: senza, una scena non
      // calcolata resterebbe visibile ma non elaborabile.
      source: scene,
    });
  }

  return markBestOfDay(
    [...bySceneId.values()].sort((a, b) => a.datetime.localeCompare(b.datetime)),
  );
}

/**
 * Marca, per ogni giorno, la scena da mostrare: quella con la nuvolosità più
 * bassa (a parità vince quella già in cache, poi la più recente). Le altre
 * dello stesso giorno sono doppioni.
 *
 * Vale sull'unione trovate+cache, quindi non si può riusare direttamente
 * `bestScenePerDay` di `@agrogea/tools`, che lavora sulle sole scene STAC: qui
 * lo stato di cache è un criterio di scelta in più (una scena già calcolata si
 * disegna all'istante).
 */
function markBestOfDay(scenes: TimelineScene[]): TimelineScene[] {
  const bestByDay = new Map<string, TimelineScene>();
  for (const scene of scenes) {
    const day = scene.datetime.slice(0, 10);
    const current = bestByDay.get(day);
    if (!current || isBetterScene(scene, current)) bestByDay.set(day, scene);
  }
  const bestIds = new Set([...bestByDay.values()].map((s) => s.sceneId));
  return scenes.map((scene) => ({
    ...scene,
    bestOfDay: bestIds.has(scene.sceneId),
  }));
}

/** true se `a` è preferibile a `b` come rappresentante del loro giorno. */
function isBetterScene(a: TimelineScene, b: TimelineScene): boolean {
  const ca = a.cloudCover ?? Number.POSITIVE_INFINITY;
  const cb = b.cloudCover ?? Number.POSITIVE_INFINITY;
  if (ca !== cb) return ca < cb;
  if (a.cached !== b.cached) return a.cached;
  return a.datetime.localeCompare(b.datetime) > 0;
}

export interface IndexTimelineState {
  /** Appezzamenti della run, nell'ordine in cui sono stati calcolati. */
  plots: { id: string; name: string }[];
  /** Appezzamento a cui la timeline è agganciata (la scena mostrata è la sua). */
  focusPlotId: string | null;
  /** Scene del focus, dalla più vecchia alla più recente. */
  scenes: TimelineScene[];
  /** Scena attualmente a video, o null. */
  activeSceneId: string | null;
  /** Indici richiesti dall'ultima run: servono a calcolare al volo una scena. */
  indices: VegetationIndex[];
  primaryIndex: VegetationIndex;
  /**
   * true quando l'utente ha nascosto lo slider dal pannello Suolo. La timeline
   * resta in memoria: rimostrarla non richiede di ricalcolare nulla. Un nuovo
   * calcolo la riapre (vedi `publishTimeline`).
   */
  hidden: boolean;
  /** Scena in elaborazione al volo dal cursore (id), o null. */
  loadingSceneId: string | null;
  /** Messaggio d'errore dell'ultimo calcolo al volo, o null. */
  error: string | null;
  /** Nuove scene trovate dal controllo in background dall'ultimo azzeramento. */
  backgroundNewScenes: number;
  /** true mentre il controllo in background sta lavorando. */
  backgroundRunning: boolean;
}

const EMPTY: IndexTimelineState = {
  plots: [],
  focusPlotId: null,
  scenes: [],
  activeSceneId: null,
  indices: ["ndvi"],
  primaryIndex: "ndvi",
  hidden: false,
  loadingSceneId: null,
  error: null,
  backgroundNewScenes: 0,
  backgroundRunning: false,
};

let state: IndexTimelineState = EMPTY;
const listeners = new Set<() => void>();

function publish(next: Partial<IndexTimelineState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeIndexTimeline(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIndexTimelineSnapshot(): IndexTimelineState {
  return state;
}

/** Hook di lettura: si ri-renderizza solo chi si iscrive davvero. */
export function useIndexTimeline(): IndexTimelineState {
  return useSyncExternalStore(
    subscribeIndexTimeline,
    getIndexTimelineSnapshot,
    getIndexTimelineSnapshot,
  );
}

/**
 * Sostituisce la timeline al termine di una run di analisi. `scenes` arriva già
 * in ordine cronologico crescente: il cursore parte dall'ultima, che è quella
 * appena disegnata sulla mappa.
 */
export function publishTimeline(input: {
  plots: { id: string; name: string }[];
  focusPlotId: string;
  scenes: TimelineScene[];
  activeSceneId: string | null;
  indices: VegetationIndex[];
  primaryIndex: VegetationIndex;
}): void {
  // Un nuovo calcolo riapre lo slider anche se era stato nascosto: il risultato
  // appena prodotto è proprio ciò che l'utente ha chiesto di vedere.
  publish({ ...input, hidden: false, loadingSceneId: null, error: null });
}

/** Mostra/nasconde lo slider (comando del pannello Suolo). */
export function toggleTimelineHidden(): void {
  publish({ hidden: !state.hidden });
}

/** Cambia l'appezzamento a fuoco e le sue scene (selettore interno allo slider). */
export function publishFocusPlot(input: {
  focusPlotId: string;
  scenes: TimelineScene[];
  activeSceneId: string | null;
}): void {
  publish({ ...input, loadingSceneId: null, error: null });
}

export function setTimelineActiveScene(sceneId: string | null): void {
  publish({ activeSceneId: sceneId });
}

export function setTimelineLoading(sceneId: string | null): void {
  publish({ loadingSceneId: sceneId, error: sceneId ? null : state.error });
}

export function setTimelineError(message: string | null): void {
  publish({ loadingSceneId: null, error: message });
}

/** Promuove una scena a "in cache" dopo un calcolo al volo. */
export function markTimelineSceneCached(sceneId: string): void {
  publish({
    scenes: state.scenes.map((scene) =>
      scene.sceneId === sceneId ? { ...scene, cached: true } : scene,
    ),
  });
}

export function setBackgroundRefreshRunning(running: boolean): void {
  publish({ backgroundRunning: running });
}

/** Somma le scene trovate dal controllo in background (badge nel pannello). */
export function addBackgroundNewScenes(count: number): void {
  if (count <= 0) return;
  publish({ backgroundNewScenes: state.backgroundNewScenes + count });
}

export function clearBackgroundNewScenes(): void {
  publish({ backgroundNewScenes: 0 });
}

/** Azzera tutto: cambio azienda, o reset dell'analisi dal pannello. */
export function resetIndexTimeline(): void {
  publish({ ...EMPTY });
}
