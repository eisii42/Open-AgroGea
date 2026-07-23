import { useAgroStore } from "@agrogea/core";
import type { VegetationIndex } from "@agrogea/tools";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVraGenerator } from "./useVraGenerator";
import {
  TILLAGE_LABELS,
  type TillageType,
  TILLAGE_UNITS,
} from "./vra-zones";

/**
 * Modulo "Mappe a rateo variabile" (VRA). Scheda separata da "Analisi indici":
 * l'agronomo sceglie plot, indice di base, tipo di lavorazione, number
 * di zone e i ratei (quantità) per zona; la mappa è zonata via K-means ed
 * esportabile per i terminali dei trattori (ISO-XML / GeoJSON).
 */

const INDICES: { id: VegetationIndex; label: string }[] = [
  { id: "ndvi", label: "NDVI" },
  { id: "ndre", label: "NDRE" },
  { id: "msavi2", label: "MSAVI2" },
  { id: "savi", label: "SAVI" },
  { id: "ndmi", label: "NDMI" },
  { id: "ndwi", label: "NDWI" },
];

const TILLAGE_TYPES = Object.keys(TILLAGE_LABELS) as TillageType[];

// Risoluzione della cella VRA in pixel Sentinel-2 (10 m/pixel).
const RISOLUZIONI = [
  { id: "fine", step: 2 },
  { id: "media", step: 4 },
  { id: "grossa", step: 8 },
];

const MIN_ZONE = 2;
const MAX_ZONE = 5;

/** Chiavi i18n per le etichette di lavorazione (`vra-zones.ts` resta in italiano). */
const TILLAGE_I18N_KEY: Record<TillageType, string> = {
  concimazione: "vraPanel.tillage.concimazione",
  fertilizzazione: "vraPanel.tillage.fertilizzazione",
  trattamento: "vraPanel.tillage.trattamento",
  semina: "vraPanel.tillage.semina",
  irrigation: "vraPanel.tillage.irrigation",
};

export function VraPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const selectedId = useAgroStore((s) => s.selectedPlotId);
  const { status, generate, runExport, reset } = useVraGenerator();

  const [plotId, setApzId] = useState(selectedId ?? "");
  const [index, setIndex] = useState<VegetationIndex>("ndvi");
  const [tillage, setTillage] = useState<TillageType>("concimazione");
  const [step, setStep] = useState(4);
  const [zone, setZone] = useState(3);
  const [rates, setRates] = useState<number[]>([120, 100, 80]);

  // Adatta la lista dei ratei al number di zone (zona 0 = indice più basso).
  useEffect(() => {
    setRates((prev) => {
      if (prev.length === zone) return prev;
      const next = [...prev];
      while (next.length < zone) next.push(next.at(-1) ?? 100);
      next.length = zone;
      return next;
    });
  }, [zone]);

  const plot = plots.find((a) => a.id === plotId);
  const unit = TILLAGE_UNITS[tillage];
  const inCorso = status.fase === "lavorazione";
  const canGenerate = plot != null && !inCorso;

  return (
    <FieldSheet
      title={t("vraPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full"
          disabled={!canGenerate}
          onClick={() => {
            if (!plot) return;
            reset();
            void generate(plot, { index, step, zone, tillage, rates });
          }}
        >
          {inCorso ? t("vraPanel.generating") : t("vraPanel.generateMap")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Plot */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("logbook.common.plot")}
          </p>
          {plots.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">
              {t("vraPanel.noPlotAvailable")}
            </p>
          ) : (
            <select
              value={plotId}
              onChange={(e) => setApzId(e.target.value)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              <option value="">{t("logbook.common.select")}</option>
              {plots.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Indice base + lavorazione */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.baseIndex")}
            </p>
            <select
              value={index}
              onChange={(e) => setIndex(e.target.value as VegetationIndex)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {INDICES.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.tillageLabel")}
            </p>
            <select
              value={tillage}
              onChange={(e) =>
                setTillage(e.target.value as TillageType)
              }
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {TILLAGE_TYPES.map((l) => (
                <option key={l} value={l}>
                  {t(TILLAGE_I18N_KEY[l] as never)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Risoluzione cella + number zone */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.cellResolution")}
            </p>
            <select
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {RISOLUZIONI.map((r) => (
                <option key={r.step} value={r.step}>
                  {t(`vraPanel.resolution.${r.id}` as never)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.zonesCount", { count: zone })}
            </p>
            <input
              type="range"
              min={MIN_ZONE}
              max={MAX_ZONE}
              value={zone}
              onChange={(e) => setZone(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </section>

        {/* Ratei per zona */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("vraPanel.ratesPerZone", { unit: unit })}
          </p>
          <p className="mb-2 text-[11px] text-[var(--ink-4)]">
            {t("vraPanel.zoneOrderHint", { zone })}
          </p>
          <div className="flex flex-col gap-1.5">
            {rates.map((rateo, i) => (
              <label
                // L'indice è la chiave naturale: le zone sono sortedList e stabili.
                key={i}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-16 text-[var(--ink-3)]">
                  {t("vraPanel.zoneNumber", { number: i + 1 })}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={rateo}
                  min={0}
                  onChange={(e) =>
                    setRates((prev) =>
                      prev.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    )
                  }
                  className="agro-num flex-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                />
                <span className="w-12 text-xs text-[var(--ink-4)]">{unit}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Stato */}
        {inCorso && (
          <p className="text-sm text-[var(--accent)]">{status.label}</p>
        )}
        {status.fase === "errore" && (
          <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
            {status.message}
          </div>
        )}

        {/* Risultato: legenda zone + export */}
        {status.fase === "completato" && (
          <section className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.zonesGenerated")}
            </p>
            <div className="flex flex-col gap-1">
              {status.result.zone.map((z) => (
                <div
                  key={z.zona}
                  className="flex items-center justify-between rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1 text-xs"
                >
                  <span className="font-medium">
                    {t("vraPanel.zoneNumber", { number: z.zona + 1 })}
                  </span>
                  <span className="text-[var(--ink-4)]">
                    {index.toUpperCase()} {z.valoreMedio.toFixed(3)} ·{" "}
                    {t("vraPanel.cellsCount", { count: z.nCelle })}
                  </span>
                  <span className="agro-num font-semibold">
                    {z.rateo} {status.result.unit}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <Button
                className="min-h-[var(--touch-min)]"
                onClick={() => runExport("isoxml", plot?.user_plot_name ?? "vra")}
              >
                ISO-XML
              </Button>
              <Button
                className="min-h-[var(--touch-min)]"
                onClick={() => runExport("shapefile", plot?.user_plot_name ?? "vra")}
              >
                Shapefile
              </Button>
              <Button
                className={cn("min-h-[var(--touch-min)]")}
                onClick={() => runExport("geojson", plot?.user_plot_name ?? "vra")}
              >
                GeoJSON
              </Button>
            </div>
          </section>
        )}
      </div>
    </FieldSheet>
  );
}
