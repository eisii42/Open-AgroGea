import type { OperationType } from "@agrogea/core";
import {
  type ChartData,
  type DashboardData,
  PALETTE,
  dayKey,
  r1,
  shortDate,
} from "./dashboard-datasets";

/**
 * Motore di ANALISI LIBERA della dashboard aziendale: l'utente sceglie un'ENTITÀ
 * (plots, operazioni, harvests, bilancio idrico, meteo, DSS), una
 * DIMENSIONE su cui raggruppare e una FUNZIONE (conteggio/somma/media/min/max)
 * applicata a una MISURA. Il risultato è una {@link ChartData} pronta per il
 * renderer. Tutto puro e in-memory sui dati già filtered.
 */

export type Aggregation = "count" | "sum" | "avg" | "min" | "max" | "ratio";

export const AGGREGATIONS: { id: Aggregation; label: string }[] = [
  { id: "count", label: "Conteggio" },
  { id: "sum", label: "Somma" },
  { id: "avg", label: "Media" },
  { id: "min", label: "Minimo" },
  { id: "max", label: "Massimo" },
  { id: "ratio", label: "Rapporto (A / B)" },
];

export interface EntityField {
  key: string;
  label: string;
  kind: "dimension" | "measure";
  /** Per le dimensioni temporali (ordinamento cronologico + label data). */
  temporal?: boolean;
}

type Flat = Record<string, string | number | null>;

