import { formatArea, useSettingsStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** Scatti rapidi di avanzamento: coi guanti si tocca, non si trascina di precisione. */
const QUICK_STEPS = [25, 50, 75, 100];

/**
 * Dichiarazione dell'avanzamento alla chiusura di una sessione a bordo campo.
 *
 * Sostituisce la stima automatica degli ettari lavorati: la superficie che
 * finisce nel Quaderno (e quindi le quantità di prodotto e lo scarico di
 * magazzino) è la QUOTA DICHIARATA della superficie totale dell'appezzamento,
 * non una moltiplicazione fra tracciato GPS e larghezza di lavoro.
 *
 * Sotto il 100% la task NON si chiude: torna programmata con l'avanzamento
 * registrato, così il giorno dopo il geofencing la ripropone e si riprende da
 * dove si era rimasti. Il lavoro di oggi è comunque già nel Quaderno.
 *
 * Stessa palette fissa nero/lime/giallo dell'InFieldDashboard (vedi la nota
 * sull'eccezione ai token di tema in `InFieldDashboard.tsx`): si è ancora sul
 * trattore, in pieno sole.
 */
export function SessionCompletionSheet({
  plotName,
  plotAreaHa,
  previousPercent,
  saving,
  onCancel,
  onConfirm,
}: {
  plotName: string;
  /** Superficie totale dell'appezzamento (ha): la base di ogni percentuale. */
  plotAreaHa: number | null;
  /** Avanzamento già registrato da sessioni precedenti sulla stessa task (0..100). */
  previousPercent: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (input: { workedAreaHa: number; completionPercent: number }) => void;
}) {
  const { t } = useTranslation();
  const units = useSettingsStore((s) => s.units);
  // Default 100%: il caso normale è "ho finito"; chi si ferma a metà lo dice.
  const [percent, setPercent] = useState(100);

  const areaHa = plotAreaHa != null && plotAreaHa > 0 ? plotAreaHa : 0;
  // Quota lavorata OGGI = avanzamento dichiarato − avanzamento già registrato:
  // è quella che moltiplica le dosi, altrimenti una ripresa conterebbe due
  // volte il prodotto già dichiarato ieri.
  const sessionPercent = Math.max(0, percent - previousPercent);
  const workedAreaHa = Math.round(((areaHa * sessionPercent) / 100) * 10000) / 10000;
  const canConfirm = !saving && sessionPercent > 0;

  return (
    <div className="fixed inset-0 z-[105] flex flex-col overflow-y-auto bg-black text-lime-400">
      <header className="border-b border-lime-400/30 px-5 py-4">
        <p className="text-xl font-extrabold uppercase tracking-wide text-lime-400">
          {t("fieldMode.completion.title")}
        </p>
        <p className="truncate text-sm text-lime-400/80">{plotName}</p>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-5 py-5">
        <p className="text-base text-lime-300">
          {t("fieldMode.completion.question")}
        </p>

        <div className="flex flex-col items-center gap-2 rounded-2xl border border-lime-400/30 bg-lime-400/5 py-5">
          <span className="text-xs font-semibold uppercase tracking-widest text-lime-400/70">
            {t("fieldMode.completion.percentLabel")}
          </span>
          <span className="text-7xl font-black tabular-nums text-yellow-300">
            {percent}%
          </span>
          {previousPercent > 0 && (
            <span className="text-sm text-lime-400/80">
              {t("fieldMode.completion.previousProgress", {
                percent: previousPercent,
              })}
            </span>
          )}
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          aria-label={t("fieldMode.completion.percentLabel")}
          className="h-12 w-full accent-lime-400"
        />

        <div className="grid grid-cols-4 gap-2">
          {QUICK_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setPercent(step)}
              className={cn(
                "min-h-[64px] rounded-2xl border-2 text-lg font-extrabold tabular-nums",
                percent === step
                  ? "border-lime-400 bg-lime-400 text-black"
                  : "border-lime-400/50 text-lime-400",
              )}
            >
              {step}%
            </button>
          ))}
        </div>

        {/* Ciò che finirà davvero nel Quaderno: superficie del giorno, non
            percentuale astratta — è la cifra su cui si calcolano le quantità. */}
        <div className="flex flex-col gap-1 rounded-2xl border border-lime-400/30 px-4 py-3">
          <span className="flex items-baseline justify-between gap-3 text-sm text-lime-400/80">
            {t("fieldMode.completion.plotArea")}
            <span className="font-black tabular-nums text-lime-300">
              {formatArea(plotAreaHa, units.area, 2)}
            </span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-base font-semibold text-lime-300">
            {t("fieldMode.completion.workedArea")}
            <span className="font-black tabular-nums text-yellow-300">
              {formatArea(workedAreaHa, units.area, 2)}
            </span>
          </span>
        </div>

        {percent < 100 ? (
          <p className="rounded-xl border-2 border-yellow-300 bg-yellow-300/10 px-4 py-3 text-sm font-semibold text-yellow-200">
            {t("fieldMode.completion.taskStaysOpen")}
          </p>
        ) : (
          <p className="rounded-xl border border-lime-400/40 px-4 py-3 text-sm text-lime-400/80">
            {t("fieldMode.completion.taskCloses")}
          </p>
        )}

        {sessionPercent === 0 && (
          <p className="rounded-xl border border-red-400 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {t("fieldMode.completion.noProgress")}
          </p>
        )}
      </main>

      <footer className="flex flex-col gap-3 border-t border-lime-400/30 px-5 py-5">
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() =>
            onConfirm({ workedAreaHa, completionPercent: percent })
          }
          className="flex min-h-[88px] items-center justify-center rounded-2xl bg-lime-400 text-xl font-extrabold uppercase tracking-wide text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("fieldMode.completion.confirm")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="flex min-h-[56px] items-center justify-center rounded-2xl border-2 border-lime-400/50 text-base font-bold uppercase tracking-wide text-lime-400 disabled:opacity-40"
        >
          {t("fieldMode.completion.back")}
        </button>
      </footer>
    </div>
  );
}
