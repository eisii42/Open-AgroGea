import {
  evaluateLogCompleteness,
  formatArea,
  toEpochMs,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { formatElapsedClock, sessionElapsedMs } from "@agrogea/tools";
import { AlertTriangle, CheckCircle2, NotebookPen } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AudioNotesList } from "./AudioNotesList";
import { pausedMsOf } from "./session-track";

/**
 * Riepilogo POST-operazione: la schermata che chiude la Modalità Campo
 * low-touch. Non è una conferma — quando appare, la lavorazione è GIÀ
 * registrata nel Quaderno di Campagna (scrittura automatica a zero tocchi,
 * scelta di prodotto): qui si NOTIFICA cosa è stato salvato. Il pulsante di
 * chiusura chiude soltanto lo schermo, non conferma né annulla la scrittura.
 *
 * Stessa palette fissa nero/lime/giallo dell'InFieldDashboard: si è ancora a
 * bordo campo, in pieno sole, magari coi guanti (vedi la nota sull'eccezione
 * ai token di tema in `InFieldDashboard.tsx`).
 *
 * Mostra ciò che l'operatore non può ricalcolare a mente: la superficie
 * realmente percorsa dal GPS, la durata attiva (netto pause) e le quantità di
 * product ricalcolate su quella superficie. E soprattutto SEGNALA ciò che
 * resta da sistemare (fallback della superficie, magazzino non scaricato,
 * campi PAN ancora mancanti): con una scrittura automatica, questo riquadro è
 * l'unico momento in cui l'operatore può accorgersene.
 */
