import type {
  Plot,
  PlotCampaign,
  Crop,
  DssResult,
  WeatherReading,
  TreatmentLog,
  Harvest,
  SoilWaterIndex,
} from "@agrogea/core";
import type { KpiParams } from "./kpi-config";

/**
 * Motore analitico del Data Command Center (Modulo 2). Genera dataset aggregati
 * e KPI a partire dal dominio AgroGea (PGlite/store) filtrato per crop
 * (`crop_id`) e annata agraria (`campaign_year` da `plots_campaign`).
 *
 * CROSS-REFERENCING (cuore del Command Center) senza duplicare logica:
 *   - Meteo + Suolo → trend ETc e stress idrico (compone l'output FAO 56/66 già
 *     persistito in `soil_water_indices` con le letture `weather_readings`);
 *   - Operazioni + NDVI → efficienza degli input (operazioni fitosanitarie del
 *     Quaderno vs vigore vegetativo medio cache STAC);
 *   - Storico → confronto della campagna attiva vs annate precedenti dello
 *     stesso plot (operazioni, raccolto, GDD).
 *
 * Funzione PURA (oggetti/array in ingresso, KPI in uscita): testabile sotto
 * `node --test`. Lo stato del pannello, il caricamento dal DAL e il rendering
 * vivono nei componenti React e nel hook `useCommandCenterData`.
 *
 * Nota architetturale: il parsing MASSIVO dei field-attributes spaziali (file
 * esterni: conducibilità elettrica, tessitura, indici spettrali) resta al motore
 * DuckDB Spatial (`services/gis/spatial-sql`); qui si cross-referenziano gli
 * attributi tabellari del dominio in-memory, già materializzati dal DAL.
 */

// ---------------------------------------------------------------------------
// Categoria crop
// ---------------------------------------------------------------------------

export type CropCategory =
  | "viticoltura"
  | "seminativo"
  | "olivicoltura"
  | "frutticoltura"
  | "orticoltura"
  | "generic";

const CATEGORY_LABEL: Record<CropCategory, string> = {
  viticoltura: "Viticoltura",
  seminativo: "Seminativo",
  olivicoltura: "Olivicoltura",
  frutticoltura: "Frutticoltura",
  orticoltura: "Orticoltura",
  generic: "CropType",
};

/** Risolve la categoria DSS di una crop da metadata o name comune. */
export function resolveCropCategory(crop: Crop | undefined | null): CropCategory {
  if (!crop) return "generic";
  const meta = crop.crop_metadata?.["category"];
  if (typeof meta === "string" && isCropCategory(meta)) return meta;
  const name = `${crop.common_name} ${crop.scientific_name ?? ""}`.toLowerCase();
  if (/vit|vigne|uva/.test(name)) return "viticoltura";
  if (/oliv/.test(name)) return "olivicoltura";
  if (/fruml|frument|mais|orzo|cereal|grano|soia|girasol/.test(name)) return "seminativo";
  if (/melo|pero|pesc|susin|cilieg|albico|frutt|agrum/.test(name)) return "frutticoltura";
  if (/pomodor|orto|insalat|zucch|peperon|cipoll|ortic/.test(name)) return "orticoltura";
  return "generic";
}

function isCropCategory(v: string): v is CropCategory {
  return (
    v === "viticoltura" ||
    v === "seminativo" ||
    v === "olivicoltura" ||
    v === "frutticoltura" ||
    v === "orticoltura" ||
    v === "generic"
  );
}

/** KPI specifici mostrati per categoria, oltre a quelli generici sempre presenti. */
const CROP_KPI_IDS: Record<CropCategory, string[]> = {
  viticoltura: ["gdd", "disease", "water_stress"],
  seminativo: ["gdd", "disease"],
  olivicoltura: ["gdd", "disease", "water_stress"],
  frutticoltura: ["gdd", "disease", "water_stress"],
  orticoltura: ["water_stress", "disease"],
  // Company-wide / crop mista: mostra comunque rischio modelli e GDD, così i
  // DSS calcolati su plot senza una categoria risolta non spariscono dalla vista.
  generic: ["water_stress", "disease", "gdd"],
};

