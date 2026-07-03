import {
  type Appezzamento,
  colturaPerAppezzamento,
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
  type RisultatoDssPlot,
  type TargetDss,
  useDssCalcolo,
} from "../hooks/useDssCalcolo";
import { useDssOverlayLayer } from "../hooks/useDssOverlayLayer";
import { cropModulePerColtura } from "../modules/crops";
import {
  calibrazioneSintesi,
  type SintesiCampo,
  sintetizzaRischioCampo,
} from "../modules/dss/dss-overlay";
import { EXTERNAL_LAYER_FLAG } from "../modules/add-data/add-data";
import {
  costruisciStoricoUmiditaFc,
  type FormatoStoricoUmidita,
  type RigaStoricoUmidita,
  type SorgenteSuolo,
  serializzaStoricoUmidita,
} from "../modules/soil";
import { scaricaArtifact } from "../services/gis/geo-export";

/**
 * Pannello "Acqua · Bilancio idrico" (Modulo 1, FAO 56/66), ora MULTI-APPEZZAMENTO
 * (come la pipeline indici). Esegue in locale il bilancio idrico sull'ultimo meteo
 * di PGlite per gli appezzamenti scelti e ne mostra, per ciascuno, la deplezione
 * radicale Dr giorno per giorno (con la soglia RAW), l'autonomia residua e lo
 * stato di stress. Compone gli engine puri via {@link useDssCalcolo}; la serie
 * giornaliera è persistita in `soil_water_indices` quando il campo ha una campagna
 * attiva.
 */

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

/** Etichetta leggibile della sorgente dei parametri idro-pedologici. */
function getEtichetteSorgente(t: TFunction): Record<SorgenteSuolo, string> {
  return {
    "custom-map": t("bilancioIdricoPanel.soilSource.customMap"),
    "soil-samples": t("bilancioIdricoPanel.soilSource.soilSamples"),
    manual: t("bilancioIdricoPanel.soilSource.manual"),
    metadata: t("bilancioIdricoPanel.soilSource.metadata"),
    default: t("bilancioIdricoPanel.soilSource.default"),
  };
}

/** Formati di export dello storico umidità con etichetta. */
const FORMATI_EXPORT: { id: FormatoStoricoUmidita }[] = [
  { id: "geojson" },
  { id: "shapefile" },
  { id: "csv" },
];

/** Etichetta leggibile del formato di export (i formati sono nomi tecnici invariati). */
const ETICHETTA_FORMATO: Record<FormatoStoricoUmidita, string> = {
  geojson: "GeoJSON",
  shapefile: "Shapefile",
  csv: "CSV",
};

/** Mappa la serie giornaliera del bilancio nello schema `soil_water_indices`. */
function serieAStoricoUmidita(
  serie: {
    data: string;
    et0: number;
    etc: number;
    pioggia: number;
    irrigazione: number;
    percolazione: number;
    deplezione: number;
    raw: number;
    awc: number;
    inStress: boolean;
  }[],
): RigaStoricoUmidita[] {
  return serie.map((g) => ({
    date: g.data,
    et0: g.et0,
    etc: g.etc,
    rain_mm: g.pioggia,
    irrigation_mm: g.irrigazione,
    deep_percolation_mm: g.percolazione,
    depletion_mm: g.deplezione,
    raw_mm: g.raw,
    awc_mm: g.awc,
    water_stress: g.inStress,
  }));
}