export function PostOperationSummary() {
  const { t } = useTranslation();
  const outcome = useAgroStore((s) => s.sessionCloseOutcome);
  const dismiss = useAgroStore((s) => s.dismissSessionCloseOutcome);
  const plots = useAgroStore((s) => s.plots);
  const openLogbookForPlot = useAgroStore((s) => s.openLogbookForPlot);
  const units = useSettingsStore((s) => s.units);

  // Righe del Quaderno che, pur scritte, restano non conformi: il motore di
  // completezza le rivaluta in modalità AUDIT (lì la data e la quantità totale
  // non sono più "si risolvono all'esecuzione" ma obbligatorie).
  const incompleteFields = useMemo(() => {
    if (!outcome) return [];
    return outcome.treatments.flatMap((log) =>
      evaluateLogCompleteness(log)
        .missing.filter((f) => f.severity === "blocking")
        .map((f) => f.field),
    );
  }, [outcome]);

  if (!outcome) return null;

  const {
    session,
    treatments,
    warnings,
    areaUsedHa,
    completionPercent,
    taskStillOpen,
    assignedCropName,
  } = outcome;
  const plot = plots.find((p) => p.id === session.plot_id) ?? null;
  // `end_time`/`start_time` possono essere `Date` (row riletta da PGlite):
  // `toEpochMs` copre entrambe le forme senza perdere i millisecondi.
  const endMs = toEpochMs(session.end_time);
  const elapsedMs = endMs
    ? sessionElapsedMs(session.start_time, pausedMsOf(session), null, endMs)
    : 0;
  const uniqueIncomplete = [...new Set(incompleteFields)];
  const hasAttention = warnings.length > 0 || uniqueIncomplete.length > 0;

  return (
    <div className="fixed inset-0 z-[110] flex flex-col overflow-y-auto bg-black text-lime-400">
      <header className="flex items-center gap-3 border-b border-lime-400/30 px-5 py-5">
        <CheckCircle2 size={34} className="shrink-0 text-lime-400" />
        <div className="min-w-0">
          <p className="text-xl font-extrabold uppercase tracking-wide text-lime-400">
            {t("fieldMode.summary.title")}
          </p>
          <p className="truncate text-sm text-lime-400/80">
            {plot?.user_plot_name ?? t("fieldMode.dashboard.unknownPlot")}
          </p>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-5 py-5">
        {/* Già registrato: l'affermazione principale dello schermo. */}
        <p className="flex items-start gap-2 rounded-xl border-2 border-lime-400 bg-lime-400/10 px-4 py-3 text-base font-semibold text-lime-300">
          <NotebookPen size={22} className="mt-0.5 shrink-0" />
          {t("fieldMode.summary.registered", { count: treatments.length })}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <Metric
            label={t("fieldMode.summary.areaWorked")}
            value={formatArea(areaUsedHa, units.area, 2)}
          />
          <Metric
            label={t("fieldMode.summary.duration")}
            value={formatElapsedClock(elapsedMs)}
          />
        </div>

        {/* Sorte della TASK: chiusa, oppure ancora programmata perché il
            lavoro riprende domani. È l'informazione che decide se domani il
            geofencing la riproporrà. */}
        {completionPercent != null && (
          <p
            className={
              taskStillOpen
                ? "rounded-xl border-2 border-yellow-300 bg-yellow-300/10 px-4 py-3 text-base font-semibold text-yellow-200"
                : "rounded-xl border border-lime-400/40 px-4 py-3 text-base text-lime-300"
            }
          >
            {taskStillOpen
              ? t("fieldMode.summary.taskStillOpen", {
                  percent: completionPercent,
                })
              : t("fieldMode.summary.taskCompleted", {
                  percent: completionPercent,
                })}
          </p>
        )}

        {/* Semina su field libero: la coltura dell'annata è stata creata da
            sé, come per una semina registrata a mano nel Quaderno. */}
        {assignedCropName && (
          <p className="rounded-xl border border-lime-400/40 px-4 py-3 text-base text-lime-300">
            {t("fieldMode.summary.cropAssigned", { crop: assignedCropName })}
          </p>
        )}

        {/* Quantità ricalcolate: dose × superficie GPS, una riga per product. */}
        {treatments.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-lime-400/70">
              {t("fieldMode.summary.quantitiesHeading")}
            </p>
            <ul className="flex flex-col gap-2">
              {treatments.map((log) => (
                <li
                  key={log.id}
                  className="flex items-baseline justify-between gap-3 rounded-xl border border-lime-400/30 px-4 py-3"
                >
                  <span className="min-w-0 truncate text-base text-lime-300">
                    {log.product_name ?? t("fieldMode.summary.noProduct")}
                  </span>
                  <span className="shrink-0 font-black tabular-nums text-yellow-300">
                    {log.total_quantity != null
                      ? `${log.total_quantity} ${log.dose_unit ?? ""}`.trim()
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {session.audio_notes.length > 0 && (
          <AudioNotesList notes={session.audio_notes} />
        )}

        {/* Da sistemare: con la scrittura automatica è l'unico avviso che
            l'operatore riceve. */}
        {hasAttention && (
          <section className="flex flex-col gap-2 rounded-xl border-2 border-yellow-300 bg-yellow-300/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-yellow-200">
              <AlertTriangle size={18} className="shrink-0" />
              {t("fieldMode.summary.attentionHeading")}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-yellow-200/90">
              {warnings.map((w, index) => (
                <li key={`${w.kind}-${index}`}>
                  {t(`fieldMode.summary.warning.${w.kind}` as never, {
                    product: w.productName ?? "",
                  })}
                </li>
              ))}
              {uniqueIncomplete.length > 0 && (
                <li>
                  {t("fieldMode.summary.warning.incompleteFields", {
                    count: uniqueIncomplete.length,
                  })}
                </li>
              )}
            </ul>
            {session.plot_id && (
              <button
                type="button"
                onClick={() => {
                  openLogbookForPlot(session.plot_id);
                  dismiss();
                }}
                className="mt-1 min-h-[56px] rounded-xl border-2 border-yellow-300 px-4 text-base font-bold uppercase tracking-wide text-yellow-200"
              >
                {t("fieldMode.summary.openLogbook")}
              </button>
            )}
          </section>
        )}
      </main>

      <footer className="border-t border-lime-400/30 px-5 py-5">
        <button
          type="button"
          onClick={dismiss}
          className="flex min-h-[88px] w-full items-center justify-center rounded-2xl bg-lime-400 text-xl font-extrabold uppercase tracking-wide text-black"
        >
          {t("fieldMode.summary.done")}
        </button>
      </footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-lime-400/30 bg-lime-400/5 py-5">
      <span className="text-xs font-semibold uppercase tracking-widest text-lime-400/70">
        {label}
      </span>
      <span className="mt-1 text-3xl font-black tabular-nums text-yellow-300">
        {value}
      </span>
    </div>
  );
}
