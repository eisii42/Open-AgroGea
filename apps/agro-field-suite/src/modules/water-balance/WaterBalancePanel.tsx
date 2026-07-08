import {
  type Plot,
  cropForPlot,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { useAppStore } from "@geolibre/core";
import { Button, cn } from "@geolibre/ui";
import type { FeatureCollection } from "geojson";
import { Download, Droplets, Layers, Map as MapIcon, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Area,
  Bar,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type DssPlotResult,
  type DssTarget,
  useDssCalculation,
} from "../../hooks/useDssCalculation";
import { useDssOverlayLayer } from "../../hooks/useDssOverlayLayer";
import { cropModuleForCrop } from "../crops";
import {
  summaryCalibration,
  type FieldSummary,
  summarizeFieldRisk,
} from "../dss/dss-overlay";
import { EXTERNAL_LAYER_FLAG } from "../add-data/add-data";
import {
  buildMoistureHistoryFc,
  type MoistureHistoryFormat,
  type MoistureHistoryRow,
  type SoilSource,
  serializeMoistureHistory,
} from "../soil";
import { downloadArtifact } from "../../services/gis/geo-export";

/**
 * Pannello "Acqua · Bilancio idrico" (Modulo 1, FAO 56/66), ora MULTI-APPEZZAMENTO
 * (come la pipeline indici). Esegue in locale il bilancio idrico sull'ultimo meteo
 * di PGlite per gli plots scelti e ne mostra, per ciascuno, la depletion
 * radicale Dr day per day (con la soglia RAW), l'autonomia residua e lo
 * stato di stress. Compone gli engine puri via {@link useDssCalculation}; la series
 * giornaliera è persistita in `soil_water_indices` quando il field ha una campagna
 * attiva.
 */

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

/** Etichetta leggibile della sorgente dei parametri idro-pedologici. */
function getEtichetteSorgente(t: TFunction): Record<SoilSource, string> {
  return {
    "custom-map": t("bilancioIdricoPanel.soilSource.customMap"),
    "soil-samples": t("bilancioIdricoPanel.soilSource.soilSamples"),
    manual: t("bilancioIdricoPanel.soilSource.manual"),
    metadata: t("bilancioIdricoPanel.soilSource.metadata"),
    default: t("bilancioIdricoPanel.soilSource.default"),
  };
}

/** Formati di export dello storico umidità con etichetta. */
const FORMATI_EXPORT: { id: MoistureHistoryFormat }[] = [
  { id: "geojson" },
  { id: "shapefile" },
  { id: "csv" },
];

/** Etichetta leggibile del formato di export (i formati sono nomi tecnici invariati). */
const ETICHETTA_FORMATO: Record<MoistureHistoryFormat, string> = {
  geojson: "GeoJSON",
  shapefile: "Shapefile",
  csv: "CSV",
};

/** Mappa la series giornaliera del bilancio nello schema `soil_water_indices`. */
function seriesToMoistureHistory(
  series: {
    data: string;
    et0: number;
    etc: number;
    rain: number;
    irrigation: number;
    percolation: number;
    depletion: number;
    raw: number;
    awc: number;
    inStress: boolean;
  }[],
): MoistureHistoryRow[] {
  return series.map((g) => ({
    date: g.data,
    et0: g.et0,
    etc: g.etc,
    rain_mm: g.rain,
    irrigation_mm: g.irrigation,
    deep_percolation_mm: g.percolation,
    depletion_mm: g.depletion,
    raw_mm: g.raw,
    awc_mm: g.awc,
    water_stress: g.inStress,
  }));
}

export function BilancioIdricoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const selectedId = useAgroStore((s) => s.selectedPlotId);
  const recordTransfer = useAgroStore((s) => s.recordTransfer);

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

  const { stato, compute } = useDssCalculation();
  const [mostraOverlay, setMostraOverlay] = useState(false);
  const [esportando, setEsportando] = useState(false);

  // Mappa custom del soil (Tier 1): layer esterni caricati via «Aggiungi dati».
  const layers = useAppStore((s) => s.layers);
  const [mappaSuoloId, setMappaSuoloId] = useState("");
  const soilLayer = useMemo(
    () => layers.filter((l) => l.metadata?.[EXTERNAL_LAYER_FLAG] === true && l.geojson),
    [layers],
  );
  const mappaCustom =
    (soilLayer.find((l) => l.id === mappaSuoloId)?.geojson as
      | FeatureCollection
      | undefined) ?? null;

  // Target = plots selezionati con crop/module (serve il Kc per l'ETc).
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

  const senzaModulo = [...sel].filter(
    (id) => !targets.some((t) => t.plot.id === id),
  );
  const inCorso = stato.phase === "calcolo";
  const completato = stato.phase === "completato";

  const runExport = async (r: DssPlotResult, formato: MoistureHistoryFormat) => {
    const plot = plots.find((a) => a.id === r.plotId);
    if (!plot || r.balanceSeries.length === 0) return;
    setEsportando(true);
    try {
      const fc = buildMoistureHistoryFc(
        plot,
        seriesToMoistureHistory(r.balanceSeries),
      );
      const base = `umidita_${plot.user_plot_name || plot.id}`.replace(
        /[^\w.-]+/g,
        "_",
      );
      downloadArtifact(serializeMoistureHistory(fc, formato, base));
      await recordTransfer({
        operation_type: "export",
        file_format: formato,
        file_name: `${base}.${formato === "shapefile" ? "zip" : formato}`,
      });
    } finally {
      setEsportando(false);
    }
  };

  // Overlay coropletico del risk sintetico (stress idrico + NDVI) per field,
  // aggregato su TUTTI gli plots calcolati.
  const plotsOverlay = useMemo(
    () =>
      completato
        ? stato.risultati
            .map((r) => plots.find((a) => a.id === r.plotId))
            .filter((a): a is Plot => a != null)
        : [],
    [completato, stato.risultati, plots],
  );

  const summaryPerField = useMemo(() => {
    const m = new Map<string, FieldSummary>();
    if (!completato) return m;
    for (const r of stato.risultati) {
      if (!r.bilancio) continue;
      const appz = plots.find((a) => a.id === r.plotId);
      const idrico = r.vettori.find((v) => v.categoria === "idrico");
      const patologico = r.vettori
        .filter((v) => v.categoria === "fitopatologico")
        .reduce((max, v) => Math.max(max, v.rischio01), 0);
      const score = summarizeFieldRisk(
        {
          stressIdrico01: idrico?.rischio01 ?? 0,
          rischioPatologico01: patologico,
          ndvi: appz?.last_ndvi_mean ?? null,
        },
        summaryCalibration(r.module.mainSpecies, "piena"),
      );
      m.set(r.plotId, { rischio01: score });
    }
    return m;
  }, [completato, stato.risultati, plots]);

  useDssOverlayLayer({
    plots: plotsOverlay,
    summaryPerField,
    crop: stato.risultati[0]?.module.mainSpecies ?? "vite",
    active: mostraOverlay && completato,
  });

  return (
    <FieldSheet
      title={t("bilancioIdricoPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full gap-2"
          disabled={targets.length === 0 || inCorso}
          onClick={() => void compute(targets, { mappaCustom })}
        >
          <RefreshCw size={15} className={cn(inCorso && "animate-spin")} />
          {inCorso
            ? t("bilancioIdricoPanel.computing")
            : targets.length > 1
              ? t("bilancioIdricoPanel.computeBalanceCount", { count: targets.length })
              : t("bilancioIdricoPanel.computeBalance")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {plots.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("bilancioIdricoPanel.noPlots")}
          </p>
        ) : (
          <>
            {/* Multi-selezione plots. */}
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("bilancioIdricoPanel.plotsCount", { count: sel.size })}
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

            <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-4)]">
              <Droplets size={13} className="text-[var(--accent)]" />
              {t("bilancioIdricoPanel.formulaHint")}
            </p>

            {senzaModulo.length > 0 && (
              <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2.5 text-xs text-[var(--ink-3)]">
                {t("bilancioIdricoPanel.noCropWarning", { count: senzaModulo.length })}
              </p>
            )}

            {/* Tier 1 — sorgente soil opzionale: layer EC_a/tessitura. */}
            {soilLayer.length > 0 && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-[var(--ink-3)]">
                  <Layers size={13} /> {t("bilancioIdricoPanel.soilMap")}
                </span>
                <select
                  value={mappaSuoloId}
                  onChange={(e) => setMappaSuoloId(e.target.value)}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                >
                  <option value="">{t("bilancioIdricoPanel.soilMapAuto")}</option>
                  {soilLayer.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {stato.phase === "errore" && (
              <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-xs text-[var(--danger)]">
                {stato.message}
              </div>
            )}

            {completato && (
              <>
                <button
                  type="button"
                  onClick={() => setMostraOverlay((v) => !v)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-[var(--r-2)] border px-2 py-1.5 text-[12px] font-semibold",
                    mostraOverlay
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--line)] text-[var(--ink-3)]",
                  )}
                >
                  <MapIcon size={14} />
                  {mostraOverlay
                    ? t("bilancioIdricoPanel.overlayActive")
                    : t("bilancioIdricoPanel.showRiskOnMap")}
                </button>

                <div className="flex flex-col gap-3">
                  {stato.risultati.map((r) => (
                    <WaterResultCard
                      key={r.plotId}
                      risultato={r}
                      esportando={esportando}
                      onExport={(f) => void runExport(r, f)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </FieldSheet>
  );
}

/** Scheda risultato del bilancio idrico per UN plot. */
function WaterResultCard({
  risultato,
  esportando,
  onExport,
}: {
  risultato: DssPlotResult;
  esportando: boolean;
  onExport: (formato: MoistureHistoryFormat) => void;
}) {
  const { t } = useTranslation();
  const { name, bilancio, soil, balanceSeries, message } = risultato;
  const etichetteSorgente = useMemo(() => getEtichetteSorgente(t), [t]);

  // La series copre ~430 giorni: su un grafico stretto un singolo day d'irrigation
  // diventa invisibile. Si mostra una FINESTRA RECENTE (ultimi ~75 giorni, inclusa
  // la previsione in coda) così gli apporti irrigui e l'andamento di Dr si leggono.
  const datiGrafico = useMemo(
    () =>
      balanceSeries.slice(-75).map((g) => ({
        data: shortDate(g.data),
        depletion: Math.round(g.depletion * 10) / 10,
        irrigation: Math.round(g.irrigation * 10) / 10,
        rain: Math.round(g.rain * 10) / 10,
      })),
    [balanceSeries],
  );

  // Totale irrigato nel periodo (mm): rende ESPLICITO che il bilancio conteggia
  // gli apporti irrigui, anche quando — a profile umido — percolano senza ridurre Dr.
  const totalIrrigation = useMemo(
    () => balanceSeries.reduce((s, g) => s + (g.irrigation ?? 0), 0),
    [balanceSeries],
  );

  return (
    <section className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <p className="mb-2 text-sm font-semibold">{name}</p>

      {!bilancio ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-xs text-[var(--ink-3)]">
          {message ?? t("bilancioIdricoPanel.balanceNotComputable")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.depletionDr")}</span>
            <span className="agro-num text-right">
              {bilancio.depletion.toFixed(0)} / RAW {bilancio.raw.toFixed(0)} mm
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.availableWater")}</span>
            <span className="agro-num text-right">
              {bilancio.awc.toFixed(0)} mm (AWC)
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.irrigationPeriod")}</span>
            <span className="agro-num text-right" style={{ color: "#0ea5e9" }}>
              {totalIrrigation.toFixed(0)} mm
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.autonomy")}</span>
            <span className="agro-num text-right">
              {t("bilancioIdricoPanel.autonomyDays", { count: bilancio.autonomyDays })}
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.waterStatus")}</span>
            <span
              className="text-right font-semibold"
              style={{
                color: bilancio.inStress ? "var(--danger)" : "var(--ok, #1f8a5b)",
              }}
            >
              {bilancio.inStress
                ? t("bilancioIdricoPanel.waterStress")
                : t("bilancioIdricoPanel.adequate")}
            </span>
          </div>

          {/* Sorgente dei parametri idro-pedologici (qualità del dato). */}
          {soil && (
            <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[11px]">
              <span className="font-semibold text-[var(--ink-3)]">
                {t("bilancioIdricoPanel.soilLabel", {
                  source: etichetteSorgente[soil.sorgente],
                })}
              </span>
              {soil.tessitura && (
                <span className="agro-num text-[var(--ink-4)]">
                  {" · "}
                  {t("bilancioIdricoPanel.textureBreakdown", {
                    sand: Math.round(soil.tessitura.sabbia * 100),
                    silt: Math.round(soil.tessitura.limo * 100),
                    clay: Math.round(soil.tessitura.argilla * 100),
                  })}
                </span>
              )}
              {soil.campioniUsati > 0 && (
                <span className="text-[var(--ink-4)]">
                  {" · "}
                  {t("bilancioIdricoPanel.samplesUsed", { count: soil.campioniUsati })}
                </span>
              )}
            </div>
          )}

          {/* Deplezione Dr (area) + apporti irrigui e rain (barre): così il
              grafico MOSTRA gli eventi d'irrigation che alimentano il bilancio. */}
          {datiGrafico.length > 1 && (
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={datiGrafico}
                  margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                >
                  <XAxis
                    dataKey="data"
                    tick={{ fontSize: 9, fill: "var(--ink-3)" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "var(--ink-3)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine
                    y={bilancio.raw}
                    stroke="var(--danger)"
                    strokeDasharray="4 3"
                    label={{
                      value: t("bilancioIdricoPanel.chart.rawLabel"),
                      fontSize: 9,
                      fill: "var(--danger)",
                      position: "insideTopRight",
                    }}
                  />
                  <Bar
                    dataKey="rain"
                    name={t("bilancioIdricoPanel.chart.rain")}
                    fill="#93c5fd"
                    barSize={6}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="irrigation"
                    name={t("bilancioIdricoPanel.chart.irrigation")}
                    fill="#0ea5e9"
                    barSize={6}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="depletion"
                    name={t("bilancioIdricoPanel.chart.drShort")}
                    stroke="#1f6feb"
                    fill="#1f6feb"
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Export dello storico umidità (GeoJSON/Shapefile/CSV). */}
          {balanceSeries.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-4)]">
                <Download size={12} /> {t("bilancioIdricoPanel.exportMoistureHistory")}
              </span>
              <div className="flex gap-1.5">
                {FORMATI_EXPORT.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={esportando}
                    onClick={() => onExport(f.id)}
                    className="flex-1 rounded-[var(--r-2)] border border-[var(--line)] px-2 py-1.5 text-[12px] font-semibold text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50"
                  >
                    {ETICHETTA_FORMATO[f.id]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!bilancio.persistito && (
            <p className="text-[10px] text-[var(--ink-4)]">
              {t("bilancioIdricoPanel.registerCropHint")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