export function BilancioIdricoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const crops = useAgroStore((s) => s.crops);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const selezionatoId = useAgroStore((s) => s.appezzamentoSelezionatoId);
  const registraTrasferimento = useAgroStore((s) => s.registraTrasferimento);

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

  const { stato, calcola } = useDssCalcolo();
  const [mostraOverlay, setMostraOverlay] = useState(false);
  const [esportando, setEsportando] = useState(false);

  // Mappa custom del suolo (Tier 1): layer esterni caricati via «Aggiungi dati».
  const layers = useAppStore((s) => s.layers);
  const [mappaSuoloId, setMappaSuoloId] = useState("");
  const layerSuolo = useMemo(
    () => layers.filter((l) => l.metadata?.[EXTERNAL_LAYER_FLAG] === true && l.geojson),
    [layers],
  );
  const mappaCustom =
    (layerSuolo.find((l) => l.id === mappaSuoloId)?.geojson as
      | FeatureCollection
      | undefined) ?? null;

  // Target = appezzamenti selezionati con coltura/modulo (serve il Kc per l'ETc).
  const targets = useMemo<TargetDss[]>(() => {
    const out: TargetDss[] = [];
    for (const a of appezzamenti) {
      if (!sel.has(a.id)) continue;
      const modulo = cropModulePerColtura(
        colturaPerAppezzamento(a.id, campiCampagna, crops),
      );
      if (modulo) out.push({ appezzamento: a, modulo });
    }
    return out;
  }, [appezzamenti, sel, campiCampagna, crops]);

  const senzaModulo = [...sel].filter(
    (id) => !targets.some((t) => t.appezzamento.id === id),
  );
  const inCorso = stato.fase === "calcolo";
  const completato = stato.fase === "completato";

  const esporta = async (r: RisultatoDssPlot, formato: FormatoStoricoUmidita) => {
    const appezzamento = appezzamenti.find((a) => a.id === r.appezzamentoId);
    if (!appezzamento || r.bilancioSerie.length === 0) return;
    setEsportando(true);
    try {
      const fc = costruisciStoricoUmiditaFc(
        appezzamento,
        serieAStoricoUmidita(r.bilancioSerie),
      );
      const base = `umidita_${appezzamento.user_plot_name || appezzamento.id}`.replace(
        /[^\w.-]+/g,
        "_",
      );
      scaricaArtifact(serializzaStoricoUmidita(fc, formato, base));
      await registraTrasferimento({
        operation_type: "export",
        file_format: formato,
        file_name: `${base}.${formato === "shapefile" ? "zip" : formato}`,
      });
    } finally {
      setEsportando(false);
    }
  };

  // Overlay coropletico del rischio sintetico (stress idrico + NDVI) per campo,
  // aggregato su TUTTI gli appezzamenti calcolati.
  const overlayAppezzamenti = useMemo(
    () =>
      completato
        ? stato.risultati
            .map((r) => appezzamenti.find((a) => a.id === r.appezzamentoId))
            .filter((a): a is Appezzamento => a != null)
        : [],
    [completato, stato.risultati, appezzamenti],
  );

  const sintesiPerCampo = useMemo(() => {
    const m = new Map<string, SintesiCampo>();
    if (!completato) return m;
    for (const r of stato.risultati) {
      if (!r.bilancio) continue;
      const appz = appezzamenti.find((a) => a.id === r.appezzamentoId);
      const idrico = r.vettori.find((v) => v.categoria === "idrico");
      const patologico = r.vettori
        .filter((v) => v.categoria === "fitopatologico")
        .reduce((max, v) => Math.max(max, v.rischio01), 0);
      const score = sintetizzaRischioCampo(
        {
          stressIdrico01: idrico?.rischio01 ?? 0,
          rischioPatologico01: patologico,
          ndvi: appz?.last_ndvi_mean ?? null,
        },
        calibrazioneSintesi(r.modulo.speciePrincipale, "piena"),
      );
      m.set(r.appezzamentoId, { rischio01: score });
    }
    return m;
  }, [completato, stato.risultati, appezzamenti]);

  useDssOverlayLayer({
    appezzamenti: overlayAppezzamenti,
    sintesiPerCampo,
    coltura: stato.risultati[0]?.modulo.speciePrincipale ?? "vite",
    attivo: mostraOverlay && completato,
  });

  return (
    <FieldSheet
      title={t("bilancioIdricoPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full gap-2"
          disabled={targets.length === 0 || inCorso}
          onClick={() => void calcola(targets, { mappaCustom })}
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
        {appezzamenti.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ink-3)]">
            {t("bilancioIdricoPanel.noPlots")}
          </p>
        ) : (
          <>
            {/* Multi-selezione appezzamenti. */}
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("bilancioIdricoPanel.plotsCount", { count: sel.size })}
              </p>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {appezzamenti.map((a) => {
                  const col = colturaPerAppezzamento(a.id, campiCampagna, crops);
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

            {/* Tier 1 — sorgente suolo opzionale: layer EC_a/tessitura. */}
            {layerSuolo.length > 0 && (
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
                  {layerSuolo.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {stato.fase === "errore" && (
              <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-xs text-[var(--danger)]">
                {stato.messaggio}
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
                      key={r.appezzamentoId}
                      risultato={r}
                      esportando={esportando}
                      onExport={(f) => void esporta(r, f)}
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

/** Scheda risultato del bilancio idrico per UN appezzamento. */
function WaterResultCard({
  risultato,
  esportando,
  onExport,
}: {
  risultato: RisultatoDssPlot;
  esportando: boolean;
  onExport: (formato: FormatoStoricoUmidita) => void;
}) {
  const { t } = useTranslation();
  const { nome, bilancio, suolo, bilancioSerie, messaggio } = risultato;
  const etichetteSorgente = useMemo(() => getEtichetteSorgente(t), [t]);

  // La serie copre ~430 giorni: su un grafico stretto un singolo giorno d'irrigazione
  // diventa invisibile. Si mostra una FINESTRA RECENTE (ultimi ~75 giorni, inclusa
  // la previsione in coda) così gli apporti irrigui e l'andamento di Dr si leggono.
  const datiGrafico = useMemo(
    () =>
      bilancioSerie.slice(-75).map((g) => ({
        data: shortDate(g.data),
        deplezione: Math.round(g.deplezione * 10) / 10,
        irrigazione: Math.round(g.irrigazione * 10) / 10,
        pioggia: Math.round(g.pioggia * 10) / 10,
      })),
    [bilancioSerie],
  );

  // Totale irrigato nel periodo (mm): rende ESPLICITO che il bilancio conteggia
  // gli apporti irrigui, anche quando — a profilo umido — percolano senza ridurre Dr.
  const irrigazioneTotale = useMemo(
    () => bilancioSerie.reduce((s, g) => s + (g.irrigazione ?? 0), 0),
    [bilancioSerie],
  );

  return (
    <section className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <p className="mb-2 text-sm font-semibold">{nome}</p>

      {!bilancio ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-xs text-[var(--ink-3)]">
          {messaggio ?? t("bilancioIdricoPanel.balanceNotComputable")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.depletionDr")}</span>
            <span className="agro-num text-right">
              {bilancio.deplezione.toFixed(0)} / RAW {bilancio.raw.toFixed(0)} mm
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.availableWater")}</span>
            <span className="agro-num text-right">
              {bilancio.awc.toFixed(0)} mm (AWC)
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.irrigationPeriod")}</span>
            <span className="agro-num text-right" style={{ color: "#0ea5e9" }}>
              {irrigazioneTotale.toFixed(0)} mm
            </span>
            <span className="text-[var(--ink-3)]">{t("bilancioIdricoPanel.autonomy")}</span>
            <span className="agro-num text-right">
              {t("bilancioIdricoPanel.autonomyDays", { count: bilancio.giorniAutonomia })}
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
          {suolo && (
            <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[11px]">
              <span className="font-semibold text-[var(--ink-3)]">
                {t("bilancioIdricoPanel.soilLabel", {
                  source: etichetteSorgente[suolo.sorgente],
                })}
              </span>
              {suolo.tessitura && (
                <span className="agro-num text-[var(--ink-4)]">
                  {" · "}
                  {t("bilancioIdricoPanel.textureBreakdown", {
                    sand: Math.round(suolo.tessitura.sabbia * 100),
                    silt: Math.round(suolo.tessitura.limo * 100),
                    clay: Math.round(suolo.tessitura.argilla * 100),
                  })}
                </span>
              )}
              {suolo.campioniUsati > 0 && (
                <span className="text-[var(--ink-4)]">
                  {" · "}
                  {t("bilancioIdricoPanel.samplesUsed", { count: suolo.campioniUsati })}
                </span>
              )}
            </div>
          )}

          {/* Deplezione Dr (area) + apporti irrigui e pioggia (barre): così il
              grafico MOSTRA gli eventi d'irrigazione che alimentano il bilancio. */}
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
                    dataKey="pioggia"
                    name={t("bilancioIdricoPanel.chart.rain")}
                    fill="#93c5fd"
                    barSize={6}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="irrigazione"
                    name={t("bilancioIdricoPanel.chart.irrigation")}
                    fill="#0ea5e9"
                    barSize={6}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="deplezione"
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
          {bilancioSerie.length > 0 && (
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
