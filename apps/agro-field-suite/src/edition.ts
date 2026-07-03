/**
 * Hook di inizializzazione dell'edizione, invocato dal bootstrap in `main.tsx`
 * prima del primo render. Un'eventuale edizione con servizi remoti registra
 * qui il proprio adapter (`registerControlPlane` in @agrogea/core) e ogni
 * altra inizializzazione che le serve.
 *
 * Edizione standalone/OSS: l'app è puramente locale, nulla da inizializzare.
 */
export async function initEdition(): Promise<void> {}
