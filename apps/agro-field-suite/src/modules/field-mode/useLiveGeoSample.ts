import { useSyncExternalStore } from "react";
import {
  type LiveGeoSample,
  getLiveSampleSnapshot,
  subscribeLiveSample,
} from "./live-sample-channel";

/**
 * Legge l'ultimo campione GPS pubblicato da `useGeofenceWatch` (vedi
 * `live-sample-channel.ts` per il perché di questo canale dedicato): NESSUN
 * secondo `watchPosition`, NESSUN passaggio dallo store Zustand. Il
 * ri-render innescato da `useSyncExternalStore` resta CONFINATO al
 * componente che chiama questo hook (l'InFieldDashboard e i suoi hook di
 * tracking), mai alla mappa o ad altri consumer dello store.
 */
export function useLiveGeoSample(): LiveGeoSample {
  return useSyncExternalStore(
    subscribeLiveSample,
    getLiveSampleSnapshot,
    getLiveSampleSnapshot,
  );
}
