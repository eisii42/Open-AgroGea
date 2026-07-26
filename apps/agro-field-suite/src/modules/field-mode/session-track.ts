import type { LineString, Position } from "geojson";
import type { FieldOperationSession } from "@agrogea/core";

/**
 * Estensione del `path` GeoJSON della sessione con il bookkeeping delle
 * pause. NON è una colonna di schema nuova: `pausedMs`/`pausedSince` sono due
 * chiavi aggiuntive nello STESSO jsonb `field_operation_sessions.path` già
 * persistito (colonna esistente dallo schema v19). Un consumer che si
 * aspetta un LineString "puro" (una futura resa in mappa, un export) ignora
 * semplicemente le chiavi in più: `type`/`coordinates` restano un LineString
 * a tutti gli effetti.
 *
 * Perché qui e non una colonna dedicata: il tempo di pausa è ESATTAMENTE
 * bookkeeping sulla stessa timeline del tracciato (quando il tracciato si
 * ferma/riparte), quindi vive accanto ad esso invece che sparso in un altro
 * campo della sessione (es. `notes`, che resta libero per il testo
 * dell'operatore nel riepilogo post-operazione, step successivo). La
 * matematica pura (quanto tempo attivo è trascorso dati questi due valori) è
 * in `sessionElapsedMs` (`@agrogea/tools`), testata in isolamento.
 */
export interface SessionTrack extends LineString {
  /** Totale ms di pausa già CONCLUSE (somma delle pause precedenti chiuse). */
  pausedMs?: number;
  /** ISO dell'inizio della pausa CORRENTE, o assente/null se non in pausa. */
  pausedSince?: string | null;
}

/** Il `path` della sessione, visto con le chiavi di pausa aggiuntive. */
export function trackOf(session: FieldOperationSession): SessionTrack {
  return session.path as SessionTrack;
}

export function pausedMsOf(session: FieldOperationSession): number {
  return trackOf(session).pausedMs ?? 0;
}

export function pausedSinceOf(session: FieldOperationSession): string | null {
  return trackOf(session).pausedSince ?? null;
}

/** Coordinate correnti del tracciato (array vuoto se la sessione è appena partita). */
export function coordinatesOf(session: FieldOperationSession): Position[] {
  return trackOf(session).coordinates ?? [];
}
