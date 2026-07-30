import {
  formatArea,
  waterUnitLabel,
  useAgroStore,
  useReadOnly,
  useSettingsStore,
} from "@agrogea/core";
import { formatElapsedClock, sessionElapsedMs } from "@agrogea/tools";
import { cn } from "@geolibre/ui";
import { AlertTriangle, Mic, Pause, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { taskOperationLabel } from "../tasks/TaskForm";
import { AudioNotesList } from "./AudioNotesList";
import { SessionCompletionSheet } from "./SessionCompletionSheet";
import { pausedMsOf, pausedSinceOf } from "./session-track";
import { useActiveFieldSession } from "./useActiveFieldSession";
import { useFieldSessionTracking } from "./useFieldSessionTracking";
import { useVoiceNoteRecorder } from "./useVoiceNoteRecorder";

/**
 * Schermo LOW-TOUCH a bordo campo: massimo contrasto, numeri enormi,
 * controlli tattili > 80px — pensato per essere letto al sole diretto dal
 * sedile del trattore e toccato coi guanti, non per essere "bello".
 *
 * ECCEZIONE DELIBERATA ai token di tema (`var(--panel)`, `var(--accent)`…):
 * questo schermo ignora l'App Theme e usa una palette FISSA nero/verde-lime/
 * giallo fluorescente, hard-coded. Non è un pannello brandizzato ma uno
 * strumento di guida ad alta leggibilità — chiaro/scuro e temi utente non si
 * applicano a un tachimetro. È l'unico punto della codebase dove questo è
 * giustificato: ogni altro componente resta sui token condivisi.
 *
 * Si monta SEMPRE a livello di App (vedi `App.tsx`), non dentro un pannello
 * apribile/chiudibile: appare da sé quando lo store ha una sessione ATTIVA
 * (IN_PROGRESS o PAUSED, vedi `useActiveFieldSession`) e resta a tutto
 * schermo con lo z-index più alto dell'app finché la sessione non è
 * conclusa/abbandonata. Avviare una sessione dalla `FieldDetectionModal`
 * fa apparire QUESTO schermo, non una vista di conferma dentro la modale.
 */
export function InFieldDashboard() {
  const { t } = useTranslation();
  const { session, plot } = useActiveFieldSession();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const units = useSettingsStore((s) => s.units);
  const recipes = useAgroStore((s) => s.recipes);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const abortFieldSession = useAgroStore((s) => s.abortFieldSession);
  const setSessionCloseOutcome = useAgroStore((s) => s.setSessionCloseOutcome);

  const tracking = useFieldSessionTracking(session);
  const voice = useVoiceNoteRecorder(session, tracking.lastAcceptedSample);

  const [concluding, setConcluding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [aborting, setAborting] = useState(false);

  // Task programmata da cui nasce la sessione: porta i dettagli pianificati
  // (lavorazione, semente, apporto irriguo) e l'avanzamento già dichiarato.
  const task = useMemo(
    () =>
      session?.planned_task_id
        ? (plannedTasks.find((x) => x.id === session.planned_task_id) ?? null)
        : null,
    [plannedTasks, session],
  );

  // Descrizione di COSA si sta facendo, dai dati già pianificati: sostituisce
  // la stima automatica degli ettari, che prometteva una precisione che il
  // GPS non aveva.
  const activityDetail = useMemo(() => {
    if (!session) return null;
    const parts: string[] = [];
    const recipe = session.recipe_id
      ? recipes.find((r) => r.id === session.recipe_id)
      : null;
    if (recipe) {
      parts.push(recipe.name);
      for (const line of recipe.products) {
        parts.push(`${line.product_name} ${line.dose_per_ha} ${line.unit}`);
      }
    }
    const meta = task?.metadata ?? {};
    if (meta.tillage_type) parts.push(meta.tillage_type);
    if (meta.seed_product_name) {
      parts.push(
        meta.seed_dose != null
          ? `${meta.seed_product_name} · ${meta.seed_dose} ${meta.seed_dose_unit ?? "kg/ha"}`
          : meta.seed_product_name,
      );
    }
    if (meta.irrigation_amount != null) {
      parts.push(
        `${meta.irrigation_amount} ${waterUnitLabel(meta.irrigation_unit ?? "mm")}`,
      );
    }
    const target = task?.target_pest_or_disease ?? recipe?.target_disease ?? null;
    if (target) parts.push(target);
    if (task?.notes) parts.push(task.notes);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [session, recipes, task]);

  const previousPercent = useMemo(() => {
    const value = task?.metadata.completion_percent;
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0;
  }, [task]);

  // Orologio del tempo trascorso: tick indipendente dai campioni GPS (deve
  // avanzare anche senza un fix nuovo), un secondo alla volta.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedMs = useMemo(
    () =>
      session
        ? sessionElapsedMs(
            session.start_time,
            pausedMsOf(session),
            pausedSinceOf(session),
            nowMs,
          )
        : 0,
    [session, nowMs],
  );

  // Nessuna sessione active: schermo assente (nessun overlay, nessun costo).
  if (!session) return null;

  const isPaused = session.status === "PAUSED";
  const disabled = readOnly;
  // TS non propaga il narrowing di `session` dentro le funzioni annidate
  // sotto (handleAbort): una const locale rende esplicito l'id valido.
  const sessionId = session.id;

  async function handleTogglePause() {
    if (disabled) return;
    if (isPaused) {
      await tracking.resume();
    } else {
      await tracking.pause();
    }
  }

  async function handleConclude(input: {
    workedAreaHa: number;
    completionPercent: number;
  }) {
    if (disabled || concluding) return;
    setConcluding(true);
    try {
      // La chiusura REGISTRA da sé nel Quaderno (zero tocchi) e porta la
      // sessione a COMPLETED: questo schermo si smonta subito dopo, e il
      // riepilogo vive nello store (`sessionCloseOutcome`) proprio per
      // sopravvivere a quello smontaggio. La TASK invece resta aperta se
      // l'avanzamento dichiarato è parziale.
      const outcome = await tracking.conclude(input);
      if (outcome) {
        setCompleting(false);
        setSessionCloseOutcome(outcome);
      }
    } finally {
      setConcluding(false);
    }
  }

  async function handleAbort() {
    if (disabled || aborting) return;
    // Distruttivo (getta il tracciato accumulato): conferma esplicita, come
    // richiesto per l'unica azione irreversibile di questo schermo.
    if (!window.confirm(t("fieldMode.dashboard.abortConfirm"))) return;
    setAborting(true);
    try {
      await tracking.flushNow();
      await abortFieldSession(sessionId);
    } finally {
      setAborting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-black text-lime-400">
      {/* Niente pulsante di chiusura in testata: l'unica uscita da questo
          schermo è PAUSA/CONCLUDI/Annulla — mai un tap fuori posto o un Esc
          accidentale mentre si sta lavorando il field. */}
      <header className="flex items-center justify-between gap-3 border-b border-lime-400/30 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-yellow-300">
            {plot?.user_plot_name ?? t("fieldMode.dashboard.unknownPlot")}
          </p>
          <p className="truncate text-sm text-lime-400/80">
            {taskOperationLabel(t, session.operation_type)}
          </p>
        </div>
        {isPaused && (
          <span className="shrink-0 rounded-full border border-yellow-300 px-3 py-1 text-xs font-bold uppercase tracking-wider text-yellow-300">
            {t("fieldMode.dashboard.pausedBadge")}
          </span>
        )}
      </header>

      {readOnly && (
        <p className="mx-5 mt-4 rounded-xl border border-lime-400/40 px-4 py-2 text-sm text-lime-400/80">
          {t("fieldMode.dashboard.readOnly")}
        </p>
      )}

      <main className="flex flex-1 flex-col justify-center gap-4 px-5 py-6">
        <div className="grid grid-cols-2 gap-4">
          <Readout
            label={t("fieldMode.dashboard.speed")}
            value={`${tracking.speedKmh != null ? tracking.speedKmh.toFixed(1) : "—"} km/h`}
          />
          {/* Al posto degli ettari stimati: cosa si sta facendo e su quale
              superficie totale. Gli ettari lavorati si dichiarano alla fine
              (vedi SessionCompletionSheet), non si indovinano dal tracciato. */}
          <ActivityBrief
            title={taskOperationLabel(t, session.operation_type)}
            detail={activityDetail}
            areaLabel={t("fieldMode.dashboard.plotArea")}
            areaValue={formatArea(plot?.area_ha ?? null, units.area, 2)}
            progressLabel={
              previousPercent > 0
                ? t("fieldMode.dashboard.previousProgress", {
                    percent: previousPercent,
                  })
                : null
            }
          />
        </div>
        <Readout
          label={t("fieldMode.dashboard.elapsed")}
          value={formatElapsedClock(elapsedMs)}
          big
        />

        <AudioNotesList notes={session.audio_notes} />

        {voice.errorMessage && (
          <p className="rounded-lg border border-red-400 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {voice.errorMessage}
          </p>
        )}
      </main>

      {/* Controlli tattili: tutti > 80px, per l'uso coi guanti dal sedile. */}
      <footer className="flex flex-col gap-3 border-t border-lime-400/30 px-5 py-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleTogglePause()}
            className="flex min-h-[88px] items-center justify-center gap-2 rounded-2xl border-4 border-yellow-300 text-xl font-extrabold uppercase tracking-wide text-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPaused ? <Play size={28} /> : <Pause size={28} />}
            {isPaused ? t("fieldMode.dashboard.resume") : t("fieldMode.dashboard.pause")}
          </button>
          <button
            type="button"
            disabled={disabled || concluding}
            onClick={() => setCompleting(true)}
            className="flex min-h-[88px] items-center justify-center gap-2 rounded-2xl bg-lime-400 text-xl font-extrabold uppercase tracking-wide text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("fieldMode.dashboard.conclude")}
          </button>
        </div>

        {/* Nota vocale: tocco-tocco (avvia/ferma), non pressione prolungata —
            più sicuro coi guanti da campo (vedi useVoiceNoteRecorder). */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => void (voice.recording ? voice.stop() : voice.start())}
          className={cn(
            "flex min-h-[88px] items-center justify-center gap-3 rounded-2xl border-4 text-xl font-extrabold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40",
            voice.recording
              ? "animate-pulse border-red-400 text-red-400"
              : "border-lime-400 text-lime-400",
          )}
        >
          {voice.recording ? <Square size={28} /> : <Mic size={28} />}
          {voice.recording
            ? t("fieldMode.dashboard.recordingStop", { seconds: voice.elapsedS })
            : t("fieldMode.dashboard.recordStart")}
        </button>

        <button
          type="button"
          disabled={disabled || aborting}
          onClick={() => void handleAbort()}
          className="flex min-h-[44px] items-center justify-center gap-1.5 self-center px-4 text-sm font-semibold text-red-400/90 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AlertTriangle size={16} />
          {t("fieldMode.dashboard.abort")}
        </button>
      </footer>

      {/* CONCLUDI non chiude più da solo: prima si dichiara quanto si è
          lavorato (ed è quella dichiarazione a fare da superficie nel
          Quaderno e da avanzamento della task). */}
      {completing && (
        <SessionCompletionSheet
          plotName={plot?.user_plot_name ?? t("fieldMode.dashboard.unknownPlot")}
          plotAreaHa={plot?.area_ha ?? null}
          previousPercent={previousPercent}
          saving={concluding}
          onCancel={() => setCompleting(false)}
          onConfirm={(input) => void handleConclude(input)}
        />
      )}
    </div>
  );
}

/**
 * Riquadro "attività in corso": il tipo di lavorazione con i dettagli già
 * pianificati e la superficie TOTALE dell'appezzamento, che è il riferimento
 * rispetto a cui l'operatore giudica il proprio avanzamento.
 */
function ActivityBrief({
  title,
  detail,
  areaLabel,
  areaValue,
  progressLabel,
}: {
  title: string;
  detail: string | null;
  areaLabel: string;
  areaValue: string;
  progressLabel: string | null;
}) {
  return (
    <div className="flex flex-col justify-center gap-1 rounded-2xl border border-lime-400/30 bg-lime-400/5 px-4 py-4">
      <span className="text-xs font-semibold uppercase tracking-widest text-lime-400/70">
        {areaLabel}
      </span>
      <span className="text-3xl font-black tabular-nums text-yellow-300">
        {areaValue}
      </span>
      <span className="mt-1 text-base font-bold leading-tight text-lime-300">
        {title}
      </span>
      {detail && (
        <span className="text-sm leading-tight text-lime-400/80">{detail}</span>
      )}
      {progressLabel && (
        <span className="mt-1 text-sm font-semibold text-yellow-300">
          {progressLabel}
        </span>
      )}
    </div>
  );
}

function Readout({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-lime-400/30 bg-lime-400/5 py-5">
      <span className="text-xs font-semibold uppercase tracking-widest text-lime-400/70">
        {label}
      </span>
      <span
        className={cn(
          "font-black tabular-nums text-yellow-300",
          big ? "text-7xl" : "text-5xl",
        )}
      >
        {value}
      </span>
    </div>
  );
}
