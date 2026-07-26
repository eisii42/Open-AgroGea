import type { GeoSample } from "@agrogea/tools";

/**
 * Canale dell'ULTIMO campione GPS grezzo, ALTERNATIVO allo store Zustand.
 *
 * `useGeofenceWatch` è l'UNICO `watchPosition` dell'app (vedi il doc-comment
 * di quell'hook) e già tiene i valori per-campione in stato React locale,
 * MAI nello store globale: un campione arriva a ~1 Hz e uno `useAgroStore`
 * per-campione ri-renderizzerebbe ogni consumer dello store, mappa in testa.
 *
 * L'InFieldDashboard ha lo STESSO bisogno (readout di velocità, accumulo del
 * tracciato) ma vive fuori dall'albero di `useGeofenceWatch` (è montata a
 * livello di App, non dentro FieldDashboard): non può leggere lo stato React
 * locale di quell'hook via props senza un giro di prop-drilling scomodo, e
 * non deve comunque toccare lo store per lo stesso motivo di performance.
 *
 * Soluzione: un mini "external store" a modulo (nessuna dipendenza, nessun
 * framework) che `useGeofenceWatch` alimenta a ogni campione accettato e a
 * cui l'InFieldDashboard si iscrive con `useSyncExternalStore` (vedi
 * `useLiveGeoSample`). Chi non si iscrive (la mappa, tutti gli altri
 * componenti) non viene mai notificato: zero re-render aggiuntivi per loro.
 */
export interface LiveGeoSample {
  sample: GeoSample | null;
  speedKmh: number | null;
}

let current: LiveGeoSample = { sample: null, speedKmh: null };
const listeners = new Set<() => void>();

/** Chiamata da `useGeofenceWatch` a ogni campione accettato dal watcher GPS. */
export function publishLiveSample(
  sample: GeoSample | null,
  speedKmh: number | null,
): void {
  current = { sample, speedKmh };
  for (const listener of listeners) listener();
}

export function subscribeLiveSample(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLiveSampleSnapshot(): LiveGeoSample {
  return current;
}
