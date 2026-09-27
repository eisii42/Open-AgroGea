import type maplibregl from "maplibre-gl";
import { useSyncExternalStore } from "react";
import { activateWmsBasemap, removeWmsBasemapLayers } from "../../lib/basemaps";
import {
  EMPTY_WMS_BASEMAPS,
  loadWmsBasemaps,
  persistWmsBasemaps,
  removeWmsBasemap,
  type SavedWmsBasemap,
  upsertWmsBasemap,
  type WmsBasemapState,
} from "./wms-basemaps";

/**
 * Stato condiviso dei WMS salvati dell'azienda attiva: lo leggono il selettore
 * di sfondo (per sceglierli) e "Aggiungi dati" (per aggiungerli, modificarli,
 * eliminarli). Ogni modifica si salva subito e si riflette sulla mappa, così
 * lista, sfondo visibile e dato persistito non divergono mai.
 */

let companyId: string | null = null;
let state: WmsBasemapState = EMPTY_WMS_BASEMAPS;
const listeners = new Set<() => void>();

function commit(next: WmsBasemapState): void {
  state = next;
  if (companyId) persistWmsBasemaps(companyId, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWmsBasemapState(): WmsBasemapState {
  return state;
}

/** WMS salvati dell'azienda attiva (reattivo). */
export function useSavedWmsBasemaps(): WmsBasemapState {
  return useSyncExternalStore(subscribe, getWmsBasemapState);
}

/**
 * Carica i WMS salvati di un'azienda e ne rimonta lo sfondo attivo. Il WMS
 * dell'azienda precedente viene tolto: lo store dei layer sopravvive al cambio
 * di azienda, i suoi sfondi no.
 */
export function restoreWmsBasemaps(
  id: string | null,
  { map }: { map?: maplibregl.Map | null } = {},
): void {
  removeWmsBasemapLayers();
  companyId = id;
  const loaded = id ? loadWmsBasemaps(id) : EMPTY_WMS_BASEMAPS;
  state = loaded;
  const active = loaded.items.find((i) => i.id === loaded.activeId);
  if (active) activateWmsBasemap(active, { map });
  for (const listener of listeners) listener();
}

/**
 * Salva (nuovo o modificato) un WMS e lo mostra come sfondo al posto del
 * satellite. Modificare quello attivo lo ridisegna con i nuovi parametri.
 */
export function saveWmsBasemap(
  item: SavedWmsBasemap,
  { map }: { map?: maplibregl.Map | null } = {},
): void {
  activateWmsBasemap(item, { map });
  commit({ ...upsertWmsBasemap(state, item), activeId: item.id });
}

/** Sceglie lo sfondo WMS (id) o lo toglie (null: stradario o satellite). */
export function selectWmsBasemap(
  id: string | null,
  { map }: { map?: maplibregl.Map | null } = {},
): void {
  const item = id ? state.items.find((i) => i.id === id) : undefined;
  if (item) activateWmsBasemap(item, { map });
  else removeWmsBasemapLayers();
  commit({ ...state, activeId: item ? item.id : null });
}

/** Elimina un WMS salvato; se era lo sfondo, la mappa torna allo stradario. */
export function deleteWmsBasemap(id: string): void {
  if (state.activeId === id) removeWmsBasemapLayers();
  commit(removeWmsBasemap(state, id));
}

/**
 * Il layer dello sfondo attivo è stato tolto da fuori (Gestore livelli): il WMS
 * resta salvato, ma non è più lo sfondo. Senza questo, alla riapertura
 * ricomparirebbe un layer che l'utente aveva appena rimosso.
 */
export function markWmsBasemapInactive(): void {
  if (state.activeId !== null) commit({ ...state, activeId: null });
}
