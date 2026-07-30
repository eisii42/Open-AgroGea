import {
  type FieldOperationSession,
  type SessionCloseOutcome,
  useAgroStore,
} from "@agrogea/core";
import type { GeoSample } from "@agrogea/tools";
import { pathLengthMeters } from "@agrogea/tools";
import type { Position } from "geojson";
import { useCallback, useEffect, useRef } from "react";
import { loadFieldModeConfig } from "./field-mode-config";
import { useLiveGeoSample } from "./useLiveGeoSample";
import { type SessionTrack, trackOf } from "./session-track";

/** Campioni accettati dopo i quali si forza un flush (batch per conteggio). */
const FLUSH_EVERY_SAMPLES = 20;
/** Millisecondi massimi fra due flush anche sotto soglia campioni (batch per tempo). */
const FLUSH_EVERY_MS = 20_000;
/** Periodo del timer di sicurezza che flush-a un batch "vecchio" senza nuovi campioni. */
const FLUSH_TIMER_MS = 5_000;

/**
 * Accumula il tracciato GPS della sessione a bordo campo CONSUMANDO il
 * canale live di `useGeofenceWatch` (`useLiveGeoSample`, vedi
 * `live-sample-channel.ts`): nessun secondo `watchPosition`. I campioni
 * grezzi restano in una ref locale (mai nello store) e solo il risultato
 * BATCHED (path/path_length_m) raggiunge il DAL via `updateFieldSession` —
 * scrivere a ogni campione (~1 Hz) vorrebbe dire una riga di `sync_outbox`
 * al secondo, che è esattamente ciò che l'outbox non deve fare.
 *
 * Il tracciato NON stima più gli ettari lavorati durante la lavorazione: una
 * moltiplicazione `lunghezza percorsa × larghezza di lavoro` conta due volte le
 * sovrapposizioni e le manovre a capezzagna, e finiva in un registro di
 * compliance come se fosse un dato misurato. La superficie lavorata è ora
 * DICHIARATA dall'operatore alla chiusura (percentuale di completamento sulla
 * superficie totale dell'appezzamento, vedi {@link conclude}).
 *
 * Politica di persistenza (batch): flush ogni {@link FLUSH_EVERY_SAMPLES}
 * campioni accettati O ogni {@link FLUSH_EVERY_MS} ms dall'ultimo flush (il
 * primo che scatta, controllato anche da un timer di sicurezza indipendente
 * dall'arrivo di nuovi campioni), PIÙ un flush immediato su pausa/ripresa/
 * smontaggio — così un crash dell'app perde AL MASSIMO la finestra di batch
 * corrente (≤ 20 campioni o ≤ 20s di lavoro), mai l'intero tracciato.
 *
 * Durante la PAUSA (`session.status !== "IN_PROGRESS"`) i campioni non
 * allungano il tracciato: il motore ignora silenziosamente il canale live per
 * l'accumulo (resta comunque letto per il readout di velocità/posizione).
 *
 * Pausa/ripresa: un'unica scrittura combinata (coordinate pendenti + stato +
 * bookkeeping delle pause, vedi `session-track.ts`) invece di due scritture
 * separate — evita la finestra in cui una `ref` locale allo stato ancora non
 * aggiornato dallo store produrrebbe un secondo `updateFieldSession` basato
 * su un `path` stantio.
 */
