/**
 * Aggancio al riavvio del watch GPS, per chi mostra lo stato del rilevamento
 * senza possedere il watcher.
 *
 * Il watcher è UNO solo e vive in `useGeofenceWatch` (montato dalla dashboard
 * di mappa); il Riquadro Pianificazione Task, che è l'unico punto in cui
 * l'operatore vede se il rilevamento è armato, deve poterlo far ripartire dopo
 * un errore. Passare la funzione attraverso lo store globale significherebbe
 * metterci dentro una callback — che non è stato — quindi si usa lo stesso
 * meccanismo minimale del canale dei campioni live (`live-sample-channel.ts`):
 * un registro a livello di modulo, fuori da React e fuori da Zustand.
 */

let retryFn: (() => void) | null = null;

/** Registra (o sgancia, con `null`) la funzione di riavvio del watch attivo. */
export function registerGeofenceRetry(fn: (() => void) | null): void {
  retryFn = fn;
}

/**
 * Richiede il riavvio del watch GPS. No-op se nessun watcher è montato (es. la
 * dashboard di mappa non è mai stata aperta): non è un errore, semplicemente
 * non c'è nulla da riavviare.
 */
export function requestGeofenceRetry(): void {
  retryFn?.();
}
