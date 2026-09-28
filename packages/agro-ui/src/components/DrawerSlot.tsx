import { createContext, type ReactNode } from "react";

/**
 * Pila dei pannelli laterali sul desktop: più moduli aperti insieme nella
 * colonna di destra (FieldDashboard, `.agro-drawer-dock`).
 *
 * - Ogni FieldSheet che si apre riceve un numero d'ordine crescente e lo
 *   annuncia: gli altri si riducono all'intestazione e il nuovo sta in cima.
 * - "Porta in primo piano" (`requestDrawerFocus`): il pannello del modulo già
 *   aperto si espande e torna in cima, invece di chiudersi o restare ridotto.
 *   Per sapere a quale modulo appartiene, il FieldSheet legge l'id dal
 *   `DrawerSlot` che lo avvolge.
 */

export const DrawerSlotContext = createContext<string | null>(null);

/** Avvolge il pannello di un modulo: l'id è quello del pannello nello store. */
export function DrawerSlot({ id, children }: { id: string; children: ReactNode }) {
  return <DrawerSlotContext.Provider value={id}>{children}</DrawerSlotContext.Provider>;
}

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
