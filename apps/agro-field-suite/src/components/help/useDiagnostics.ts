import { useAgroStore } from "@agrogea/core";
import { useMemo } from "react";

/**
 * Aggrega gli avvisi diagnostici attivi della suite a partire da segnali REALI
 * dello store (niente conteggi inventati): fallimento del Sync Engine, mutazioni
 * orfane accumulate nell'outbox PGlite (`sync_applied_mutations`) e meteo non
 * ancora idratato per l'azienda attiva. Il conteggio alimenta il badge rosso del
 * Menu di Aiuto; la lista è mostrata nel modal di Diagnostica.
 */

export type DiagnosticSeverity = "error" | "warn";

export interface DiagnosticIssue {
  id: string;
  severity: DiagnosticSeverity;
  /** Chiave i18n del titolo dell'avviso. */
  titleKey: "help.diagnosticsModal.syncError" | "help.diagnosticsModal.pendingQueue" | "help.diagnosticsModal.weatherMissing";
  /** Valore di interpolazione `{{count}}` per il titolo (es. coda outbox). */
  count?: number;
  /** Riga di dettaglio in testo libero (es. messaggio d'errore di sync). */
  detail?: string;
}

export interface Diagnostics {
  count: number;
  issues: DiagnosticIssue[];
}

export function useDiagnostics(): Diagnostics {
  const sync = useAgroStore((s) => s.sync);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const configMeteo = useAgroStore((s) => s.configMeteo);

  return useMemo(() => {
    const issues: DiagnosticIssue[] = [];

    if (sync.state === "error") {
      issues.push({
        id: "sync-error",
        severity: "error",
        titleKey: "help.diagnosticsModal.syncError",
        detail: sync.lastError ?? undefined,
      });
    }

    if (sync.pendingCount > 0) {
      issues.push({
        id: "sync-pending",
        severity: "warn",
        titleKey: "help.diagnosticsModal.pendingQueue",
        count: sync.pendingCount,
      });
    }

    // Azienda attiva senza configurazione meteo: il DSS/cache meteo non parte.
    if (aziendaAttivaId && !configMeteo) {
      issues.push({
        id: "weather-missing",
        severity: "warn",
        titleKey: "help.diagnosticsModal.weatherMissing",
      });
    }

    return { count: issues.length, issues };
  }, [sync.state, sync.lastError, sync.pendingCount, aziendaAttivaId, configMeteo]);
}
