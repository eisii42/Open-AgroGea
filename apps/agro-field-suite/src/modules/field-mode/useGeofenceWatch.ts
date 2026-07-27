import {
  type GeoSample,
  type GeofencePlot,
  dwellRemainingSeconds,
  speedKmh,
} from "@agrogea/tools";
import { geometryHasCoordinates, useAgroStore } from "@agrogea/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GeofenceErrorCode,
  type GeofenceWatcher,
  createGeofenceWatcher,
} from "../../services/geofencing/geofence-watcher";
import { loadFieldModeConfig } from "./field-mode-config";
import { registerGeofenceRetry } from "./geofence-control";
import { publishLiveSample } from "./live-sample-channel";

/**
 * Soppressione di un "Non ora": oltre questa durata dalla dismissal, la
 * proposta può ripresentarsi anche senza un evento `exit` pulito (es. il GPS
 * perde/riacquisisce il fix vicino al confine e non emette mai l'uscita).
 * Scelta pragmatica: abbastanza lunga da non infastidire durante una sosta
 * breve nello stesso plot, abbastanza corta da non bloccare la proposta per
 * l'intera giornata lavorativa.
 */
const DISMISS_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Stato del rilevamento. `low_accuracy` è distinto da `watching` di proposito:
 * i campioni arrivano ma vengono tutti scartati perché troppo imprecisi, quindi
 * nessun ingresso potrà scattare. Confonderlo con "in ascolto" lascerebbe
 * l'operatore ad aspettare in mezzo al campo un banner che non arriverà.
 */
export type GeofenceWatchStatus =
  | "idle"
  | "watching"
  | "low_accuracy"
  | "inside"
  | "error";

/**
 * Hook della Modalità Campo: costruisce la lista appezzamenti dallo store,
 * tiene acceso il watch GPS e collega gli eventi `enter`/`exit` allo stato UI
 * condiviso (`geofenceDetection` in `useAgroStore`).
 *
 * NIENTE toggle, niente flag di Impostazioni, niente pulsante in mappa: il
 * rilevamento è AUTOMATICO per definizione — l'operatore che entra in un campo
 * non deve ricordarsi di armarlo. Il watch parte al mount e si ferma
 * all'unmount; un permesso negato resta silenzioso (lo stato è consultabile
 * nel Riquadro Pianificazione Task, che non è chrome di mappa).
 *
 * Perché un `watchPosition` proprio invece del controllo GPS nativo della
 * mappa: `MapController.geolocateControl` (@geolibre/map) è PRIVATO e senza
 * getter pubblico, e `packages/map` è GeoLibre vendorizzato che non si tocca.
 * Il browser multiplexa comunque un unico fix GPS del sistema operativo fra
 * tutti i sottoscrittori, quindi il costo è nullo: il controllo nativo resta
 * il GPS "mostrami sulla mappa", questo è il sensore del geofencing.
 *
 * Performance: i campioni GPS arrivano a ~1 Hz e questo hook vive accanto al
 * canvas MapLibre. I valori per-campione (ultimo campione, velocità,
 * countdown dwell) restano in stato React LOCALE — mai nello store globale,
 * altrimenti ogni consumer della mappa ri-renderizzerebbe ogni secondo. Solo
 * le transizioni CONFERMATE `enter`/`exit` e i cambi di STATO del watch
 * (rari) toccano lo store.
 */
