import { boundingBox, useAgroStore, useSettingsStore } from "@agrogea/core";
import type { AgroDal, Plot } from "@agrogea/core";
import { searchSceneSeries, type VegetationIndex } from "@agrogea/tools";
import { useEffect, useRef } from "react";
import {
  CACHE_RETENTION_MONTHS,
  processScenes,
} from "../modules/soil/index-cache";
import {
  addBackgroundNewScenes,
  setBackgroundRefreshRunning,
} from "../modules/soil/index-timeline-store";

/**
 * Controllo automatico di nuove immagini satellitari all'avvio.
 *
 * Sentinel-2 ripassa sullo stesso punto ogni ~5 giorni: un controllo a ogni
 * avvio sarebbe traffico sprecato, quindi il job si autolimita a uno ogni
 * {@link THROTTLE_HOURS} ore per azienda. Il timestamp vive in `agro_meta` del
 * DB del tenant — non in localStorage — così segue il backup del dataDir e non
 * si mescola fra companies diverse.
 *
 * Il lavoro passa dal worker CONDIVISO a coda, una scena per job: un'analisi
 * avviata dall'utente mentre il job gira attende al massimo una scena, non
 * l'intero aggiornamento.
 *
 * Deliberatamente NON aggiorna `plots_registry.last_ndvi_mean`: è una colonna
 * sincronizzata, e un job automatico che genera voci di outbox a ogni avvio
 * sporcherebbe la coda di sync senza che l'utente abbia chiesto nulla. La
 * cache degli indici è invece local-only, quindi popolarla non ha effetti
 * collaterali fuori dal device.
 */

/** Chiave del throttle in `agro_meta`. */
const LAST_RUN_META_KEY = "index_refresh:last_run";

/** Un controllo ogni 12 ore per azienda: due volte al giorno bastano e avanzano. */
const THROTTLE_HOURS = 12;

/**
 * Indici calcolati in automatico: solo NDVI. È il default della UI e richiede
 * le due sole bande B04/B08, quindi il controllo resta leggero; se l'utente
 * chiede altri indici su una scena già in cache, la pipeline la rielabora e la
 * cache si arricchisce (vedi `sceneCoversIndices`).
 */
const BACKGROUND_INDICES: VegetationIndex[] = ["ndvi"];

/** Tetti di lavoro per run: un avvio non deve mai diventare una maratona di download. */
const MAX_PLOTS_PER_RUN = 8;
const MAX_SCENES_PER_RUN = 12;

/** Copertura nuvolosa massima accettata in automatico (come il default del pannello). */
const CLOUD_COVER_MAX = 20;

/** Finestra di ricerca per un appezzamento che non ha ancora nulla in cache. */
const FIRST_RUN_DAYS = 30;

/** Giorni da guardare indietro: dall'ultima scena in cache, con due di margine. */
function searchDaysSince(lastCapturedAt: string | undefined): number {
  if (!lastCapturedAt) return FIRST_RUN_DAYS;
  const elapsedMs = Date.now() - Date.parse(lastCapturedAt);
  if (!Number.isFinite(elapsedMs)) return FIRST_RUN_DAYS;
  return Math.max(2, Math.ceil(elapsedMs / (24 * 3600 * 1000)) + 2);
}

async function runRefresh(input: {
  dal: AgroDal;
  plots: Plot[];
  isCancelled: () => boolean;
}): Promise<void> {
  const { dal, plots, isCancelled } = input;

  const last = await dal.getMeta(LAST_RUN_META_KEY);
  const lastMs = last ? Date.parse(last) : Number.NaN;
  if (
    Number.isFinite(lastMs) &&
    Date.now() - lastMs < THROTTLE_HOURS * 3600 * 1000
  ) {
    return;
  }
  // Si marca SUBITO, prima di lavorare: due avvii ravvicinati (o due finestre
  // aperte sullo stesso tenant) non devono partire entrambi. Al massimo si
  // salta un controllo, mai se ne fanno due in parallelo.
  await dal.setMeta(LAST_RUN_META_KEY, new Date().toISOString());

  setBackgroundRefreshRunning(true);
  try {
    let budget = MAX_SCENES_PER_RUN;
    for (const plot of plots.slice(0, MAX_PLOTS_PER_RUN)) {
      if (isCancelled() || budget <= 0) break;

      const known = await dal.listVegetationIndexScenes(plot.id);
      const knownIds = new Set(known.map((s) => s.scene_id));
      const found = await searchSceneSeries(boundingBox(plot.geometry), {
        indices: BACKGROUND_INDICES,
        cloudCoverMax: CLOUD_COVER_MAX,
        giorniIndietro: searchDaysSince(known[0]?.captured_at),
      });

      const missing = found
        .filter((scene) => !knownIds.has(scene.itemId))
        .slice(0, budget);

      for (const scene of missing) {
        if (isCancelled()) break;
        // Una scena per job: la coda del worker resta libera fra una e l'altra.
        await processScenes({
          dal,
          plot,
          scenes: [scene],
          indices: BACKGROUND_INDICES,
          primaryIndex: BACKGROUND_INDICES[0],
        });
        budget -= 1;
        addBackgroundNewScenes(1);
      }
    }

    await dal.pruneVegetationIndexScenes({
      retentionMonths: CACHE_RETENTION_MONTHS,
    });
  } finally {
    setBackgroundRefreshRunning(false);
  }
}

/**
 * Arma il controllo automatico. Va montato una volta sola dalla shell (vedi
 * FieldDashboard): parte quando azienda, DAL e appezzamenti sono pronti, e una
 * sola volta per azienda nella sessione.
 */
export function useIndexRefreshJob(): void {
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  // Si osserva solo SE ci sono appezzamenti, non l'array: quello cambia
  // identità a ogni modifica di un campo, e averlo fra le dipendenze farebbe
  // scattare il cleanup — cioè annullerebbe un aggiornamento in corso — a ogni
  // salvataggio dell'utente. L'elenco vero si legge all'avvio del job.
  const hasPlots = useAgroStore((s) => s.plots.length > 0);
  // Se il modulo indici è disattivato dall'utente, non si consuma banda per
  // dati che non guarderà.
  const enabled = useSettingsStore((s) => s.dashboardLayout.panelNdvi);
  const startedForCompany = useRef<string | null>(null);

  useEffect(() => {
    if (!dal || !activeCompanyId || !enabled || !hasPlots) return;
    if (startedForCompany.current === activeCompanyId) return;
    // Offline: nessun senso interrogare lo STAC. Si riproverà al prossimo avvio.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    startedForCompany.current = activeCompanyId;

    let cancelled = false;
    void runRefresh({
      dal,
      plots: useAgroStore.getState().plots,
      isCancelled: () => cancelled,
    }).catch((error) => {
      // Un controllo automatico che fallisce non deve disturbare l'utente:
      // niente stato d'errore in UI, solo una nota in console.
      console.warn("Controllo nuove immagini satellitari non riuscito.", error);
    });
    return () => {
      cancelled = true;
    };
  }, [dal, activeCompanyId, hasPlots, enabled]);
}