export function useFieldSessionTracking(
  session: FieldOperationSession | null,
): {
  /** Velocità istantanea (km/h) dell'ultimo campione GPS live, o null. */
  speedKmh: number | null;
  /** Ultimo campione GPS ACCETTATO (accuratezza entro soglia), per il geotag delle note vocali. */
  lastAcceptedSample: GeoSample | null;
  /** Mette in pausa: flush del pending + stato PAUSED, in un'unica scrittura. */
  pause: () => Promise<void>;
  /** Riprende da una pausa: chiude l'intervallo di pausa + stato IN_PROGRESS. */
  resume: () => Promise<void>;
  /**
   * CONCLUDI: flush finale del tracciato e REGISTRAZIONE AUTOMATICA nel
   * Quaderno di Campagna. Le quantità nascono dalla superficie DICHIARATA in
   * `input`: `workedAreaHa` è la quota lavorata in QUESTA sessione (la
   * differenza fra l'avanzamento appena dichiarato e quello già registrato),
   * `completionPercent` è l'avanzamento complessivo della task — sotto il 100%
   * la task resta aperta e riprende il giorno dopo. Ritorna l'esito da mostrare
   * nel riepilogo post-operazione, o null se non c'era una sessione da chiudere.
   */
  conclude: (input: {
    workedAreaHa: number;
    completionPercent: number;
  }) => Promise<SessionCloseOutcome | null>;
  /** Forza un flush immediato del pending (usato dallo smontaggio). */
  flushNow: () => Promise<void>;
} {
  const updateFieldSession = useAgroStore((s) => s.updateFieldSession);
  const completeFieldSession = useAgroStore((s) => s.completeFieldSession);
  const { sample, speedKmh } = useLiveGeoSample();
  const configRef = useRef(loadFieldModeConfig());

  const pendingRef = useRef<Position[]>([]);
  const lastFlushAtRef = useRef<number>(Date.now());
  const lastAcceptedSampleRef = useRef<GeoSample | null>(null);
  // Sessione "fresca" ad ogni render: i callback (flush/pause/resume) sono
  // memoizzati e non devono chiudere su una versione stantia della sessione.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Filtro accuratezza applicato SUBITO in fase di render (non in un effect):
  // il geotag di una nota vocale interrotta a scatto deve vedere l'ultimo
  // campione valido SENZA un frame di ritardo. Mutare la ref qui è
  // deterministico (stesso input ⇒ stesso esito, anche sotto StrictMode) e
  // non programma alcun side-effect: è puro bookkeeping derivato dalle prop.
  if (sample && (sample.accuracy_m == null || sample.accuracy_m <= configRef.current.maxAccuracyM)) {
    lastAcceptedSampleRef.current = sample;
  }

  const flush = useCallback(
    async (
      trackPatch?: Partial<Pick<SessionTrack, "pausedMs" | "pausedSince">>,
      statusPatch?: FieldOperationSession["status"],
    ) => {
      const current = sessionRef.current;
      if (!current) return;
      const pending = pendingRef.current;
      if (pending.length === 0 && !trackPatch && !statusPatch) return;

      const track = trackOf(current);
      const coordinates =
        pending.length > 0 ? [...track.coordinates, ...pending] : track.coordinates;
      const nextTrack: SessionTrack = { ...track, coordinates, ...trackPatch };

      pendingRef.current = [];
      lastFlushAtRef.current = Date.now();

      const pathLengthM = pathLengthMeters(coordinates);
      try {
        await updateFieldSession(current.id, {
          path: nextTrack,
          path_length_m: pathLengthM,
          ...(statusPatch ? { status: statusPatch } : {}),
        });
      } catch {
        // Persistenza fallita (es. connessione al DAL interrotta a metà
        // sessione): i campioni non salvati tornano nel buffer, il prossimo
        // flush riprova con lo stesso lotto (in testa, per restare cronologici).
        pendingRef.current = [...pending, ...pendingRef.current];
      }
    },
    [updateFieldSession],
  );

  // Accumula il campione nel buffer SOLO se accettato (accuratezza entro
  // soglia, coerente col geofencing) E la sessione è IN_PROGRESS, poi
  // eventuale flush per soglia campioni/tempo. Il side-effect (push nel
  // buffer, eventuale flush) resta in un effect; il filtro accuratezza è
  // già stato applicato in fase di render (vedi sopra) e qui si rilegge la
  // ref appena aggiornata per decidere se QUESTO campione è quello accettato.
  useEffect(() => {
    if (!sample || lastAcceptedSampleRef.current !== sample) return;
    const current = sessionRef.current;
    if (!current || current.status !== "IN_PROGRESS") return; // in pausa: non allunga il tracciato

    pendingRef.current.push([sample.lon, sample.lat]);
    const dueByCount = pendingRef.current.length >= FLUSH_EVERY_SAMPLES;
    const dueByTime = Date.now() - lastFlushAtRef.current >= FLUSH_EVERY_MS;
    if (dueByCount || dueByTime) void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  // Timer di sicurezza: flush-a un batch parzialmente riempito anche senza
  // nuovi campioni (GPS intermittente), rispettando comunque FLUSH_EVERY_MS.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (pendingRef.current.length === 0) return;
      if (Date.now() - lastFlushAtRef.current < FLUSH_EVERY_MS) return;
      void flush();
    }, FLUSH_TIMER_MS);
    return () => window.clearInterval(interval);
  }, [flush]);

  // Flush best-effort allo smontaggio (chiusura dashboard/switch company).
  useEffect(() => {
    return () => {
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(async () => {
    await flush({ pausedSince: new Date().toISOString() }, "PAUSED");
  }, [flush]);

  const resume = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const track = trackOf(current);
    const since = track.pausedSince ? Date.parse(track.pausedSince) : null;
    const addedMs =
      since != null && Number.isFinite(since) ? Math.max(0, Date.now() - since) : 0;
    lastFlushAtRef.current = Date.now();
    await flush(
      { pausedMs: (track.pausedMs ?? 0) + addedMs, pausedSince: null },
      "IN_PROGRESS",
    );
  }, [flush]);

  const conclude = useCallback(
    async (input: {
      workedAreaHa: number;
      completionPercent: number;
    }): Promise<SessionCloseOutcome | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    // 1) Chiude un eventuale intervallo di pausa APERTO, così il tempo attivo
    //    mostrato dal riepilogo non conta come lavoro la pausa in corso.
    const track = trackOf(current);
    const since = track.pausedSince ? Date.parse(track.pausedSince) : null;
    const closePause =
      since != null && Number.isFinite(since)
        ? {
            pausedMs: (track.pausedMs ?? 0) + Math.max(0, Date.now() - since),
            pausedSince: null,
          }
        : undefined;
    // 2) Flush FINALE del pending: il tracciato definitivo va persistito PRIMA
    //    di comporre le righe del Quaderno (resta la prova di dove si è
    //    passati, anche se non è più lui a dettare la superficie).
    await flush(closePause);
    // 3) Registrazione AUTOMATICA nel Quaderno + chiusura di sessione e task,
    //    in un'unica transazione idempotente lato DAL. `area_worked_ha` porta
    //    la superficie DICHIARATA: è la base delle quantità del registro.
    return completeFieldSession(
      current.id,
      {
        end_time: new Date().toISOString(),
        area_worked_ha: input.workedAreaHa,
      },
      { taskCompletionPercent: input.completionPercent },
    );
    },
    [flush, completeFieldSession],
  );

  return {
    speedKmh,
    lastAcceptedSample: lastAcceptedSampleRef.current,
    pause,
    resume,
    conclude,
    flushNow: flush,
  };
}