/**
 * Nome leggibile di un modello DSS dal `model_name` `"<moduloId>_<dssId>"`:
 * rimuove il prefisso del module e normalizza separatori (es. `vite_peronospora`
 * → "Peronospora", `olivo_occhio-pavone` → "Occhio pavone").
 */
function prettyModelName(modelName: string): string {
  const senzaPrefisso = modelName.includes("_")
    ? modelName.slice(modelName.indexOf("_") + 1)
    : modelName;
  const testo = senzaPrefisso.replace(/[-_]+/g, " ").trim();
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

/**
 * Modulo crop (id) di ciascuna categoria. I `dss_results.model_name` sono
 * scritti come `"<moduloId>_<dssId>"` (vedi `outcomesToDssResults`), quindi la
 * coerenza crop↔modello (Modulo 1.2) si verifica sul PREFISSO del module —
 * robusto sia per i modelli patologici (es. `vite_peronospora`) sia per quelli
 * fenologici/accumulo (es. `cereali_spigatura`, `frutta_sviluppo-melo`), che il
 * vecchio match per parola-chiave-malattia escludeva per errore. `generic`
 * (null) non filtra: ammette tutti i modelli disponibili.
 */
const CATEGORY_MODULE_ID: Record<CropCategory, string | null> = {
  viticoltura: "vite",
  seminativo: "cereali",
  olivicoltura: "olivo",
  frutticoltura: "frutta",
  orticoltura: "orticoltura",
  generic: null,
};

/** true se il modello DSS appartiene alla famiglia botanica della categoria. */
function isDiseaseRelevant(modelName: string, category: CropCategory): boolean {
  const moduleId = CATEGORY_MODULE_ID[category];
  if (!moduleId) return true; // generic: nessun filtro
  return modelName.toLowerCase().startsWith(`${moduleId}_`);
}

// ---------------------------------------------------------------------------
// Tipi di uscita
// ---------------------------------------------------------------------------

export type KpiKind = "metric" | "chart" | "insight";
export type KpiSeverity = "neutral" | "good" | "warn" | "danger";

/** Risultato di un KPI pronto per la card della griglia. */
export interface KpiResult {
  id: string;
  kind: KpiKind;
  title: string;
  /** Valore numerico grezzo (null se non calcolabile). */
  value: number | null;
  /** Valore formattato per la card (es. "1.240", "62%"). */
  display: string;
  unit?: string;
  /** Variazione % rispetto al confronto (null se non confrontabile). */
  trendPct: number | null;
  /** Etichetta del confronto (es. "vs 2024"). */
  trendLabel?: string;
  /** Serie per la mini-chart/sparkline (vuota se non applicabile). */
  spark: number[];
  severity: KpiSeverity;
  /** Testo dell'insight azionabile (solo kind="insight"). */
  insight?: string;
  /**
   * Indice nello `spark` da cui inizia la proiezione (linea tratteggiata): i
   * punti < projectionStart sono storici, quelli ≥ sono previsionali. Usato dal
   * grafico GDD per la proiezione fenologica (Modulo 3.2). Assente = nessuna
   * proiezione.
   */
  projectionStart?: number;
  /** Parametri editabili che influenzano il calcolo (per il modale di modifica). */
  editableParams: (keyof KpiParams)[];
}

/** Sintesi del contesto analizzato (header del Command Center). */
export interface AnalyticsSummary {
  category: CropCategory;
  categoryLabel: string;
  plotCount: number;
  totalAreaHa: number;
  campaignYear: number;
}

export interface AnalyticsResult {
  summary: AnalyticsSummary;
  kpis: KpiResult[];
}

/** Bundle di dominio in ingresso al motore (materializzato dal DAL/store). */
export interface AnalyticsInput {
  plots: Plot[];
  crops: Crop[];
  /** Stato di campagna di TUTTE le annate disponibili (per il confronto storico). */
  campaignFields: PlotCampaign[];
  treatments: TreatmentLog[];
  harvests: Harvest[];
  dssRisultati: DssResult[];
  weather: WeatherReading[];
  soilIndices: SoilWaterIndex[];
  /** Filtri attivi della vista. */
  campaignYear: number;
  cropId: string | null;
  /**
   * Appezzamenti isolati dal filtro multi-plot / cross-filtering (Modulo 2).
   * Vuoto = nessun filtro per plot (tutto lo scope crop/annata). Quando
   * valorizzato, restringe lo scope a questi plots e tutti i KPI si
   * ricalcolano di conseguenza.
   */
  selectedPlotIds: string[];
  params: KpiParams;
}

// ---------------------------------------------------------------------------
// Helper numerici
// ---------------------------------------------------------------------------

// PGlite restituisce timestamptz/date come oggetti `Date` a runtime (i tipi TS
// dicono `string`): le helper accettano entrambe le forme.
type DateLike = string | Date;

function yearOf(value: DateLike): number {
  return new Date(value).getUTCFullYear();
}

function dayOf(value: DateLike): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Riduce una serie a al più `max` punti per la sparkline (soilSample uniforme). */
function downsample(values: number[], max = 24): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]);
  return out;
}

function trendPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function severityFromTrend(
  pct: number | null,
  higherIsBetter: boolean,
): KpiSeverity {
  if (pct == null || Math.abs(pct) < 3) return "neutral";
  const positive = pct > 0;
  return positive === higherIsBetter ? "good" : "warn";
}

// ---------------------------------------------------------------------------
// Aggregazioni meteo (GDD)
// ---------------------------------------------------------------------------

interface DailyTemp {
  date: string;
  min: number;
  max: number;
}

/** Aggrega le letture orarie in min/max giornalieri per l'anno dato. */
function dailyTemps(weather: WeatherReading[], year: number): DailyTemp[] {
  const byDay = new Map<string, { min: number; max: number }>();
  for (const r of weather) {
    if (r.air_temperature == null || yearOf(r.measured_at) !== year) continue;
    const d = dayOf(r.measured_at);
    const cur = byDay.get(d);
    if (!cur) byDay.set(d, { min: r.air_temperature, max: r.air_temperature });
    else {
      cur.min = Math.min(cur.min, r.air_temperature);
      cur.max = Math.max(cur.max, r.air_temperature);
    }
  }
  return [...byDay.entries()]
    .map(([date, t]) => ({ date, ...t }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * GDD accumulati (somma dei gradi-giorno) dalla data biofix. Separa la serie in
 * STORICO (giorni ≤ oggi, osservato) e PROIEZIONE (giorni futuri presenti come
 * previsione in `weather_readings`, fino a +16gg), per la linea tratteggiata
 * della proiezione fenologica (Modulo 3.2).
 */
function accumulatedGdd(
  weather: WeatherReading[],
  year: number,
  base: number,
  startMonth: number,
): {
  /** GDD accumulati a oggi (fine dello storico). */
  totalToday: number;
  /** GDD attesi a fine finestra previsionale. */
  projectedTotal: number;
  /** Cumulata sui giorni osservati (≤ oggi). */
  hist: number[];
  /** Cumulata che prosegue sui giorni previsionali (> oggi). */
  proj: number[];
  /** Giorni di previsione disponibili oltre oggi. */
  forecastDays: number;
} {
  const start = `${year}-${pad2(startMonth)}-01`;
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;
  let totalToday = 0;
  const hist: number[] = [];
  const proj: number[] = [];
  for (const d of dailyTemps(weather, year)) {
    if (d.date < start) continue;
    total += Math.max(0, (d.min + d.max) / 2 - base);
    if (d.date <= today) {
      hist.push(total);
      totalToday = total;
    } else {
      proj.push(total);
    }
  }
  return {
    totalToday,
    projectedTotal: total,
    hist,
    proj,
    forecastDays: proj.length,
  };
}

// ---------------------------------------------------------------------------
// Motore
// ---------------------------------------------------------------------------

/** Determina la categoria dominante tra le campagne selezionate. */
function dominantCategory(
  campaigns: PlotCampaign[],
  crops: Crop[],
  cropId: string | null,
): CropCategory {
  if (cropId) {
    return resolveCropCategory(crops.find((c) => c.id === cropId));
  }
  const tally = new Map<CropCategory, number>();
  for (const camp of campaigns) {
    const cat = resolveCropCategory(crops.find((c) => c.id === camp.crop_id));
    tally.set(cat, (tally.get(cat) ?? 0) + 1);
  }
  let best: CropCategory = "generic";
  let bestN = -1;
  for (const [cat, n] of tally) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

/**
 * Baseline NDVI storica dell'appezzamento per la settimana fenologica corrente
 * (media degli ultimi anni), se persistita in `metadata.ndvi_baseline`. Hook
 * tipizzato in attesa di uno storico NDVI per-settimana (pipeline STAC): finché
 * assente, ritorna null e l'anomalia ricade sulla baseline spaziale. `null` se
 * non presente o non numerica.
 */
function plotNdviBaseline(plot: Plot): number | null {
  const v = plot.metadata?.["ndvi_baseline"];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Esegue il motore: filtra il dominio per crop/annata e produce i KPI
 * (generici + specifici della categoria + insight azionabili).
 */
export function runCommandCenterEngine(input: AnalyticsInput): AnalyticsResult {
  const {
    plots,
    crops,
    campaignFields,
    treatments,
    harvests,
    dssRisultati,
    weather,
    soilIndices,
    campaignYear,
    cropId,
    selectedPlotIds,
    params,
  } = input;

  const plotFilter = new Set(selectedPlotIds);
  const hasPlotFilter = plotFilter.size > 0;
  const livePlots = plots.filter((a) => a.deleted_at == null);

  const liveCampaigns = campaignFields.filter((c) => c.deleted_at == null);
  const yearCampaigns = liveCampaigns.filter(
    (c) =>
      c.campaign_year === campaignYear && (!cropId || c.crop_id === cropId),
  );
  const prevCampaigns = liveCampaigns.filter(
    (c) =>
      c.campaign_year === campaignYear - 1 && (!cropId || c.crop_id === cropId),
  );

  // Insieme PEER (campagna/annata, senza il filtro plot): è la base spaziale per
  // l'anomalia ΔNDVI (Modulo 3.1). Fallback company-wide se l'annata non ha
  // record di Campagna Agraria e non c'è filtro crop.
  const companyWide = yearCampaigns.length === 0 && !cropId;
  const peerPlotIds = companyWide
    ? new Set(livePlots.map((a) => a.id))
    : new Set(yearCampaigns.map((c) => c.plot_id));
  const peerPlots = livePlots.filter((a) => peerPlotIds.has(a.id));

  // Scope effettivo = peer ∩ filtro multi-plot. Se l'annata non ha campagne ma
  // l'utente ha isolato dei plot, si usano comunque quelli.
  let plotIds = new Set(
    [...peerPlotIds].filter((id) => !hasPlotFilter || plotFilter.has(id)),
  );
  if (plotIds.size === 0 && hasPlotFilter) plotIds = new Set(plotFilter);

  const selectedPlots = livePlots.filter((a) => plotIds.has(a.id));
  const selectedCampaigns = yearCampaigns.filter((c) => plotIds.has(c.plot_id));
  const campaignIds = new Set(selectedCampaigns.map((c) => c.id));
  const prevPlotIds = new Set(
    prevCampaigns
      .map((c) => c.plot_id)
      .filter((id) => !hasPlotFilter || plotFilter.has(id)),
  );

  const category = dominantCategory(selectedCampaigns, crops, cropId);
  const totalAreaHa = selectedPlots.reduce((s, p) => s + (p.area_ha ?? 0), 0);

  const summary: AnalyticsSummary = {
    category,
    categoryLabel: CATEGORY_LABEL[category],
    plotCount: selectedPlots.length,
    totalAreaHa,
    campaignYear,
  };

  const kpis: KpiResult[] = [];

  // -- Anomalia di vigore ΔNDVI (Modulo 3.1) --------------------------------
  // ΔNDVI = NDVI_current − NDVI_baseline. La baseline preferita è lo STORICO
  // dello stesso plot per la settimana fenologica corrente (ultimi 5
  // anni), letto da `metadata.ndvi_baseline` se presente; in sua assenza si usa
  // la baseline SPAZIALE (media dell'annata sull'insieme peer), così l'anomalia
  // resta calcolabile finché non esiste uno storico NDVI persistito.
  const ndviValues = selectedPlots
    .map((p) => p.last_ndvi_mean)
    .filter((v): v is number => v != null);
  const ndviCurrent =
    ndviValues.length > 0
      ? ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length
      : null;

  const historicalBaselines = selectedPlots
    .map((p) => plotNdviBaseline(p))
    .filter((v): v is number => v != null);
  const hasFullHistory =
    historicalBaselines.length > 0 &&
    historicalBaselines.length === selectedPlots.filter((p) => p.last_ndvi_mean != null).length;

  const peerNdvi = peerPlots
    .map((p) => p.last_ndvi_mean)
    .filter((v): v is number => v != null);
  const spatialBaseline =
    peerNdvi.length > 0 ? peerNdvi.reduce((a, b) => a + b, 0) / peerNdvi.length : null;

  const baseline = hasFullHistory
    ? historicalBaselines.reduce((a, b) => a + b, 0) / historicalBaselines.length
    : spatialBaseline;
  const baselineLabel = hasFullHistory ? "vs storico 5 anni" : "vs media annata";

  const deltaNdvi =
    ndviCurrent != null && baseline != null ? ndviCurrent - baseline : null;
  const deltaPct =
    deltaNdvi != null && baseline != null && baseline > 0
      ? (deltaNdvi / baseline) * 100
      : null;
  // Scarto per-plot dalla baseline → distribuzione per la sparkline.
  const deltaSpark =
    baseline != null
      ? ndviValues.map((v) => (v - baseline) * 100)
      : [];
  kpis.push({
    id: "ndvi_anomaly",
    kind: "chart",
    title: "Anomalia vigore (ΔNDVI)",
    value: deltaNdvi,
    display:
      deltaNdvi != null
        ? `${deltaNdvi >= 0 ? "+" : ""}${deltaNdvi.toFixed(2)}`
        : "—",
    unit: ndviCurrent != null ? `NDVI ${ndviCurrent.toFixed(2)}` : baselineLabel,
    trendPct: deltaPct,
    trendLabel: baselineLabel,
    spark: downsample(deltaSpark),
    severity:
      deltaNdvi == null
        ? "neutral"
        : deltaNdvi >= 0.03
          ? "good"
          : deltaNdvi <= -0.08
            ? "danger"
            : deltaNdvi < -0.03
              ? "warn"
              : "neutral",
    editableParams: [],
  });

  // -- Operazioni fitosanitarie + confronto storico (generico) --------------
  const phytoCur = treatments.filter(
    (t) =>
      t.deleted_at == null &&
      t.operation_type === "phytosanitary" &&
      t.plot_id != null &&
      plotIds.has(t.plot_id) &&
      yearOf(t.executed_at) === campaignYear,
  );
  const phytoPrev = treatments.filter(
    (t) =>
      t.deleted_at == null &&
      t.operation_type === "phytosanitary" &&
      t.plot_id != null &&
      prevPlotIds.has(t.plot_id) &&
      yearOf(t.executed_at) === campaignYear - 1,
  );
  const phytoTrend = trendPct(phytoCur.length, phytoPrev.length);
  const monthly = new Array(12).fill(0);
  for (const t of phytoCur) monthly[new Date(t.executed_at).getUTCMonth()]++;
  kpis.push({
    id: "treatments_count",
    kind: "chart",
    title: "Trattamenti fitosanitari",
    value: phytoCur.length,
    display: String(phytoCur.length),
    unit: "interventi",
    trendPct: phytoTrend,
    trendLabel: `vs ${campaignYear - 1}`,
    spark: monthly,
    // Meno treatments = meglio (efficienza input): higherIsBetter=false.
    severity: severityFromTrend(phytoTrend, false),
    editableParams: [],
  });

  // -- Raccolto totale + resa per ha + confronto storico (generico) ---------
  const harvestCur = harvests.filter(
    (r) =>
      r.deleted_at == null &&
      ((r.plot_campaign_id != null && campaignIds.has(r.plot_campaign_id)) ||
        (r.plot_id != null && plotIds.has(r.plot_id))) &&
      yearOf(r.harvested_at) === campaignYear,
  );
  const harvestPrev = harvests.filter(
    (r) =>
      r.deleted_at == null &&
      r.plot_id != null &&
      prevPlotIds.has(r.plot_id) &&
      yearOf(r.harvested_at) === campaignYear - 1,
  );
  const harvestKg = harvestCur.reduce((s, r) => s + (r.quantity_kg ?? 0), 0);
  const harvestKgPrev = harvestPrev.reduce((s, r) => s + (r.quantity_kg ?? 0), 0);
  const yieldQ = totalAreaHa > 0 ? harvestKg / 100 / totalAreaHa : 0;
  const harvestTrend = trendPct(harvestKg, harvestKgPrev);
  kpis.push({
    id: "harvest_total",
    kind: "metric",
    title: "Resa di campagna",
    value: yieldQ,
    display: totalAreaHa > 0 ? yieldQ.toFixed(1) : "—",
    unit: "q/ha",
    trendPct: harvestTrend,
    trendLabel: `vs ${campaignYear - 1}`,
    spark: [],
    severity: severityFromTrend(harvestTrend, true),
    editableParams: [],
  });

  // -- Autonomia idrica RAW% (Modulo 1.1 + 3.3) -----------------------------
  // ETc per ettaro = MEDIA giornaliera tra gli plots (mm, intensiva), NON
  // somma cumulativa (fix del value aberrante). Il consumo idrico recente
  // (media ETc sugli ultimi N giorni) alimenta il contatore predittivo dei
  // giorni di autonomia prima dello stress idrico severo.
  const idx = soilIndices
    .filter((s) => s.plot_campaign_id != null && campaignIds.has(s.plot_campaign_id))
    .sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)));
  const win = Math.max(1, Math.round(params.etcWindowDays));
  const etcDaily = aggregateByDate(idx, (s) => s.etc, "mean");
  const recentEtc = etcDaily.slice(-win);
  const dailyEtcMean =
    recentEtc.length > 0
      ? recentEtc.reduce((a, b) => a + b.value, 0) / recentEtc.length
      : 0;

  const drDaily = aggregateByDate(idx, (s) => s.depletion_mm, "mean");
  const rawDaily = aggregateByDate(idx, (s) => s.raw_mm, "mean");
  // Stato CORRENTE (≤ oggi): gli indici includono i giorni di previsione in coda,
  // che altrimenti maschererebbero l'irrigazione recente (vedi computePlot).
  const lastDr = valueAsOfToday(drDaily);
  const lastRaw = valueAsOfToday(rawDaily);
  const residualMm =
    lastRaw != null && lastDr != null ? Math.max(0, lastRaw - lastDr) : null;
  const residualPct =
    residualMm != null && lastRaw != null && lastRaw > 0
      ? Math.max(0, Math.min(100, (residualMm / lastRaw) * 100))
      : null;
  const daysAutonomy =
    residualMm != null && dailyEtcMean > 0
      ? Math.floor(residualMm / dailyEtcMean)
      : null;
  // Sparkline RAW% residua nel tempo (per giorno: (RAW−Dr)/RAW).
  const rawPctSpark = rawDaily.map((r, i) => {
    const dr = drDaily[i]?.value ?? 0;
    return r.value > 0 ? Math.max(0, Math.min(100, ((r.value - dr) / r.value) * 100)) : 0;
  });
  // Totale irrigato nel periodo (mm): reso esplicito anche qui, così il KPI
  // mostra che il bilancio conteggia gli apporti irrigui dei log gestionali.
  const irrigationTotal = aggregateByDate(idx, (s) => s.irrigation_mm, "mean").reduce(
    (a, b) => a + b.value,
    0,
  );
  kpis.push({
    id: "water_autonomy",
    kind: "chart",
    title: "Autonomia idrica (RAW)",
    value: residualPct,
    display: residualPct != null ? `${Math.round(residualPct)}%` : "—",
    unit:
      daysAutonomy != null
        ? `~${daysAutonomy} gg · ETc ${dailyEtcMean.toFixed(1)} mm/gg`
        : idx.length > 0
          ? `ETc ${dailyEtcMean.toFixed(1)} mm/gg`
          : "nessun bilancio idrico",
    trendPct: null,
    trendLabel:
      irrigationTotal > 0.5
        ? `irrigato ${Math.round(irrigationTotal)} mm nel periodo`
        : "riserva prontamente disponibile",
    // Finestra recente: la sparkline mostra le dinamiche correnti (incl. irrigazioni),
    // non l'intera campagna compressa.
    spark: downsample(rawPctSpark.slice(-75)),
    severity:
      residualPct == null
        ? "neutral"
        : residualPct <= 10
          ? "danger"
          : residualPct <= 30
            ? "warn"
            : "good",
    editableParams: ["etcWindowDays"],
  });

  // -- Stress idrico medio (Suolo) ------------------------------------------
  const stressVals = idx.map((s) =>
    s.awc_mm > 0 ? Math.max(0, Math.min(1, s.depletion_mm / s.awc_mm)) : 0,
  );
  const stressMean =
    stressVals.length > 0
      ? stressVals.reduce((a, b) => a + b, 0) / stressVals.length
      : null;
  const stressDays = idx.filter((s) => s.water_stress).length;
  kpis.push({
    id: "water_stress",
    kind: "metric",
    title: "Stress idrico medio",
    value: stressMean,
    display: stressMean != null ? `${Math.round(stressMean * 100)}%` : "—",
    unit: `${stressDays} gg in stress`,
    trendPct: null,
    trendLabel: "depl. radicale / AWC",
    spark: downsample(stressVals.map((v) => v * 100)),
    severity:
      stressMean == null
        ? "neutral"
        : stressMean >= params.waterStressThreshold
          ? "danger"
          : stressMean >= params.waterStressThreshold * 0.7
            ? "warn"
            : "good",
    editableParams: ["waterStressThreshold"],
  });

  // -- GDD accumulati + proiezione fenologica (Modulo 3.2) ------------------
  const gdd = accumulatedGdd(
    weather,
    campaignYear,
    params.gddBase,
    params.gddStartMonth,
  );
  const histSpark = downsample(gdd.hist, 18);
  const projSpark = gdd.proj.length > 0 ? downsample(gdd.proj, 6) : [];
  const gddSpark = projSpark.length > 0 ? [...histSpark, ...projSpark] : histSpark;
  kpis.push({
    id: "gdd",
    kind: "chart",
    title: "GDD accumulati",
    value: gdd.totalToday,
    display: gdd.hist.length > 0 ? Math.round(gdd.totalToday).toLocaleString("it-IT") : "—",
    unit: `°Cd · base ${params.gddBase}°C`,
    trendPct: null,
    trendLabel:
      gdd.forecastDays > 0
        ? `proiez. +${gdd.forecastDays}gg → ${Math.round(gdd.projectedTotal).toLocaleString("it-IT")} °Cd`
        : `dal ${pad2(params.gddStartMonth)}/${campaignYear}`,
    spark: gddSpark,
    projectionStart: projSpark.length > 0 ? histSpark.length : undefined,
    severity: "neutral",
    editableParams: ["gddBase", "gddStartMonth"],
  });

  // -- Rischio fitopatologico (DSS, coerente con la crop — Modulo 1.2) ---
  // SOLO i modelli pertinenti alla famiglia botanica selezionata: niente
  // fallback a malattie di altre colture (es. olivo_occhio-pavone su seminativo).
  const pool = dssRisultati.filter(
    (d) =>
      d.plot_id != null &&
      plotIds.has(d.plot_id) &&
      isDiseaseRelevant(d.model_name, category),
  );
  const worst = pool.reduce<DssResult | null>((acc, d) => {
    if (!acc) return d;
    return riskRank(d.risk_level) > riskRank(acc.risk_level) ? d : acc;
  }, null);
  kpis.push({
    id: "disease",
    kind: "metric",
    title: worst ? `Rischio ${prettyModelName(worst.model_name)}` : "Rischio fitopatologico",
    value: worst ? worst.output_value : null,
    display: worst ? RISK_LABEL[worst.risk_level] : "—",
    unit: worst ? `indice ${worst.output_value.toFixed(1)}` : "nessun calcolo DSS",
    trendPct: null,
    spark: [],
    severity: worst
      ? worst.risk_level === "high"
        ? "danger"
        : worst.risk_level === "medium"
          ? "warn"
          : "good"
      : "neutral",
    editableParams: [],
  });

  // -- Selezione: generici + specifici categoria ----------------------------
  const genericIds = [
    "ndvi_anomaly",
    "treatments_count",
    "harvest_total",
    "water_autonomy",
  ];
  const wantedIds = [...new Set([...genericIds, ...CROP_KPI_IDS[category]])];
  const ordered = wantedIds
    .map((id) => kpis.find((k) => k.id === id))
    .filter((k): k is KpiResult => k != null);

  // -- Insight azionabili ---------------------------------------------------
  ordered.push(
    ...buildInsights({ stressMean, worst, phytoCur, ndviMean: ndviCurrent, params }),
  );

  return { summary, kpis: ordered };
}

const RISK_LABEL: Record<DssResult["risk_level"], string> = {
  low: "Basso",
  medium: "Medio",
  high: "Elevato",
};

function riskRank(level: DssResult["risk_level"]): number {
  return level === "high" ? 2 : level === "medium" ? 1 : 0;
}

interface DatedValue {
  date: string;
  value: number;
}

/**
 * Aggrega una metrica idrica per data su più plots. Gli indici idrici
 * (et0/etc/depletion/raw/awc) sono in mm, grandezze INTENSIVE (già per unità di
 * superficie): vanno mediati tra i poligoni, NON sommati (la somma su N campi
 * gonfiava l'ETc — Modulo 1.1). `mode` distingue media (default) da somma.
 */
function aggregateByDate(
  idx: SoilWaterIndex[],
  pick: (s: SoilWaterIndex) => number,
  mode: "mean" | "sum" = "mean",
): DatedValue[] {
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const s of idx) {
    const k = dayOf(s.date);
    const cur = byDay.get(k) ?? { sum: 0, n: 0 };
    cur.sum += pick(s);
    cur.n += 1;
    byDay.set(k, cur);
  }
  return [...byDay.entries()]
    .map(([date, c]) => ({ date, value: mode === "mean" ? c.sum / c.n : c.sum }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Ultimo value con data ≤ oggi (stato corrente), ignorando i giorni di previsione. */
function valueAsOfToday(series: DatedValue[]): number | null {
  const today = new Date().toISOString().slice(0, 10);
  let v: number | null = null;
  for (const d of series) {
    if (d.date <= today) v = d.value;
    else break;
  }
  return v ?? series[series.length - 1]?.value ?? null;
}

/** Genera gli insight azionabili dalle condizioni correnti del field. */
function buildInsights(args: {
  stressMean: number | null;
  worst: DssResult | null;
  phytoCur: TreatmentLog[];
  ndviMean: number | null;
  params: KpiParams;
}): KpiResult[] {
  const { stressMean, worst, phytoCur, ndviMean, params } = args;
  const out: KpiResult[] = [];

  if (stressMean != null && stressMean >= params.waterStressThreshold) {
    out.push(insight(
      "insight_water",
      "Irrigazione consigliata",
      `La deplezione radicale media (${Math.round(stressMean * 100)}%) ha superato la soglia di allerta (${Math.round(params.waterStressThreshold * 100)}%). Pianifica un turno irriguo per riportare il profile sotto RAW.`,
      "danger",
    ));
  }

  if (worst && worst.risk_level === "high") {
    out.push(insight(
      "insight_disease",
      "Finestra di trattamento",
      `Rischio elevato per ${worst.model_name} (indice ${worst.output_value.toFixed(1)}). Valuta un intervento nei prossimi giorni rispettando i tempi di carenza.`,
      "danger",
    ));
  }

  // Operazioni + NDVI: molti treatments a fronte di vigore basso.
  if (ndviMean != null && ndviMean < 0.45 && phytoCur.length >= 4) {
    out.push(insight(
      "insight_efficiency",
      "Efficienza input da rivedere",
      `${phytoCur.length} treatments con vigore medio basso (NDVI ${ndviMean.toFixed(2)}): la risposta vegetativa non giustifica l'intensità degli input. Verifica avversità e strategia agronomica.`,
      "warn",
    ));
  }

  if (out.length === 0) {
    out.push(insight(
      "insight_ok",
      "Nessuna criticità rilevata",
      "Stress idrico, rischio fitopatologico e vigore sono entro i valori attesi per la crop e l'annata selezionate.",
      "good",
    ));
  }

  return out;
}

function insight(
  id: string,
  title: string,
  text: string,
  severity: KpiSeverity,
): KpiResult {
  return {
    id,
    kind: "insight",
    title,
    value: null,
    display: "",
    trendPct: null,
    spark: [],
    severity,
    insight: text,
    editableParams: [],
  };
}
