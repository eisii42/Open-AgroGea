import { useAgroStore } from "@agrogea/core";

/**
 * Apertura del Riquadro comandi da qualunque punto (campo "Cerca… Ctrl K"
 * dell'header, scorciatoia da tastiera) e da qualunque vista.
 *
 * Il riquadro vive nella dashboard mappa (usa la mappa per "vai a
 * appezzamento"), che resta montata anche quando è nascosta: da Calendario o
 * Command Center si torna prima sulla mappa, poi lo si apre con un evento che
 * la dashboard ascolta.
 */
export const OPEN_COMMAND_PALETTE_EVENT = "agro:open-command-palette";

export function requestCommandPalette(): void {
  const store = useAgroStore.getState();
  if (store.activeView !== "map") store.setActiveView("map");
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}
