import { createContext } from "react";

/**
 * Stato condiviso della pila dei pannelli laterali (vedi `DrawerSlot`):
 * il modulo a cui appartiene un pannello, i numeri d'ordine e gli eventi con
 * cui i FieldSheet si coordinano. Sta in un file a sé perché lo usano sia
 * `DrawerSlot` sia `FieldSheet`, e `DrawerSlot` importa già `FieldSheet`
 * (per il pannello di caricamento): così non si importano a vicenda.
 */
export const DrawerSlotContext = createContext<string | null>(null);

export const DRAWER_OPENED_EVENT = "agro:drawer-opened";
export const DRAWER_FOCUS_EVENT = "agro:drawer-focus";

export interface DrawerOpenedDetail {
  seq: number;
}

export interface DrawerFocusDetail {
  id: string;
  handled: boolean;
}

let lastSeq = 0;

/** Numero d'ordine del prossimo pannello aperto o portato in primo piano. */
export function nextDrawerSeq(): number {
  lastSeq += 1;
  return lastSeq;
}

/** Il pannello `seq` è ora in cima: gli altri si riducono. */
export function announceDrawerOpened(seq: number): void {
  window.dispatchEvent(
    new CustomEvent<DrawerOpenedDetail>(DRAWER_OPENED_EVENT, { detail: { seq } }),
  );
}

/**
 * Porta in primo piano il pannello del modulo `id`, se è aperto. Restituisce
 * false se nessun pannello ha risposto (non aperto, o senza `DrawerSlot`):
 * il chiamante può allora aprirlo come prima.
 */
export function requestDrawerFocus(id: string): boolean {
  const detail: DrawerFocusDetail = { id, handled: false };
  window.dispatchEvent(new CustomEvent<DrawerFocusDetail>(DRAWER_FOCUS_EVENT, { detail }));
  return detail.handled;
}
