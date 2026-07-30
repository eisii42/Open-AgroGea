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

/**
 * Codici di errore stabili, tradotti dalla UI (mai messaggi hard-coded qui).
 *
 * `insecure_context` è distinto da `permission_denied` di proposito: i browser
 * bloccano la geolocalizzazione su origine NON sicura (http non-localhost, es.
 * il server di sviluppo aperto dal telefono via IP di rete locale) e lo
 * riportano con lo stesso codice 1 di un permesso negato. Confonderli manda
 * l'operatore a cercare un'impostazione che non esiste.
 */
export type GeofenceErrorCode =
  | "permission_denied"
  | "insecure_context"
  | "unavailable"
  | "timeout";

export interface GeofenceWatcherOptions {
  plots: GeofencePlot[];
  options?: GeofenceOptions;
  /**
   * Ogni campione ricevuto. `accepted` è false quando il campione è stato
   * SCARTATO per accuratezza insufficiente: lo stato torna invariato e nessun
   * ingresso potrà mai scattare finché il segnale non migliora — il chiamante
   * deve poterlo distinguere da "in ascolto, tutto a posto".
   */
  onSample?: (
    sample: GeoSample,
    state: GeofenceState,
    accepted: boolean,
  ) => void;
  /** Evento `enter`/`exit` confermato dal riduttore. */
  onEvent?: (event: GeofenceEvent, state: GeofenceState) => void;
  onError?: (code: GeofenceErrorCode) => void;
}

export interface GeofenceWatcher {
  /** Avvia `watchPosition` (no-op se già attivo o se `navigator.geolocation` manca). */
  start: () => void;
  /** Ferma `watchPosition`. Sicuro da chiamare più volte / senza `start` precedente. */
  stop: () => void;
  /** Ferma e riavvia il watch azzerando lo stato del riduttore (recupero da errore). */
  restart: () => void;
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
        init.onSample?.(sample, state, result.accepted);
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
    // Origine non sicura: `watchPosition` fallirebbe con codice 1 (lo stesso di
    // un permesso negato) senza che nessuna impostazione possa rimediare.
    // Intercettato PRIMA di avviare, per poterlo dire con esattezza.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      safeOnError("insecure_context");
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
      (err) => {
        const code = mapGeolocationError(err);
        // Un permesso negato TERMINA il watch: il browser non consegnerà più
        // posizioni su questo id. Se non lo si azzera, `start()` uscirebbe dal
        // guard iniziale e il geofencing resterebbe morto per tutta la sessione
        // anche dopo che l'utente ha concesso il permesso. Timeout e posizione
        // temporaneamente indisponibile invece NON terminano il watch: quello
        // resta vivo e può riprendersi da solo, quindi si lascia com'è.
        if (code === "permission_denied") stop();
        safeOnError(code);
      },
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
    /**
     * Riavvia il watch da zero, azzerando anche lo stato del riduttore: dopo un
     * errore la permanenza accumulata non ha più senso (potremmo essere altrove
     * da minuti) e ripartire da un candidato stantio produrrebbe un `enter`
     * immediato e falso.
     */
    restart: () => {
      stop();
      state = initialGeofenceState();
      start();
    },
    pushSample,
    setPlots: (next) => {
      plots = next;
    },
    getState: () => state,
  };
}
