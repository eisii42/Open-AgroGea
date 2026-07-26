import {
  type GeoSample,
  type GeofenceEvent,
  type GeofenceOptions,
  type GeofencePlot,
  type GeofenceState,
  advanceGeofence,
  initialGeofenceState,
} from "@agrogea/tools";

/**
 * Servizio GPS del geofencing: wrapper framework-free su
 * `navigator.geolocation.watchPosition` che alimenta il riduttore PURO
 * `advanceGeofence` di `@agrogea/tools`. Nessun React qui — è consumato dal
 * hook `useGeofenceWatch` (che tiene lo stato React per-render) e testabile
 * a parte iniettando campioni sintetici.
 *
 * `pushSample` è il punto d'ingresso UNICO dei campioni: ci passano sia le
 * posizioni reali di `watchPosition` sia quelle sintetiche iniettate dai test,
 * così il comportamento verificato è esattamente quello che gira in campo.
 *
 * Le callback del chiamante non lanciano MAI errori verso il codice del
 * browser (`watchPosition`): un'eccezione in `onSample`/`onEvent`/nel motore
 * puro stesso (es. geometria malformata) è catturata e riportata via
 * `onError` con un codice stabile, mai propagata.
 */

/** Codici di errore stabili, tradotti dalla UI (mai messaggi hard-coded qui). */
export type GeofenceErrorCode = "permission_denied" | "unavailable" | "timeout";

export interface GeofenceWatcherOptions {
  plots: GeofencePlot[];
  options?: GeofenceOptions;
  /** Ogni campione accettato (anche se scartato per bassa accuratezza: vedi stato invariato). */
  onSample?: (sample: GeoSample, state: GeofenceState) => void;
  /** Evento `enter`/`exit` confermato dal riduttore. */
  onEvent?: (event: GeofenceEvent, state: GeofenceState) => void;
  onError?: (code: GeofenceErrorCode) => void;
}

export interface GeofenceWatcher {
  /** Avvia `watchPosition` (no-op se già attivo o se `navigator.geolocation` manca). */
  start: () => void;
  /** Ferma `watchPosition`. Sicuro da chiamare più volte / senza `start` precedente. */
  stop: () => void;
  /** Inietta un campione nella pipeline (usato da `watchPosition` e dai test). */
  pushSample: (sample: GeoSample) => void;
  /** Aggiorna la lista appezzamenti SENZA riavviare il watch GPS. */
  setPlots: (plots: GeofencePlot[]) => void;
  /** Stato current del riduttore (sola reading, per un readout diagnostico). */
  getState: () => GeofenceState;
}

/** Mappa i codici di errore nativi di `GeolocationPositionError` sui nostri codici stabili. */
function mapGeolocationError(err: GeolocationPositionError): GeofenceErrorCode {
  if (err.code === err.PERMISSION_DENIED) return "permission_denied";
  if (err.code === err.TIMEOUT) return "timeout";
  return "unavailable";
}

export function createGeofenceWatcher(
  init: GeofenceWatcherOptions,
): GeofenceWatcher {
  let plots = init.plots;
  let options = init.options ?? {};
  let state = initialGeofenceState();
  let watchId: number | null = null;

  function safeOnError(code: GeofenceErrorCode) {
    try {
      init.onError?.(code);
    } catch {
      /* la callback del chiamante non deve mai risalire fin qui */
    }
  }

  function pushSample(sample: GeoSample) {
    try {
      const result = advanceGeofence(state, sample, plots, options);
      state = result.state;
      try {
        init.onSample?.(sample, state);
      } catch {
        /* isolata: un errore del chiamante non deve fermare il geofencing */
      }
      if (result.event) {
        try {
          init.onEvent?.(result.event, state);
        } catch {
          /* idem */
        }
      }
    } catch {
      // Geometria malformata o altro guasto interno del motore puro: nessuna
      // eccezione deve risalire nel call site di watchPosition/pushSample.
      safeOnError("unavailable");
    }
  }

  function start() {
    if (watchId != null) return; // già active
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      safeOnError("unavailable");
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        pushSample({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          timestamp: pos.timestamp,
        });
      },
      (err) => safeOnError(mapGeolocationError(err)),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }

  function stop() {
    if (watchId != null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  }

  return {
    start,
    stop,
    pushSample,
    setPlots: (next) => {
      plots = next;
    },
    getState: () => state,
  };
}
