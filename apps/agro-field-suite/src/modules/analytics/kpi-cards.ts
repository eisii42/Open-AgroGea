import {
  type Aggregation,
  type EntityDef,
  bucketValue,
  entityById,
} from "./dashboard-analytics";
import {
  type DashboardData,
  type TemporalRange,
  campaignYearRange,
  filterByRange,
} from "./dashboard-datasets";

/**
 * Schede KPI PERSONALIZZATE del Command Center (Modulo 3). Sostituiscono la
 * vecchia griglia a indici fissi (anomalia di vigore, trattamenti, GDD, rischio
 * malattie, stress idrico): l'utente compone l'indice che gli serve scegliendo
 * entità → funzione(misura) → periodo, con filtro e soglie facoltativi.
 *
 * Il catalogo dei dati è lo STESSO dell'analisi libera dei grafici
 * (`dashboard-analytics`): ogni entità già proiettata in righe piatte è
 * disponibile qui senza duplicare una riga di logica. La differenza è che una
 * scheda non raggruppa per dimensione — aggrega tutto in UN numero, e usa la
 * dimensione temporale dell'entità solo per la sparkline e la variazione.
 *
 * Modulo PURO (nessun React, nessun I/O): il rendering vive in
 * `CustomKpiCards.tsx`, la persistenza in `kpi-cards-config.ts`.
 */

/** Periodo su cui si calcola una scheda. */
export type KpiPeriod =
  | { kind: "campaign" }
  | { kind: "lastDays"; days: number }
  | { kind: "all" };

/** Soglie di colore della scheda. `null` = soglia disattivata. */
export interface KpiThresholds {
  warn: number | null;
  danger: number | null;
  /**
   * "above": si allarma quando il valore SUPERA la soglia (es. giorni di stress);
   * "below": quando ci scende sotto (es. NDVI medio).
   */
  direction: "above" | "below";
}

/** Filtro facoltativo su una dimensione dell'entità (es. tipo operazione). */
export interface KpiFilter {
  dimension: string;
  value: string;
}

export interface CustomKpiCard {
  id: string;
  title: string;
  /** Id di un'entità di `ENTITIES` (dashboard-analytics). */
  entity: string;
  aggregation: Aggregation;
  /** Misura aggregata (numeratore per "ratio"; ignorata se "count"). */
  measure: string;
  /** Denominatore del rapporto (solo aggregation = "ratio"). */
  measure2?: string;
  filter?: KpiFilter;
  /** Unità mostrata accanto al valore (testo libero, es. "mm", "kg/ha"). */
  unit?: string;
  decimals: number;
  period: KpiPeriod;
  /** Sparkline + variazione rispetto alla media del periodo precedente. */
  trend: boolean;
  thresholds?: KpiThresholds;
}

export type KpiSeverity = "neutral" | "good" | "warn" | "danger";

/** Esito del calcolo di una scheda, pronto per il rendering. */
export interface KpiCardValue {
  value: number;
  display: string;
  /** Serie per la sparkline (vuota se la scheda non ha trend o dati). */
  spark: number[];
  /** Variazione % dell'ultimo punto sulla media dei precedenti; null se non calcolabile. */
  trendPct: number | null;
  severity: KpiSeverity;
  /** true quando nessun record rientra nel periodo/filtro: si mostra "—". */
  empty: boolean;
  /** Record che concorrono al valore (nota sotto la scheda). */
  sampleCount: number;
}

/** Massimo di punti nella sparkline: oltre, la scheda diventa illeggibile. */
const MAX_SPARK_POINTS = 40;

/** Intervallo temporale coperto da un periodo di scheda. */
export function rangeForPeriod(
  period: KpiPeriod,
  campaignYear: number,
  today = new Date(),
): TemporalRange {
  if (period.kind === "all") return { from: null, to: null };
  if (period.kind === "lastDays") {
    const from = new Date(today);
    from.setDate(from.getDate() - Math.max(1, period.days) + 1);
    return {
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    };
  }
  return campaignYearRange(campaignYear);
}

/** Prima dimensione temporale dell'entità (quella che regge la sparkline). */
function temporalField(entity: EntityDef): string | null {
  return entity.fields.find((f) => f.temporal)?.key ?? null;
}

