import { useCallback, useRef, useState } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type GeoStatus = "idle" | "loading" | "success" | "error";

export interface GeoLocationState {
  status: GeoStatus;
  position: GeoPosition | null;
  error: string | null;
}

/**
 * Hook per la geolocalizzazione GPS nativa. Funziona sia nella WebView Tauri
 * (che espone `navigator.geolocation` con la precisione nativa del chip GPS)
 * sia nel browser standard (PWA mode).
 *
 * `requestPosition()` è un'acquisizione one-shot ad alta precisione; la
 * promessa risolve con la posizione o rifiuta con il message di errore.
 */
export function useGeoLocation() {
  const [state, setState] = useState<GeoLocationState>({
    status: "idle",
    position: null,
    error: null,
  });

  const watchIdRef = useRef<number | null>(null);

  const requestPosition = useCallback((): Promise<GeoPosition> => {
    setState({ status: "loading", position: null, error: null });
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        const msg = "GPS non available su questo dispositivo.";
        setState({ status: "error", position: null, error: msg });
        reject(new Error(msg));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const gp: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          };
          setState({ status: "success", position: gp, error: null });
          resolve(gp);
        },
        (err) => {
          const msg =
            err.code === 1
              ? "Permesso GPS negato. Abilita la geolocalizzazione nelle impostazioni."
              : err.code === 2
                ? "GPS non available. Controlla il segnale."
                : "Timeout GPS. Riprova all'aperto.";
          setState({ status: "error", position: null, error: msg });
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    });
  }, []);

  /** Avvia il monitoraggio continuo della posizione. */
  const startWatch = useCallback((onUpdate: (pos: GeoPosition) => void) => {
    if (!navigator.geolocation) return;
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const gp: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setState({ status: "success", position: gp, error: null });
        onUpdate(gp);
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  return { ...state, requestPosition, startWatch, stopWatch };
}
