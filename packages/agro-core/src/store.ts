import { create } from "zustand";
import { createDomainSlice } from "./store/domain-slice";
import { createGeometrySlice } from "./store/geometry-slice";
import { createSessionSlice } from "./store/session-slice";
import { createUiSlice } from "./store/ui-slice";
import type { AgroState } from "./store/state";

/**
 * Store Zustand agronomico, composto da quattro slice per dominio (vedi
 * `store/state.ts` per la mappa completa): sessione/sync, dominio dati,
 * UI Modalità Campo e disegno/geometrie. Ogni slice riceve `set`/`get`
 * sull'intero {@link AgroState}, quindi le azioni possono attraversare i
 * confini quando il flusso lo richiede (es. `endSession` azzera tutto).
 */
export const useAgroStore = create<AgroState>((set, get) => ({
  ...createSessionSlice(set, get),
  ...createDomainSlice(set, get),
  ...createUiSlice(set, get),
  ...createGeometrySlice(set, get),
}));

// Ri-esporta tipi e funzioni pure dal loro nuovo modulo: l'API pubblica di
// `./store` resta identica a prima dello split in slice.
export type {
  AgroState,
  AppView,
  AppezzamentoDrawAttrs,
  AssetDrawAttrs,
  GeomEditRequest,
  GeomEditSession,
  GeometrySnapshot,
  NuovaAziendaInput,
  PendingGeometry,
  SelectableKind,
  SelectedFeatureRef,
} from "./store/state";
export { isViewerReadOnly } from "./store/helpers";
export {
  appezzamentiToFeatureCollection,
  assetsToFeatureCollection,
  colturaPerAppezzamento,
  cropLabelPerAppezzamento,
  poiToFeatureCollection,
  raccolteToFeatureCollection,
  trattamentiToFeatureCollection,
} from "./store/feature-collections";
