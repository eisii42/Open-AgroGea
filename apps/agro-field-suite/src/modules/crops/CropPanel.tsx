import {
  type Plot,
  cropForPlot,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DssTarget, useDssCalculation } from "../../hooks/useDssCalculation";
import { CropDataForm } from "./CropDataForm";
import { cropModuleForCrop } from "./index";
import { DssRiskCard } from "./shared/DssRiskCard";

/**
 * Modulo CropType, a DUE pannelli indipendenti nella colonna destra:
 *   * {@link CropDataPanel} — form smart per inserire la crop (singolo
 *     plot) su `crops` + `plots_campaign`;
 *   * {@link CropDssPanel} — modelli previsionali (DSS) su UNO O PIÙ
 *     plots (come la pipeline indici), con scheda di risk colorata.
 * La crop del DSS è risolta dalla Campagna Agraria attiva (→ crops).
 */

/** Selettore d'appezzamento SINGOLO (pannello Dati crop). */
function PlotSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t("logbook.common.plot")}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
      >
        {plots.map((a) => {
          const c = cropForPlot(a.id, campaignFields, crops);
          return (
            <option key={a.id} value={a.id}>
              {a.user_plot_name}
              {c ? ` · ${c}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function useSelectedPlot(): {
  plot: Plot | null;
  chosen: string;
  setChosen: (id: string) => void;
  vuoto: boolean;
} {
  const plots = useAgroStore((s) => s.plots);
  const selectedId = useAgroStore((s) => s.selectedPlotId);
  const [chosen, setChosen] = useState<string>(
    selectedId ?? plots[0]?.id ?? "",
  );

  // CTA "Completa ora" della compliance SIAN (v17): la scheda si apre già
  // puntata sull'appezzamento richiesto (pattern Quaderno/Scouting).
  const cropOpenPlotId = useAgroStore(
    (s) => s.cropOpenPlotId,
  );
  const consumeCropOpen = useAgroStore((s) => s.consumeCropOpen);
  useEffect(() => {
    if (cropOpenPlotId) {
      setChosen(cropOpenPlotId);
      consumeCropOpen();
    }
  }, [cropOpenPlotId, consumeCropOpen]);

  const plot = plots.find((a) => a.id === chosen) ?? null;
  return { plot, chosen, setChosen, vuoto: plots.length === 0 };
}

/** Pannello "Dati coltura": inserimento smart della crop per Campagna. */
export function CropDataPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { plot, chosen, setChosen, vuoto } = useSelectedPlot();
  return (
    <FieldSheet title={t("cropPanel.dataTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {vuoto ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("cropPanel.noPlotAvailable")}
          </p>
        ) : (
          <>
            <PlotSelect value={chosen} onChange={setChosen} />
            {plot && <CropDataForm plot={plot} />}
          </>
        )}
      </div>
    </FieldSheet>
  );
}

/** Pannello "CropType · DSS": modelli previsionali su uno o più plots. */
export function CropDssPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const selectedId = useAgroStore((s) => s.selectedPlotId);
  const { status, compute } = useDssCalculation();

  const [sel, setSel] = useState<Set<string>>(
    () =>
      new Set(
        selectedId
          ? [selectedId]
          : plots[0]
            ? [plots[0].id]
            : [],
      ),
  );

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Target = plots selezionati con una crop/module DSS risolvibile.
  const targets = useMemo<DssTarget[]>(() => {
    const out: DssTarget[] = [];
    for (const a of plots) {
      if (!sel.has(a.id)) continue;
      const module = cropModuleForCrop(
        cropForPlot(a.id, campaignFields, crops),
      );
      if (module) out.push({ plot: a, module });
    }
    return out;
  }, [plots, sel, campaignFields, crops]);

  const withoutModule = [...sel].filter(
    (id) => !targets.some((t) => t.plot.id === id),
  );
  const inCorso = status.phase === "calcolo";

  return (
    <FieldSheet
      title={t("cropPanel.dssTitle")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full gap-2"
          disabled={targets.length === 0 || inCorso}
          onClick={() => void compute(targets, { skipWaterBalance: true })}
        >
          <RefreshCw size={15} className={cn(inCorso && "animate-spin")} />
          {inCorso
            ? t("cropPanel.calculating")
            : targets.length > 1
              ? t("cropPanel.calculateModelsCount", { count: targets.length })
              : t("cropPanel.calculateModels")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {plots.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("cropPanel.noPlotAvailable")}
          </p>
        ) : (
          <>
            {/* Multi-selezione plots (come la pipeline indici). */}
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("cropPanel.plotsCount", { count: sel.size })}
              </p>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {plots.map((a) => {
                  const col = cropForPlot(a.id, campaignFields, crops);
                  return (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 rounded-[var(--r-2)] px-2 py-1.5 hover:bg-[var(--panel-2)]"
                    >
                      <input
                        type="checkbox"
                        checked={sel.has(a.id)}
                        onChange={() => toggle(a.id)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="flex-1 truncate text-sm">
                        {a.user_plot_name}
                      </span>
                      <span className="text-xs text-[var(--ink-4)]">
                        {col ?? "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            {withoutModule.length > 0 && (
              <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2.5 text-xs text-[var(--ink-3)]">
                {t("cropPanel.plotsWithoutDssModule", { count: withoutModule.length })}
              </p>
            )}

            {status.phase === "errore" && (
              <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-xs text-[var(--danger)]">
                {status.message}
              </div>
            )}

            {/* Risultati per plot: scheda di risk colorata. */}
            {status.phase === "completato" && (
              <div className="flex flex-col gap-3">
                {status.results.map((r) => (
                  <DssRiskCard key={r.plotId} result={r} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </FieldSheet>
  );
}