export interface EntityDef {
  id: string;
  label: string;
  fields: EntityField[];
  /** Proietta il dominio (filtrato) in rows piatte dimensione/misura. */
  rows: (data: DashboardData) => Flat[];
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const OP_LABEL: Record<OperationType, string> = {
  phytosanitary: "Trattamenti",
  fertilization: "Fertilizzazioni",
  irrigation: "Irrigazioni",
  tillage: "Lavorazioni",
  sowing: "Semine",
  harvest: "Raccolte",
  sampling: "Campionamenti",
};

const MONTHS = [
  "gen", "feb", "mar", "apr", "mag", "giu",
  "lug", "ago", "set", "ott", "nov", "dic",
];

function monthKey(v: string | Date): string {
  return dayKey(v).slice(0, 7); // "YYYY-MM"
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} ${y?.slice(2) ?? ""}` : key;
}

function prettyModel(modelName: string): string {
  const tail = modelName.includes("_")
    ? modelName.slice(modelName.indexOf("_") + 1)
    : modelName;
  const t = tail.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Mappa plot_id → name plot. */
function plotNames(data: DashboardData): Map<string, string> {
  return new Map(data.plots.map((a) => [a.id, a.user_plot_name]));
}

/** Mappa plot_id → area (ha), per i rapporti per ettaro (es. resa/ha). */
function plotAreas(data: DashboardData): Map<string, number> {
  return new Map(data.plots.map((a) => [a.id, a.area_ha]));
}

/** Mappa plot_campaign_id → name plot (per il bilancio idrico). */
function campaignPlotNames(data: DashboardData): Map<string, string> {
  const byPlot = plotNames(data);
  const m = new Map<string, string>();
  for (const c of data.campaigns) {
    m.set(c.id, byPlot.get(c.plot_id) ?? "—");
  }
  return m;
}

// ---------------------------------------------------------------------------
// Entità
// ---------------------------------------------------------------------------

export const ENTITIES: EntityDef[] = [
  {
    id: "plots",
    label: "Appezzamenti",
    fields: [
      { key: "name", label: "Nome", kind: "dimension" },
      { key: "crop", label: "Coltura", kind: "dimension" },
      { key: "irrigation", label: "Tipo irrigazione", kind: "dimension" },
      { key: "plantingYear", label: "Anno impianto", kind: "dimension" },
      { key: "areaHa", label: "Superficie (ha)", kind: "measure" },
      { key: "ndvi", label: "NDVI medio", kind: "measure" },
    ],
    rows: (d) => {
      const cropName = new Map(d.crops.map((c) => [c.id, c.common_name]));
      const plotCrop = new Map<string, string>();
      for (const c of d.campaigns) plotCrop.set(c.plot_id, cropName.get(c.crop_id) ?? "—");
      return d.plots.map((a) => ({
        name: a.user_plot_name,
        crop: plotCrop.get(a.id) ?? "—",
        irrigation: a.irrigation_type ?? "—",
        plantingYear: a.planting_year ?? "—",
        areaHa: a.area_ha,
        ndvi: a.last_ndvi_mean,
      }));
    },
  },
  {
    id: "treatments",
    label: "Operazioni (Quaderno)",
    fields: [
      { key: "operationType", label: "Tipo operazione", kind: "dimension" },
      { key: "product", label: "Prodotto", kind: "dimension" },
      { key: "target", label: "Avversità", kind: "dimension" },
      { key: "month", label: "Mese", kind: "dimension", temporal: true },
      { key: "plot", label: "Appezzamento", kind: "dimension" },
      { key: "dose", label: "Dose", kind: "measure" },
      { key: "quantity", label: "Quantità totale", kind: "measure" },
      { key: "waterL", label: "Acqua (l)", kind: "measure" },
      { key: "areaHa", label: "Superficie (ha)", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      const areas = plotAreas(d);
      return d.treatments
        .filter((t) => t.deleted_at == null)
        .map((t) => ({
          operationType: OP_LABEL[t.operation_type] ?? t.operation_type,
          product: t.product_name ?? "—",
          target: t.target_disease ?? "—",
          month: monthKey(t.executed_at),
          plot: t.plot_id ? names.get(t.plot_id) ?? "—" : "Intera azienda",
          dose: t.dose_value,
          quantity: t.total_quantity,
          waterL: t.water_volume_l,
          areaHa: t.plot_id ? areas.get(t.plot_id) ?? null : null,
        }));
    },
  },
  {
    id: "harvests",
    label: "Raccolte",
    fields: [
      { key: "cultivar", label: "Cultivar", kind: "dimension" },
      { key: "destination", label: "Destinazione", kind: "dimension" },
      { key: "month", label: "Mese", kind: "dimension", temporal: true },
      { key: "plot", label: "Appezzamento", kind: "dimension" },
      { key: "kg", label: "Quantità (kg)", kind: "measure" },
      { key: "areaHa", label: "Superficie (ha)", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      const areas = plotAreas(d);
      return d.harvests
        .filter((r) => r.deleted_at == null)
        .map((r) => ({
          cultivar: r.cultivar ?? "—",
          destination: r.destination_logistics ?? "—",
          month: monthKey(r.harvested_at),
          plot: r.plot_id ? names.get(r.plot_id) ?? "—" : "—",
          kg: r.quantity_kg,
          areaHa: r.plot_id ? areas.get(r.plot_id) ?? null : null,
        }));
    },
  },
  {
    id: "water",
    label: "Bilancio idrico (giornaliero)",
    fields: [
      { key: "date", label: "Data", kind: "dimension", temporal: true },
      { key: "plot", label: "Appezzamento", kind: "dimension" },
      { key: "et0", label: "ET0 (mm)", kind: "measure" },
      { key: "etc", label: "ETc (mm)", kind: "measure" },
      { key: "depletion", label: "Deplezione Dr (mm)", kind: "measure" },
      { key: "raw", label: "RAW (mm)", kind: "measure" },
      { key: "irrigation", label: "Irrigazione (mm)", kind: "measure" },
      { key: "rain", label: "Pioggia (mm)", kind: "measure" },
      { key: "percolation", label: "Percolazione (mm)", kind: "measure" },
    ],
    rows: (d) => {
      const names = campaignPlotNames(d);
      return d.soilIndices.map((s) => ({
        date: dayKey(s.date),
        plot: s.plot_campaign_id ? names.get(s.plot_campaign_id) ?? "—" : "—",
        et0: s.et0,
        etc: s.etc,
        depletion: s.depletion_mm,
        raw: s.raw_mm,
        irrigation: s.irrigation_mm,
        rain: s.rain_mm,
        percolation: s.deep_percolation_mm,
      }));
    },
  },
  {
    id: "weather",
    label: "Meteo (orario)",
    fields: [
      { key: "date", label: "Giorno", kind: "dimension", temporal: true },
      { key: "temperature", label: "Temperatura (°C)", kind: "measure" },
      { key: "rain", label: "Pioggia (mm)", kind: "measure" },
      { key: "humidity", label: "Umidità (%)", kind: "measure" },
      { key: "wind", label: "Vento (m/s)", kind: "measure" },
    ],
    rows: (d) =>
      d.weather.map((w) => ({
        date: dayKey(w.measured_at),
        temperature: w.air_temperature,
        rain: w.rain_mm,
        humidity: w.relative_humidity,
        wind: w.wind_speed,
      })),
  },
  {
    id: "dss",
    label: "DSS (rischio modelli)",
    fields: [
      { key: "model", label: "Modello", kind: "dimension" },
      { key: "plot", label: "Appezzamento", kind: "dimension" },
      { key: "date", label: "Giorno", kind: "dimension", temporal: true },
      { key: "value", label: "Indice di rischio", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      return d.dssResults.map((r) => ({
        model: prettyModel(r.model_name),
        plot: r.plot_id ? names.get(r.plot_id) ?? "—" : "—",
        date: dayKey(r.calculated_at),
        value: r.output_value,
      }));
    },
  },
];

export function entityById(id: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.id === id);
}

/**
 * Rinomine delle chiavi dei campi (per entità), per non buttare via le config
 * salvate prima dell'allineamento chiavi-righe. Vecchia chiave → nuova.
 */
const LEGACY_FIELD_KEYS: Record<string, Record<string, string>> = {
  plots: {
    nome: "name",
    coltura: "crop",
    irrigazione: "irrigation",
    anno: "plantingYear",
    area_ha: "areaHa",
  },
  treatments: {
    tipo: "operationType",
    prodotto: "product",
    avversita: "target",
    mese: "month",
    appezzamento: "plot",
    quantita: "quantity",
    acqua_l: "waterL",
    area_ha: "areaHa",
  },
  harvests: {
    destinazione: "destination",
    mese: "month",
    appezzamento: "plot",
    area_ha: "areaHa",
  },
  water: {
    data: "date",
    appezzamento: "plot",
    dr: "depletion",
    irrigazione: "irrigation",
    pioggia: "rain",
    percolazione: "percolation",
  },
  weather: {
    data: "date",
    temperatura: "temperature",
    pioggia: "rain",
    umidita: "humidity",
    vento: "wind",
  },
  dss: {
    modello: "model",
    appezzamento: "plot",
    valore: "value",
  },
};

/** Traduce una chiave campo salvata (eventualmente legacy) in quella corrente. */
export function currentFieldKey(entityId: string, key: unknown): string | null {
  if (typeof key !== "string") return null;
  const entity = entityById(entityId);
  if (!entity) return null;
  if (entity.fields.some((f) => f.key === key)) return key;
  const renamed = LEGACY_FIELD_KEYS[entityId]?.[key];
  return renamed && entity.fields.some((f) => f.key === renamed)
    ? renamed
    : null;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface QuerySpec {
  entity: string;
  dimension: string;
  /** Misura aggregata (numeratore per "ratio"; ignorata se "count"). */
  measure: string;
  /** Denominatore del rapporto (solo aggregation = "ratio"). */
  measure2?: string;
  aggregation: Aggregation;
}

export interface Bucket {
  /** Valori della misura (numeratore). */
  num: number[];
  /** Valori del denominatore (solo ratio). */
  den: number[];
}

function fieldLabel(entity: string, key: string | undefined): string {
  if (!key) return "";
  return entityById(entity)?.fields.find((f) => f.key === key)?.label ?? key;
}

/**
 * Valore aggregato di un bucket secondo la funzione scelta. Esportata perché è
 * la stessa aritmetica delle schede KPI custom (`kpi-cards.ts`), che aggregano
 * senza raggruppare per dimensione.
 */
export function bucketValue(b: Bucket, agg: Aggregation): number {
  if (agg === "count") return b.num.length;
  if (agg === "ratio") {
    const den = b.den.reduce((a, c) => a + c, 0);
    return den !== 0 ? b.num.reduce((a, c) => a + c, 0) / den : 0;
  }
  if (b.num.length === 0) return 0;
  if (agg === "sum") return b.num.reduce((a, c) => a + c, 0);
  if (agg === "avg") return b.num.reduce((a, c) => a + c, 0) / b.num.length;
  if (agg === "min") return Math.min(...b.num);
  return Math.max(...b.num);
}

/** Etichetta descrittiva della serie (es. "Media ETc", "kg / ha"). */
export function seriesLabel(spec: QuerySpec): string {
  if (spec.aggregation === "count") return "Conteggio";
  if (spec.aggregation === "ratio") {
    return `${fieldLabel(spec.entity, spec.measure)} / ${fieldLabel(spec.entity, spec.measure2)}`;
  }
  const agg = AGGREGATIONS.find((a) => a.id === spec.aggregation)?.label ?? "";
  return `${agg} ${fieldLabel(spec.entity, spec.measure)}`;
}

/** Esegue la query: raggruppa per dimensione e applica la funzione alla misura. */
export function buildQuery(spec: QuerySpec, data: DashboardData): ChartData {
  const entity = entityById(spec.entity);
  if (!entity) return { rows: [], categoryKey: "x", series: [], empty: true };
  const rows = entity.rows(data);
  const dimField = entity.fields.find((f) => f.key === spec.dimension);
  const temporal = dimField?.temporal === true;

  const groups = new Map<string, Bucket>();
  for (const row of rows) {
    const rawDim = row[spec.dimension];
    const key = rawDim == null || rawDim === "" ? "—" : String(rawDim);
    const b = groups.get(key) ?? { num: [], den: [] };
    if (spec.aggregation === "count") {
      b.num.push(1);
    } else {
      const m = row[spec.measure];
      if (typeof m === "number" && Number.isFinite(m)) b.num.push(m);
      if (spec.aggregation === "ratio" && spec.measure2) {
        const d = row[spec.measure2];
        if (typeof d === "number" && Number.isFinite(d)) b.den.push(d);
      }
    }
    groups.set(key, b);
  }

  let entries = [...groups.entries()];
  if (temporal) {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    entries = entries.slice(-120); // finestra temporale leggibile
  } else {
    entries.sort(
      (a, b) => bucketValue(b[1], spec.aggregation) - bucketValue(a[1], spec.aggregation),
    );
    entries = entries.slice(0, 30); // top categorie
  }

  const isMonth = temporal && dimField?.key === "month";
  const out = entries.map(([key, b]) => ({
    x: temporal ? (isMonth ? monthLabel(key) : shortDate(key)) : key,
    value: r1(bucketValue(b, spec.aggregation)),
  }));

  return {
    rows: out,
    categoryKey: "x",
    series: [{ key: "value", label: seriesLabel(spec), color: PALETTE[0] }],
    empty: out.length === 0,
  };
}