/** Valori distinti di una dimensione, per il selettore di filtro del modale. */
export function dimensionValues(
  entityId: string,
  dimension: string,
  data: DashboardData,
): string[] {
  const entity = entityById(entityId);
  if (!entity) return [];
  const set = new Set<string>();
  for (const row of entity.rows(data)) {
    const raw = row[dimension];
    if (raw == null || raw === "") continue;
    set.add(String(raw));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Aggiunge il valore di una riga al bucket, secondo la funzione scelta. */
function pushRow(
  bucket: { num: number[]; den: number[] },
  row: Record<string, string | number | null>,
  card: CustomKpiCard,
): void {
  if (card.aggregation === "count") {
    bucket.num.push(1);
    return;
  }
  const m = row[card.measure];
  if (typeof m === "number" && Number.isFinite(m)) bucket.num.push(m);
  if (card.aggregation === "ratio" && card.measure2) {
    const d = row[card.measure2];
    if (typeof d === "number" && Number.isFinite(d)) bucket.den.push(d);
  }
}

/** Formato numerico italiano con i decimali richiesti dalla scheda. */
function formatValue(value: number, decimals: number): string {
  return value.toLocaleString("it-IT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Colore della scheda date le soglie: nessuna soglia = neutro. */
function severityFor(
  value: number,
  thresholds: KpiThresholds | undefined,
): KpiSeverity {
  if (!thresholds) return "neutral";
  const { warn, danger, direction } = thresholds;
  if (warn == null && danger == null) return "neutral";
  const crossed = (limit: number) =>
    direction === "above" ? value >= limit : value <= limit;
  if (danger != null && crossed(danger)) return "danger";
  if (warn != null && crossed(warn)) return "warn";
  return "good";
}

/**
 * Calcola una scheda sul bundle di dominio già ristretto agli plots in
 * scope. Il periodo della scheda taglia ulteriormente per data.
 */
export function computeKpiCard(
  card: CustomKpiCard,
  data: DashboardData,
  campaignYear: number,
  today = new Date(),
): KpiCardValue {
  const empty: KpiCardValue = {
    value: 0,
    display: "—",
    spark: [],
    trendPct: null,
    severity: "neutral",
    empty: true,
    sampleCount: 0,
  };

  const entity = entityById(card.entity);
  if (!entity) return empty;

  const scoped = filterByRange(
    data,
    rangeForPeriod(card.period, campaignYear, today),
  );
  const rows = entity.rows(scoped).filter((row) => {
    if (!card.filter) return true;
    const raw = row[card.filter.dimension];
    return String(raw ?? "") === card.filter.value;
  });
  if (rows.length === 0) return empty;

  const bucket = { num: [] as number[], den: [] as number[] };
  for (const row of rows) pushRow(bucket, row, card);
  if (bucket.num.length === 0) return { ...empty, sampleCount: rows.length };

  const value = bucketValue(bucket, card.aggregation);

  // Sparkline: stessa aggregazione, ma raggruppata per la dimensione temporale
  // dell'entità (giorno o mese, a seconda di come è proiettata).
  let spark: number[] = [];
  const timeKey = card.trend ? temporalField(entity) : null;
  if (timeKey) {
    const byTime = new Map<string, { num: number[]; den: number[] }>();
    for (const row of rows) {
      const raw = row[timeKey];
      if (raw == null || raw === "") continue;
      const key = String(raw);
      const b = byTime.get(key) ?? { num: [], den: [] };
      pushRow(b, row, card);
      byTime.set(key, b);
    }
    spark = [...byTime.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-MAX_SPARK_POINTS)
      .map(([, b]) => bucketValue(b, card.aggregation));
  }

  // Variazione: ultimo punto contro la media dei precedenti — più stabile del
  // confronto con il singolo punto prima, che su dati giornalieri è rumore.
  let trendPct: number | null = null;
  if (spark.length >= 3) {
    const last = spark[spark.length - 1];
    const previous = spark.slice(0, -1);
    const mean = previous.reduce((a, b) => a + b, 0) / previous.length;
    if (Math.abs(mean) > 1e-9) trendPct = ((last - mean) / Math.abs(mean)) * 100;
  }

  return {
    value,
    display: formatValue(value, card.decimals),
    spark,
    trendPct,
    severity: severityFor(value, card.thresholds),
    empty: false,
    sampleCount: rows.length,
  };
}
