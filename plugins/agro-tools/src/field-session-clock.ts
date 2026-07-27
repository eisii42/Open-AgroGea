/**
 * Orologio PURO della sessione a bordo campo (Modalità Campo low-touch):
 * calcolo del tempo trascorso ESCLUDENDO le pause, e sua formattazione per il
 * readout dell'InFieldDashboard. Nessun accesso a `Date.now()`/timer qui (il
 * "now" è sempre passato dal chiamante): è così che resta deterministico e
 * testabile come il resto di `@agrogea/tools`.
 *
 * La sessione a bordo campo (`field_operation_sessions`) non porta una colonna
 * dedicata al tempo di pausa: il bookkeeping (`pausedMs` cumulato dalle pause
 * già concluse + `pausedSince` della pausa CORRENTE, se in corso) vive come
 * chiavi aggiuntive nello stesso jsonb `path` già persistito (vedi
 * `apps/agro-field-suite/src/modules/field-mode/session-track.ts`), non in
 * una colonna nuova. Qui si conosce solo la matematica: dati `start_time`,
 * `pausedMs` e l'eventuale `pausedSince` ancora aperto, quanto tempo ATTIVO è
 * trascorso a un istante `nowMs` — la stessa formula funziona identica prima e
 * dopo un riavvio dell'app, perché `pausedMs`/`pausedSince` sono persistiti.
 */

/**
 * Millisecondi di lavoro trascorsi dall'avvio della sessione, al netto delle
 * pause: `now - start_time - pausedMs - (pausa corrente se ancora aperta)`.
 * Se la sessione è CORRENTEMENTE in pausa (`pausedSince` valorizzato), il
 * risultato resta congelato nel tempo (la pausa in corso cresce alla stessa
 * velocità di `now`, annullandosi nella differenza) — esattamente il
 * comportamento atteso dal readout "tempo trascorso" mentre è in PAUSA.
 */
export function sessionElapsedMs(
  startTime: string | Date,
  pausedMs: number,
  pausedSince: string | Date | null | undefined,
  nowMs: number,
): number {
  // `new Date(...)` e non `Date.parse(...)`: `start_time` arriva come oggetto
  // `Date` quando la sessione è stata riletta da PGlite, e `Date.parse` su un
  // `Date` funziona solo per coercizione via `toString()` (millisecondi persi).
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start)) return 0;
  let totalPausedMs = Number.isFinite(pausedMs) ? pausedMs : 0;
  if (pausedSince) {
    const since = new Date(pausedSince).getTime();
    if (Number.isFinite(since)) {
      totalPausedMs += Math.max(0, nowMs - since);
    }
  }
  return Math.max(0, nowMs - start - totalPausedMs);
}

/**
 * Formatta millisecondi come orologio `m:ss` (o `h:mm:ss` oltre l'ora), per il
 * readout gigante del tempo trascorso a bordo campo. Sempre a due cifre per
 * minuti/secondi tranne le ore iniziali (mai "01:23:45", ma "1:23:45").
 */
export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
