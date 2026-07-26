/**
 * Sicurezza del tempo di rientro PAN ("re-entry interval"): finestre ANCORA
 * APERTE in cui un appezzamento trattato non andrebbe rieseguito senza DPI,
 * derivate dal registro trattamenti (`treatment_logs`). Motore PURO come gli
 * altri di `@agrogea/tools`: nessun accesso al DB, il DAL/store passa le
 * righe già lette. Il tipo d'ingresso è una forma strutturale minima
 * (compatibile con `TreatmentLog` di `@agrogea/core`, mai importato qui) per
 * non accoppiare i pacchetti.
 *
 * Uso: alla rilevazione dell'ingresso in un plot (geofencing), la
 * modale di rilevamento chiama {@link reentryWindowForPlot} sui trattamenti
 * dell'azienda per mostrare un banner di allerta — un AVVISO, non un blocco:
 * l'operatore che ha eseguito il trattamento può legittimamente rientrare con
 * i DPI; il requisito è avvisare gli ALTRI operatori.
 */

/** Riga di registro nella forma minima necessaria (strutturalmente compatibile con TreatmentLog). */
export interface ReentryLogInput {
  plot_id: string | null;
  executed_at: string;
  reentry_interval_h: number | null;
  product_name?: string | null;
  operation_type?: string | null;
}

export interface ReentryWindow {
  plotId: string;
  /** ISO di scadenza = executed_at + reentry_interval_h. */
  until: string;
  /** Ore residue (arrotondate per eccesso, minimo 1). */
  hoursRemaining: number;
  productName: string | null;
  executedAt: string;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Finestre di rientro ANCORA APERTE, UNA per appezzamento (la più
 * restrittiva: scadenza più lontana nel tempo, se più trattamenti aperti
 * insistono sullo stesso plot), ordinate per scadenza più lontana. Righe
 * ignorate: `reentry_interval_h` nullo/non positivo, `plot_id` nullo, data di
 * esecuzione non interpretabile, finestra già scaduta rispetto a `now`.
 */
export function activeReentryWindows(
  logs: ReentryLogInput[],
  now: number,
): ReentryWindow[] {
  const byPlot = new Map<string, { window: ReentryWindow; untilMs: number }>();
  for (const log of logs) {
    if (!log.plot_id) continue;
    if (log.reentry_interval_h == null || log.reentry_interval_h <= 0) continue;
    const executedMs = Date.parse(log.executed_at);
    if (!Number.isFinite(executedMs)) continue;
    const untilMs = executedMs + log.reentry_interval_h * MS_PER_HOUR;
    if (untilMs <= now) continue; // finestra già scaduta

    const current = byPlot.get(log.plot_id);
    if (current && current.untilMs >= untilMs) continue; // già una più restrittiva

    byPlot.set(log.plot_id, {
      untilMs,
      window: {
        plotId: log.plot_id,
        until: new Date(untilMs).toISOString(),
        hoursRemaining: Math.max(1, Math.ceil((untilMs - now) / MS_PER_HOUR)),
        productName: log.product_name ?? null,
        executedAt: log.executed_at,
      },
    });
  }
  return Array.from(byPlot.values())
    .sort((a, b) => b.untilMs - a.untilMs)
    .map((entry) => entry.window);
}

/** La finestra aperta più restrittiva (scadenza più lontana) sull'appezzamento, o null. */
export function reentryWindowForPlot(
  logs: ReentryLogInput[],
  plotId: string,
  now: number,
): ReentryWindow | null {
  return activeReentryWindows(logs, now).find((w) => w.plotId === plotId) ?? null;
}
