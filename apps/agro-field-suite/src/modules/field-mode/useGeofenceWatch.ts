import {
  type GeoSample,
  type GeofencePlot,
  dwellRemainingSeconds,
  speedKmh,
} from "@agrogea/tools";
import { geometryHasCoordinates, useAgroStore } from "@agrogea/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GeofenceErrorCode,
  type GeofenceWatcher,
  createGeofenceWatcher,
} from "../../services/geofencing/geofence-watcher";
import { loadFieldModeConfig } from "./field-mode-config";
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

export type GeofenceWatchStatus = "idle" | "watching" | "inside" | "error";

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
      onSample: (sample, engineState) => {
        setErrorCode(null);
        setLastSample(sample);
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

  // Specchia nello store SOLO i cambi di stato (non i campioni): è così che il
  // Riquadro Pianificazione Task mostra se il rilevamento è armato, senza
  // aprire un secondo `watchPosition`.
  useEffect(() => {
    setGeofenceWatchStatus(status, errorCode);
  }, [status, errorCode, setGeofenceWatchStatus]);

  return {
    status,
    errorCode,
    lastSample,
    speedKmh: speed,
    candidatePlotId,
    dwellRemaining,
  };
}