export function useGeofenceWatch() {
  const plots = useAgroStore((s) => s.plots);
  const setGeofenceDetection = useAgroStore((s) => s.setGeofenceDetection);
  const clearGeofenceDismissal = useAgroStore((s) => s.clearGeofenceDismissal);
  const setGeofenceWatchStatus = useAgroStore((s) => s.setGeofenceWatchStatus);

  const [status, setStatus] = useState<GeofenceWatchStatus>("idle");
  const [errorCode, setErrorCode] = useState<GeofenceErrorCode | null>(null);
  const [lastSample, setLastSample] = useState<GeoSample | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [candidatePlotId, setCandidatePlotId] = useState<string | null>(null);
  const [dwellRemaining, setDwellRemaining] = useState<number | null>(null);
  /** Accuratezza dell'ultimo campione (m): mostrata quando il segnale è troppo debole. */
  const [lastAccuracyM, setLastAccuracyM] = useState<number | null>(null);

  const watcherRef = useRef<GeofenceWatcher | null>(null);
  const prevSampleRef = useRef<GeoSample | null>(null);
  // Config dwell/isteresi/accuratezza dell'utente (localStorage): letta una
  // sola volta, come `loadKpiParams` in CommandCenter.
  const [config] = useState(() => loadFieldModeConfig());

  // I callback del watcher sono legati una sola volta (creazione lazy):
  // leggono i valori freschi di store/azioni tramite questo ref, mai da
  // closure stantie sul primo render.
  const liveRef = useRef({ setGeofenceDetection, clearGeofenceDismissal });
  useEffect(() => {
    liveRef.current = { setGeofenceDetection, clearGeofenceDismissal };
  }, [setGeofenceDetection, clearGeofenceDismissal]);

  const geofencePlots = useMemo<GeofencePlot[]>(
    () =>
      plots
        .filter((p) => p.deleted_at == null && geometryHasCoordinates(p.geometry))
        .map((p) => ({
          id: p.id,
          name: p.user_plot_name,
          geometry: p.geometry,
          area_ha: p.area_ha,
        })),
    [plots],
  );

  // Crea il watcher e lo AVVIA una sola volta al mount; le callback leggono da
  // liveRef per restare aggiornate senza dover ricreare il watcher a ogni
  // render (che interromperebbe un dwell/isteresi in corso).
  useEffect(() => {
    const cfg = config;
    const watcher = createGeofenceWatcher({
      plots: geofencePlots,
      options: {
        dwellSeconds: cfg.dwellSeconds,
        exitGraceSeconds: cfg.exitGraceSeconds,
        maxAccuracyM: cfg.maxAccuracyM,
      },
      onSample: (sample, engineState, accepted) => {
        setErrorCode(null);
        setLastSample(sample);
        setLastAccuracyM(sample.accuracy_m ?? null);
        if (!accepted) {
          // Campione scartato: nessun ingresso potrà scattare finché il segnale
          // non migliora. Va DETTO, non nascosto dietro un generico "attivo".
          setStatus("low_accuracy");
          return;
        }
        const prev = prevSampleRef.current;
        const currentSpeed = prev ? speedKmh(prev, sample) : null;
        setSpeed(currentSpeed);
        prevSampleRef.current = sample;
        // Pubblica sul canale dedicato dell'InFieldDashboard (vedi
        // live-sample-channel.ts): NON è uno `set` sullo store, quindi non
        // ri-renderizza la mappa né altri consumer di useAgroStore.
        publishLiveSample(sample, currentSpeed);
        setCandidatePlotId(engineState.candidatePlotId);
        setDwellRemaining(
          dwellRemainingSeconds(engineState, sample.timestamp, {
            dwellSeconds: cfg.dwellSeconds,
          }),
        );
        setStatus(engineState.insidePlotId ? "inside" : "watching");
      },
      onEvent: (event) => {
        if (!event) return;
        const { setGeofenceDetection: setDetection, clearGeofenceDismissal: clearDismissal } =
          liveRef.current;
        if (event.kind === "enter") {
          const { geofenceDismissedPlotId, geofenceDismissedAt } =
            useAgroStore.getState();
          const suppressed =
            geofenceDismissedPlotId === event.plotId &&
            geofenceDismissedAt != null &&
            Date.now() - geofenceDismissedAt < DISMISS_TIMEOUT_MS;
          if (!suppressed) {
            setDetection({ plotId: event.plotId, at: event.at });
          }
        } else if (event.kind === "exit") {
          clearDismissal(event.plotId);
        }
      },
      onError: (code) => {
        // Permesso negato o GPS assente: nessun avviso invadente, il
        // rilevamento resta semplicemente spento e lo stato è consultabile
        // nel Riquadro Pianificazione Task.
        setStatus("error");
        setErrorCode(code);
      },
    });
    watcherRef.current = watcher;
    watcher.start();
    setStatus((s) => (s === "error" ? s : "watching"));
    return () => {
      watcher.stop();
      watcherRef.current = null;
    };
    // Creazione intenzionalmente una tantum: `config` è stabile (letto una
    // sola volta) e `geofencePlots` è tenuto sincronizzato dall'effect
    // successivo via `setPlots`, senza dover ricreare il watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizza la lista appezzamenti SENZA riavviare il watch (preserva un
  // dwell/isteresi eventualmente in corso).
  useEffect(() => {
    watcherRef.current?.setPlots(geofencePlots);
  }, [geofencePlots]);

  /**
   * Riavvia il watch e riporta lo stato a "in ascolto". È il recupero da un
   * errore: senza di questo un permesso negato una volta spegnerebbe il
   * rilevamento per l'INTERA sessione, perché un `watchPosition` respinto non
   * consegna più posizioni e non si riavvia da sé.
   */
  const retry = useCallback(() => {
    setErrorCode(null);
    setStatus("watching");
    prevSampleRef.current = null;
    setCandidatePlotId(null);
    setDwellRemaining(null);
    watcherRef.current?.restart();
  }, []);

  // Il permesso può cambiare mentre l'app è aperta (l'operatore lo concede
  // dopo aver visto l'avviso, o il sistema lo revoca). La Permissions API
  // notifica il passaggio: alla concessione si riparte da soli, senza chiedere
  // all'operatore di ricaricare l'app in mezzo a un campo.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return; // browser senza Permissions API: resta il riavvio manuale
    }
    let status: PermissionStatus | null = null;
    let disposed = false;
    const onChange = () => {
      if (status?.state === "granted") retry();
    };
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (disposed) return;
        status = result;
        result.addEventListener("change", onChange);
      })
      .catch(() => {
        /* query non supportata per 'geolocation': resta il riavvio manuale */
      });
    return () => {
      disposed = true;
      status?.removeEventListener("change", onChange);
    };
  }, [retry]);

  // Espone il riavvio manuale a chi mostra lo stato (il Riquadro
  // Pianificazione Task), senza che debba conoscere il watcher.
  useEffect(() => {
    registerGeofenceRetry(retry);
    return () => registerGeofenceRetry(null);
  }, [retry]);

  // Specchia nello store SOLO i cambi di stato (non i campioni): è così che il
  // Riquadro Pianificazione Task mostra se il rilevamento è armato, senza
  // aprire un secondo `watchPosition`. L'accuratezza è arrotondata a decine di
  // metri prima di entrare nello store: cambia a ogni campione, e un valore
  // esatto qui ri-renderizzerebbe la mappa un secondo su due.
  const accuracyBucketM =
    status === "low_accuracy" && lastAccuracyM != null
      ? Math.round(lastAccuracyM / 10) * 10
      : null;
  useEffect(() => {
    setGeofenceWatchStatus(status, errorCode, accuracyBucketM);
  }, [status, errorCode, accuracyBucketM, setGeofenceWatchStatus]);

  return {
    status,
    errorCode,
    lastSample,
    lastAccuracyM,
    speedKmh: speed,
    candidatePlotId,
    dwellRemaining,
  };
}
