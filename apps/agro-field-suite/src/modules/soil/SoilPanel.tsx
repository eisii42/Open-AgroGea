import { cropForPlot, useAgroStore } from "@agrogea/core";
import {
  type VegetationIndex,
  ndviColor,
} from "@agrogea/tools";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  MAX_GIORNI_PERSONALIZZATO,
  type SoilOptions,
  type PlotResult,
  type StrategiaTemporale,
  useSoilPipeline,
} from "../../hooks/useSoilPipeline";
import {
  buildNdviScatter,
  correlazionePearson,
  ETICHETTE_VARIABILE,
  type SoilVariable,
} from "./soil-analytics";

/**
 * Pannello del module Suolo (refactor pipeline indici STAC). Riprogetta la
 * vecchia "Analisi NDVI" in un'analisi multi-criterio:
 *   * checkbox degli indici calcolabili via STAC (NDVI/NDRE/MSAVI2/SAVI/NDWI);
 *   * multi-selezione degli plots su cui calcolare;
 *   * filtro cloud cover (slider %);
 *   * strategia temporale: last immagine, ultimi 15/30 gg o intervallo
 *     personalizzato (con grafico di trend dell'index nel tempo).
 * L'overlay raster dell'index primario è renderizzato sulla mappa dal hook.
 */

function getIndici(
  t: TFunction,
): { id: VegetationIndex; label: string; descr: string }[] {
  return [
    { id: "ndvi", label: "NDVI", descr: t("suoloPanel.indices.ndvi.descr") },
    { id: "ndre", label: "NDRE", descr: t("suoloPanel.indices.ndre.descr") },
    {
      id: "msavi2",
      label: "MSAVI2",
      descr: t("suoloPanel.indices.msavi2.descr"),
    },
    { id: "savi", label: "SAVI", descr: t("suoloPanel.indices.savi.descr") },
    { id: "ndwi", label: "NDWI", descr: t("suoloPanel.indices.ndwi.descr") },
  ];
}

function getStrategie(
  t: TFunction,
): { id: string; label: string; strategia: StrategiaTemporale }[] {
  return [
    {
      id: "ultima",
      label: t("suoloPanel.period.lastImage"),
      strategia: { tipo: "ultima" },
    },
    {
      id: "15",
      label: t("suoloPanel.period.last15Days"),
      strategia: { tipo: "intervallo", giorni: 15 },
    },
    {
      id: "30",
      label: t("suoloPanel.period.last30Days"),
      strategia: { tipo: "intervallo", giorni: 30 },
    },
  ];
}

// Variabili chimiche selezionabili come asse X dello scatter NDVI↔soil.
const VARIABILI_SCATTER: SoilVariable[] = [
  "ph",
  "organic_matter",
  "nitrogen",
  "phosphorus",
  "potassium",
];

const LINE_COLORS = [
  "#1f8a5b",
  "#1f6feb",
  "#e8833a",
  "#9b5de5",
  "#d23b2e",
  "#0aa3a3",
];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

