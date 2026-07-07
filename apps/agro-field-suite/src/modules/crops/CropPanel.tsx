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
import { type DssTarget, useDssCalcolo } from "../../hooks/useDssCalculation";
import { CropDataForm } from "./CropDataForm";
import { cropModuleForCrop } from "./index";
import { DssRiskCard } from "./shared/DssRiskCard";

/**
 * Modulo CropType, a DUE pannelli indipendenti nella colonna destra:
 *   * {@link ColturaDatiPanel} — form smart per inserire la coltura (singolo
 *     appezzamento) su `crops` + `plots_campaign`;
 *   * {@link ColturaDssPanel} — modelli previsionali (DSS) su UNO O PIÙ
 *     appezzamenti (come la pipeline indici), con scheda di risk colorata.
 * La coltura del DSS è risolta dalla Campagna Agraria attiva (→ crops).
 */

/** Selettore d'appezzamento SINGOLO (pannello Dati coltura). */
function PlotSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const crops = useAgroStore((s) => s.crops);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
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
        {appezzamenti.map((a) => {
          const c = cropForPlot(a.id, campiCampagna, crops);
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
  appezzamento: Plot | null;
  scelto: string;
  setScelto: (id: string) => void;
  vuoto: boolean;
} {
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const selezionatoId = useAgroStore((s) => s.appezzamentoSelezionatoId);
  const [scelto, setScelto] = useState<string>(
    selezionatoId ?? appezzamenti[0]?.id ?? "",
  );

  // CTA "Completa ora" della compliance SIAN (v17): la scheda si apre già
  // puntata sull'appezzamento richiesto (pattern Quaderno/Scouting).
  const colturaApriAppezzamentoId = useAgroStore(
    (s) => s.colturaApriAppezzamentoId,
  );
  const consumaColturaApri = useAgroStore((s) => s.consumaColturaApri);
  useEffect(() => {
    if (colturaApriAppezzamentoId) {
      setScelto(colturaApriAppezzamentoId);
      consumaColturaApri();
    }
  }, [colturaApriAppezzamentoId, consumaColturaApri]);

  const appezzamento = appezzamenti.find((a) => a.id === scelto) ?? null;
  return { appezzamento, scelto, setScelto, vuoto: appezzamenti.length === 0 };
}

/** Pannello "Dati coltura": inserimento smart della coltura per Campagna. */
export function ColturaDatiPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { appezzamento, scelto, setScelto, vuoto } = useSelectedPlot();
  return (
    <FieldSheet title={t("colturaPanel.dataTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {vuoto ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("colturaPanel.noPlotAvailable")}
          </p>
        ) : (
          <>
            <PlotSelect value={scelto} onChange={setScelto} />
            {appezzamento && <CropDataForm appezzamento={appezzamento} />}
          </>
        )}
      </div>
    </FieldSheet>
  );
}

/** Pannello "CropType · DSS": modelli previsionali su uno o più appezzamenti. */
export function ColturaDssPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const crops = useAgroStore((s) => s.crops);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const selezionatoId = useAgroStore((s) => s.appezzamentoSelezionatoId);
  const { stato, calcola } = useDssCalcolo();

  const [sel, setSel] = useState<Set<string>>(
    () =>
      new Set(
        selezionatoId
          ? [selezionatoId]
          : appezzamenti[0]
            ? [appezzamenti[0].id]
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

  // Target = appezzamenti selezionati con una coltura/modulo DSS risolvibile.
  const targets = useMemo<DssTarget[]>(() => {
    const out: DssTarget[] = [];
    for (const a of appezzamenti) {
      if (!sel.has(a.id)) continue;
      const modulo = cropModuleForCrop(
        cropForPlot(a.id, campiCampagna, crops),
      );
      if (modulo) out.push({ appezzamento: a, modulo });
    }
    return out;
  }, [appezzamenti, sel, campiCampagna, crops]);

  const senzaModulo = [...sel].filter(
    (id) => !targets.some((t) => t.appezzamento.id === id),
  );
  const inCorso = stato.phase === "calcolo";

  return (
    <FieldSheet
      title={t("colturaPanel.dssTitle")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full gap-2"
          disabled={targets.length === 0 || inCorso}
          onClick={() => void calcola(targets, { skipWaterBalance: true })}
        >
          <RefreshCw size={15} className={cn(inCorso && "animate-spin")} />
          {inCorso
            ? t("colturaPanel.calculating")
            : targets.length > 1
              ? t("colturaPanel.calculateModelsCount", { count: targets.length })
              : t("colturaPanel.calculateModels")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {appezzamenti.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("colturaPanel.noPlotAvailable")}
          </p>
        ) : (
          <>
            {/* Multi-selezione appezzamenti (come la pipeline indici). */}
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("colturaPanel.plotsCount", { count: sel.size })}
              </p>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {appezzamenti.map((a) => {
                  const col = cropForPlot(a.id, campiCampagna, crops);
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

            {senzaModulo.length > 0 && (
              <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2.5 text-xs text-[var(--ink-3)]">
                {t("colturaPanel.plotsWithoutDssModule", { count: senzaModulo.length })}
              </p>
            )}

            {stato.phase === "errore" && (
              <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-xs text-[var(--danger)]">
                {stato.message}
              </div>
            )}

            {/* Risultati per appezzamento: scheda di risk colorata. */}
            {stato.phase === "completato" && (
              <div className="flex flex-col gap-3">
                {stato.risultati.map((r) => (
                  <DssRiskCard key={r.appezzamentoId} risultato={r} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </FieldSheet>
  );
}
