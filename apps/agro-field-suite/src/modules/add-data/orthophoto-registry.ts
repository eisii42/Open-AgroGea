/**
 * Ortofoto caricate da "Aggiungi dati", disponibili anche al modulo Normativa.
 *
 * ## Perché un registro e non due caricamenti
 *
 * Le stesse ortofoto servono a due cose diverse: **guardarle** sulla mappa e
 * **misurarci sopra** nella scheda BCAA 8. Chiedere all'utente di caricare due
 * volte lo stesso file da centinaia di megabyte sarebbe assurdo.
 *
 * Qui si tiene l'oggetto `File`, che è un **riferimento ai byte su disco**, non
 * i byte: costa nulla tenerlo, e chi ne ha bisogno lo rilegge come vuole — la
 * mappa a risoluzione ridotta per la texture, la BCAA 8 a piena risoluzione e
 * ritagliata sull'appezzamento. Nessuno dei due paga il lavoro dell'altro.
 *
 * Il registro è **di sessione**: chiudere l'applicazione lo svuota. È
 * deliberato — un'ortofoto è un file dell'utente, non un dato dell'azienda, e
 * persisterla vorrebbe dire decidere per lui che va conservata.
 */

export interface RegisteredOrthophoto {
  /** Id del layer di mappa corrispondente, per collegare le due viste. */
  layerId: string;
  file: File;
  /** Risoluzione originale al suolo, in metri. */
  gsdM: number;
  addedAt: string;
}

const registry = new Map<string, RegisteredOrthophoto>();
const listeners = new Set<() => void>();

/**
 * Elenco ordinato, ricostruito SOLO quando il registro cambia. È lo snapshot di
 * `useSyncExternalStore`: se ogni lettura restituisse un array nuovo, React lo
 * vedrebbe sempre "cambiato" e ri-renderizzerebbe all'infinito ("getSnapshot
 * should be cached" → "Maximum update depth exceeded"), smontando l'app
 * all'apertura del modulo Normativa.
 */
let snapshot: RegisteredOrthophoto[] = [];

function notify(): void {
  snapshot = [...registry.values()].sort((a, b) =>
    a.addedAt.localeCompare(b.addedAt),
  );
  for (const listener of listeners) listener();
}

export function registerOrthophoto(entry: RegisteredOrthophoto): void {
  registry.set(entry.layerId, entry);
  notify();
}

export function unregisterOrthophoto(layerId: string): void {
  if (registry.delete(layerId)) notify();
}

/** Ortofoto registrate, dalla più vecchia: stesso array finché nulla cambia. */
export function listOrthophotos(): RegisteredOrthophoto[] {
  return snapshot;
}

/** Sottoscrizione per `useSyncExternalStore`. */
export function subscribeOrthophotos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Solo per i test: riporta il registro allo stato iniziale. */
export function resetOrthophotoRegistry(): void {
  registry.clear();
  notify();
}
