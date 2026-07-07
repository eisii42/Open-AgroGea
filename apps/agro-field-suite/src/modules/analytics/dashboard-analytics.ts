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
 * renderer. Tutto puro e in-memory sui dati già filtrati.
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
  /** Proietta il dominio (filtrato) in righe piatte dimensione/misura. */
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

/** Mappa plot_id → nome appezzamento. */
function plotNames(data: DashboardData): Map<string, string> {
  return new Map(data.plots.map((a) => [a.id, a.user_plot_name]));
}

/** Mappa plot_id → superficie (ha), per i rapporti per ettaro (es. resa/ha). */
function plotAreas(data: DashboardData): Map<string, number> {
  return new Map(data.plots.map((a) => [a.id, a.area_ha]));
}

/** Mappa plot_campaign_id → nome appezzamento (per il bilancio idrico). */
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
      { key: "nome", label: "Nome", kind: "dimension" },
      { key: "coltura", label: "CropType", kind: "dimension" },
      { key: "irrigazione", label: "Tipo irrigazione", kind: "dimension" },
      { key: "anno", label: "Anno impianto", kind: "dimension" },
      { key: "area_ha", label: "Superficie (ha)", kind: "measure" },
      { key: "ndvi", label: "NDVI medio", kind: "measure" },
    ],
    rows: (d) => {
      const cropName = new Map(d.crops.map((c) => [c.id, c.common_name]));
      const plotCrop = new Map<string, string>();
      for (const c of d.campaigns) plotCrop.set(c.plot_id, cropName.get(c.crop_id) ?? "—");
      return d.plots.map((a) => ({
        nome: a.user_plot_name,
        coltura: plotCrop.get(a.id) ?? "—",
        irrigazione: a.irrigation_type ?? "—",
        anno: a.planting_year ?? "—",
        area_ha: a.area_ha,
        ndvi: a.last_ndvi_mean,
      }));
    },
  },
  {
    id: "treatments",
    label: "Operazioni (Quaderno)",
    fields: [
      { key: "tipo", label: "Tipo operazione", kind: "dimension" },
      { key: "prodotto", label: "Product", kind: "dimension" },
      { key: "avversita", label: "Avversità", kind: "dimension" },
      { key: "mese", label: "Mese", kind: "dimension", temporal: true },
      { key: "appezzamento", label: "Plot", kind: "dimension" },
      { key: "dose", label: "Dose", kind: "measure" },
      { key: "quantita", label: "Quantità totale", kind: "measure" },
      { key: "acqua_l", label: "Acqua (l)", kind: "measure" },
      { key: "area_ha", label: "Superficie (ha)", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      const areas = plotAreas(d);
      return d.treatments
        .filter((t) => t.deleted_at == null)
        .map((t) => ({
          tipo: OP_LABEL[t.operation_type] ?? t.operation_type,
          prodotto: t.product_name ?? "—",
          avversita: t.target_disease ?? "—",
          mese: monthKey(t.executed_at),
          appezzamento: t.plot_id ? names.get(t.plot_id) ?? "—" : "Intera azienda",
          dose: t.dose_value,
          quantita: t.total_quantity,
          acqua_l: t.water_volume_l,
          area_ha: t.plot_id ? areas.get(t.plot_id) ?? null : null,
        }));
    },
  },
  {
    id: "harvests",
    label: "Raccolte",
    fields: [
      { key: "cultivar", label: "Cultivar", kind: "dimension" },
      { key: "destinazione", label: "Destinazione", kind: "dimension" },
      { key: "mese", label: "Mese", kind: "dimension", temporal: true },
      { key: "appezzamento", label: "Plot", kind: "dimension" },
      { key: "kg", label: "Quantità (kg)", kind: "measure" },
      { key: "area_ha", label: "Superficie (ha)", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      const areas = plotAreas(d);
      return d.harvests
        .filter((r) => r.deleted_at == null)
        .map((r) => ({
          cultivar: r.cultivar ?? "—",
          destinazione: r.destination_logistics ?? "—",
          mese: monthKey(r.harvested_at),
          appezzamento: r.plot_id ? names.get(r.plot_id) ?? "—" : "—",
          kg: r.quantity_kg,
          area_ha: r.plot_id ? areas.get(r.plot_id) ?? null : null,
        }));
    },
  },
  {
    id: "water",
    label: "Bilancio idrico (giornaliero)",
    fields: [
      { key: "data", label: "Data", kind: "dimension", temporal: true },
      { key: "appezzamento", label: "Plot", kind: "dimension" },
      { key: "et0", label: "ET0", kind: "measure" },
      { key: "etc", label: "ETc", kind: "measure" },
      { key: "dr", label: "Deplezione Dr", kind: "measure" },
      { key: "raw", label: "RAW", kind: "measure" },
      { key: "irrigazione", label: "Irrigazione", kind: "measure" },
      { key: "pioggia", label: "Pioggia", kind: "measure" },
      { key: "percolazione", label: "Percolazione", kind: "measure" },
    ],
    rows: (d) => {
      const names = campaignPlotNames(d);
      return d.soilIndices.map((s) => ({
        data: dayKey(s.date),
        appezzamento: s.plot_campaign_id ? names.get(s.plot_campaign_id) ?? "—" : "—",
        et0: s.et0,
        etc: s.etc,
        dr: s.depletion_mm,
        raw: s.raw_mm,
        irrigazione: s.irrigation_mm,
        pioggia: s.rain_mm,
        percolazione: s.deep_percolation_mm,
      }));
    },
  },
  {
    id: "weather",
    label: "Meteo (orario)",
    fields: [
      { key: "data", label: "Giorno", kind: "dimension", temporal: true },
      { key: "temperatura", label: "Temperatura", kind: "measure" },
      { key: "pioggia", label: "Pioggia", kind: "measure" },
      { key: "umidita", label: "Umidità", kind: "measure" },
      { key: "vento", label: "Vento", kind: "measure" },
    ],
    rows: (d) =>
      d.weather.map((w) => ({
        data: dayKey(w.measured_at),
        temperatura: w.air_temperature,
        pioggia: w.rain_mm,
        umidita: w.relative_humidity,
        vento: w.wind_speed,
      })),
  },
  {
    id: "dss",
    label: "DSS (rischio modelli)",
    fields: [
      { key: "modello", label: "Modello", kind: "dimension" },
      { key: "appezzamento", label: "Plot", kind: "dimension" },
      { key: "valore", label: "Indice di rischio", kind: "measure" },
    ],
    rows: (d) => {
      const names = plotNames(d);
      return d.dssRisultati.map((r) => ({
        modello: prettyModel(r.model_name),
        appezzamento: r.plot_id ? names.get(r.plot_id) ?? "—" : "—",
        valore: r.output_value,
      }));
    },
  },
];

export function entityById(id: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.id === id);
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

interface Bucket {
  /** Valori della misura (numeratore). */
  num: number[];
  /** Valori del denominatore (solo ratio). */
  den: number[];
}

function fieldLabel(entity: string, key: string | undefined): string {
  if (!key) return "";
  return entityById(entity)?.fields.find((f) => f.key === key)?.label ?? key;
}

/** Valore aggregato di un bucket secondo la funzione scelta. */
function bucketValue(b: Bucket, agg: Aggregation): number {
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

  const isMonth = temporal && dimField?.key === "mese";
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