/** "YYYY-MM-DD" di oggi e di N giorni fa (default dei date picker). */
function isoDate(offsetGiorni = 0): string {
  return new Date(Date.now() - offsetGiorni * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Dati per il line chart. Con un solo plot: una linea per index. Con
 * più plots: una linea per plot sull'index primario.
 */
function buildChartData(
  risultati: PlotResult[],
  indici: VegetationIndex[],
  indicePrimario: VegetationIndex,
): { rows: Record<string, number | string>[]; series: string[] } {
  if (risultati.length === 1) {
    const r = risultati[0];
    const rows = r.series.map((p) => {
      const row: Record<string, number | string> = { data: shortDate(p.datetime) };
      for (const ind of indici) {
        const v = p.medie[ind];
        if (v != null && !Number.isNaN(v)) row[ind] = Math.round(v * 1000) / 1000;
      }
      return row;
    });
    return { rows, series: indici };
  }

  // Multi-plot: unione delle date, index primario per ciascuno.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const r of risultati) {
    for (const p of r.series) {
      const key = shortDate(p.datetime);
      const row = byDate.get(key) ?? { data: key };
      const v = p.medie[indicePrimario];
      if (v != null && !Number.isNaN(v)) row[r.name] = Math.round(v * 1000) / 1000;
      byDate.set(key, row);
    }
  }
  return { rows: [...byDate.values()], series: risultati.map((r) => r.name) };
}

export function SoilPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const INDICI = useMemo(() => getIndici(t), [t]);
  const STRATEGIE = useMemo(() => getStrategie(t), [t]);
  const plots = useAgroStore((s) => s.plots);
  const soilSamples = useAgroStore((s) => s.soilSamples);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const selectedId = useAgroStore((s) => s.selectedPlotId);
  const { stato, compute, reset } = useSoilPipeline();

  // Pannello Charts: scatter NDVI (Y) ↔ variabile chimica del soil (X).
  const [varX, setVarX] = useState<SoilVariable>("ph");
  const scatter = useMemo(
    () => buildNdviScatter(plots, soilSamples, varX),
    [plots, soilSamples, varX],
  );
  const correlazione = useMemo(() => correlazionePearson(scatter), [scatter]);

  const [indiciSel, setIndiciSel] = useState<Set<VegetationIndex>>(
    new Set(["ndvi"]),
  );
  const [indicePrimario, setIndicePrimario] =
    useState<VegetationIndex>("ndvi");
  const [apzSel, setApzSel] = useState<Set<string>>(
    new Set(selectedId ? [selectedId] : []),
  );
  const [cloudCover, setCloudCover] = useState(20);
  const [strategiaId, setStrategiaId] = useState("ultima");
  const [inizioCustom, setInizioCustom] = useState(() => isoDate(30));
  const [fineCustom, setFineCustom] = useState(() => isoDate(0));

  const inCorso = stato.phase === "lavorazione";

  // Durata dell'intervallo personalizzato (giorni); usata per il vincolo 60 gg.
  const giorniRange = useMemo(() => {
    const ms = new Date(fineCustom).getTime() - new Date(inizioCustom).getTime();
    return Math.round(ms / (24 * 3600 * 1000));
  }, [inizioCustom, fineCustom]);

  const rangeNonValido =
    strategiaId === "custom" &&
    (giorniRange < 0 || giorniRange > MAX_GIORNI_PERSONALIZZATO);

  const toggleIndice = (id: VegetationIndex) => {
    setIndiciSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Garantisce un index primario sempre fra quelli selezionati.
      if (!next.has(indicePrimario) && next.size > 0) {
        setIndicePrimario([...next][0]);
      }
      return next;
    });
  };

  const toggleApz = (id: string) => {
    setApzSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const strategia: StrategiaTemporale = useMemo(() => {
    if (strategiaId === "custom") {
      return { tipo: "personalizzato", inizio: inizioCustom, fine: fineCustom };
    }
    return (
      STRATEGIE.find((s) => s.id === strategiaId)?.strategia ?? { tipo: "ultima" }
    );
  }, [strategiaId, inizioCustom, fineCustom]);

  const canCompute =
    indiciSel.size > 0 && apzSel.size > 0 && !inCorso && !rangeNonValido;

  const avvia = () => {
    reset();
    const opzioni: SoilOptions = {
      indici: [...indiciSel],
      indicePrimario: indiciSel.has(indicePrimario)
        ? indicePrimario
        : [...indiciSel][0],
      cloudCoverMax: cloudCover,
      strategia,
    };
    const target = plots.filter((a) => apzSel.has(a.id));
    void compute(target, opzioni);
  };

  const chart =
    stato.phase === "completato"
      ? buildChartData(stato.risultati, stato.indici, stato.indicePrimario)
      : null;
  const mostraGrafico = chart != null && chart.rows.length > 1;

  return (
    <FieldSheet
      title={t("suoloPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full"
          disabled={!canCompute}
          onClick={avvia}
        >
          {inCorso
            ? t("suoloPanel.calculating")
            : t("suoloPanel.calculateButton")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Indici */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("suoloPanel.indices.title")}
          </p>
          <div className="flex flex-col gap-1">
            {INDICI.map((ind) => {
              const checked = indiciSel.has(ind.id);
              return (
                <label
                  key={ind.id}
                  className="flex items-center gap-2 rounded-[var(--r-2)] px-2 py-1.5 hover:bg-[var(--panel-2)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleIndice(ind.id)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="flex-1 text-sm font-medium">{ind.label}</span>
                  <span className="text-xs text-[var(--ink-4)]">{ind.descr}</span>
                  {/* Indice primario = quello reso come overlay sulla mappa. */}
                  <button
                    type="button"
                    disabled={!checked}
                    onClick={() => setIndicePrimario(ind.id)}
                    title={t("suoloPanel.indices.primaryTooltip")}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      indicePrimario === ind.id && checked
                        ? "bg-[var(--accent-l)] text-[var(--accent)]"
                        : "text-[var(--ink-4)]",
                      !checked && "opacity-30",
                    )}
                  >
                    {t("suoloPanel.indices.overlay")}
                  </button>
                </label>
              );
            })}
          </div>
        </section>

        {/* Appezzamenti */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("suoloPanel.plots.title", { count: apzSel.size })}
          </p>
          {plots.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">
              {t("suoloPanel.plots.none")}
            </p>
          ) : (
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {plots.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 rounded-[var(--r-2)] px-2 py-1.5 hover:bg-[var(--panel-2)]"
                >
                  <input
                    type="checkbox"
                    checked={apzSel.has(a.id)}
                    onChange={() => toggleApz(a.id)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="flex-1 truncate text-sm">{a.user_plot_name}</span>
                  <span className="text-xs text-[var(--ink-4)]">
                    {cropForPlot(a.id, campaignFields, crops) ?? "—"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Cloud cover */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("suoloPanel.cloudCover.title")}
            </p>
            <span className="agro-num text-sm font-semibold">{cloudCover}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cloudCover}
            onChange={(e) => setCloudCover(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </section>

        {/* Strategia temporale */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("suoloPanel.period.title")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIE.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStrategiaId(s.id)}
                className={cn(
                  "rounded-[var(--r-2)] border px-2.5 py-1.5 text-[13px]",
                  strategiaId === s.id
                    ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                    : "border-[var(--line)] text-[var(--ink-2)]",
                )}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStrategiaId("custom")}
              className={cn(
                "rounded-[var(--r-2)] border px-2.5 py-1.5 text-[13px]",
                strategiaId === "custom"
                  ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink-2)]",
              )}
            >
              {t("suoloPanel.period.custom")}
            </button>
          </div>
          {strategiaId === "custom" && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-1.5">
                  {t("suoloPanel.period.from")}
                  <input
                    type="date"
                    value={inizioCustom}
                    max={fineCustom}
                    onChange={(e) => setInizioCustom(e.target.value)}
                    className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  {t("suoloPanel.period.to")}
                  <input
                    type="date"
                    value={fineCustom}
                    min={inizioCustom}
                    max={isoDate(0)}
                    onChange={(e) => setFineCustom(e.target.value)}
                    className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-sm"
                  />
                </label>
              </div>
              {rangeNonValido ? (
                <p className="text-xs text-[var(--danger)]">
                  {giorniRange < 0
                    ? t("suoloPanel.period.endBeforeStart")
                    : t("suoloPanel.period.rangeTooWide", {
                        max: MAX_GIORNI_PERSONALIZZATO,
                        count: giorniRange,
                      })}
                </p>
              ) : (
                <p className="text-xs text-[var(--ink-4)]">
                  {t("suoloPanel.period.daysMax", {
                    count: giorniRange,
                    max: MAX_GIORNI_PERSONALIZZATO,
                  })}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Stato / progress */}
        {inCorso && (
          <p className="text-sm text-[var(--accent)]">
            {stato.label}
            {" · "}
            {t("suoloPanel.progress.plotCounter", {
              current: stato.appezzamentoCorrente,
              total: stato.appezzamentiTotali,
            })}
          </p>
        )}
        {stato.phase === "errore" && (
          <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
            {stato.message}
          </div>
        )}

        {/* Risultati: medie più recenti per plot + index */}
        {stato.phase === "completato" && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("suoloPanel.results.title")}
            </p>
            {stato.risultati.map((r) => {
              const ultimo = r.series.at(-1);
              return (
                <div
                  key={r.plotId}
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                >
                  <p className="text-sm font-semibold">{r.name}</p>
                  {!ultimo ? (
                    <p className="text-xs text-[var(--ink-3)]">
                      {t("suoloPanel.results.noScene")}
                    </p>
                  ) : (
                    <>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {stato.indici.map((ind) => {
                          const v = ultimo.medie[ind];
                          if (v == null || Number.isNaN(v)) return null;
                          return (
                            <span
                              key={ind}
                              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-xs"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  background:
                                    ind === "ndvi" ? ndviColor(v) : "var(--accent)",
                                }}
                              />
                              <span className="font-medium uppercase">{ind}</span>
                              <span className="agro-num">{v.toFixed(3)}</span>
                            </span>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--ink-4)]">
                        {t("suoloPanel.results.sceneDate", {
                          date: shortDate(ultimo.datetime),
                        })}
                        {ultimo.cloudCover != null &&
                          t("suoloPanel.results.cloudSuffix", {
                            percent: ultimo.cloudCover.toFixed(0),
                          })}
                      </p>
                    </>
                  )}
                </div>
              );
            })}

            {/* Grafico di trend (solo se c'è una series con più date) */}
            {mostraGrafico && chart && (
              <div className="mt-1">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                  {t("suoloPanel.results.trend")}{" "}
                  {stato.risultati.length > 1
                    ? stato.indicePrimario.toUpperCase()
                    : t("suoloPanel.results.trendIndices")}
                </p>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chart.rows}
                      margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                    >
                      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="data"
                        tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--panel)",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {chart.series.map((key, i) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Charts · scatter NDVI ↔ chimica del soil (indipendente dal calcolo
            STAC: usa l'NDVI in cache e i soilSamples già a DB). */}
        <section className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("suoloPanel.charts.title")}
            </p>
            {correlazione != null && (
              <span
                className="agro-num text-xs font-semibold text-[var(--ink-3)]"
                title={t("suoloPanel.charts.pearsonTooltip")}
              >
                r = {correlazione.toFixed(2)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {VARIABILI_SCATTER.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVarX(v)}
                className={cn(
                  "rounded-[var(--r-2)] border px-2.5 py-1 text-[12px]",
                  varX === v
                    ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                    : "border-[var(--line)] text-[var(--ink-2)]",
                )}
              >
                {ETICHETTE_VARIABILE[v]}
              </button>
            ))}
          </div>

          {scatter.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">
              {t("suoloPanel.charts.needData")}
            </p>
          ) : (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: -8 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={ETICHETTE_VARIABILE[varX]}
                    tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                    label={{
                      value: ETICHETTE_VARIABILE[varX],
                      position: "insideBottom",
                      offset: -8,
                      fontSize: 11,
                      fill: "var(--ink-4)",
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="NDVI"
                    domain={[0, 1]}
                    tick={{ fontSize: 11, fill: "var(--ink-3)" }}
                  />
                  <ZAxis
                    type="number"
                    dataKey="n"
                    range={[40, 200]}
                    name={t("suoloPanel.charts.samples")}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Scatter
                    name={t("suoloPanel.charts.plots")}
                    data={scatter}
                    fill="var(--accent)"
                    fillOpacity={0.75}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </FieldSheet>
  );
}
