import { v4 as uuidv4 } from "uuid";
import { type ChartType, presetById } from "./dashboard-datasets";
import {
  type Aggregation,
  AGGREGATIONS,
  entityById,
} from "./dashboard-analytics";

/**
 * Configurazione della DASHBOARD AZIENDALE personalizzabile del Command Center.
 * Ogni grafico è o un PRESET multi-serie (es. bilancio idrico) o un'ANALISI
 * libera (entità + dimensione + funzione(misura)). Persistita per AZIENDA in
 * localStorage (per-device, offline-safe).
 */

interface ChartBase {
  id: string;
  title: string;
  type: ChartType;
}

export interface PresetChart extends ChartBase {
  kind: "preset";
  presetId: string;
}

export interface QueryChart extends ChartBase {
  kind: "query";
  entity: string;
  dimension: string;
  measure: string;
  /** Denominatore del rapporto (solo aggregation = "ratio"). */
  measure2?: string;
  aggregation: Aggregation;
}

export type CustomChart = PresetChart | QueryChart;

/** Grafici di default al primo accesso (nessuna config salvata). */
export function defaultCharts(): CustomChart[] {
  return [
    {
      kind: "preset",
      id: uuidv4(),
      title: "Bilancio idrico",
      presetId: "water_balance",
      type: "area",
    },
    {
      kind: "query",
      id: uuidv4(),
      title: "Operazioni per tipo",
      entity: "treatments",
      dimension: "tipo",
      measure: "dose",
      aggregation: "count",
      type: "bar",
    },
    {
      kind: "query",
      id: uuidv4(),
      title: "Raccolto per cultivar",
      entity: "harvests",
      dimension: "cultivar",
      measure: "kg",
      aggregation: "sum",
      type: "pie",
    },
  ];
}

function storageKey(companyId: string): string {
  return `agrogea.commandCenter.charts.${companyId}`;
}

const CHART_TYPES: ChartType[] = ["line", "area", "bar", "pie"];

function isChartType(v: unknown): v is ChartType {
  return typeof v === "string" && CHART_TYPES.includes(v as ChartType);
}

function isAggregation(v: unknown): v is Aggregation {
  return typeof v === "string" && AGGREGATIONS.some((a) => a.id === v);
}

/** Valida una voce salvata; scarta config non più coerenti col modello dati. */
function sanitizeChart(c: unknown): CustomChart | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (!isChartType(o.type)) return null;

  if (o.kind === "preset") {
    const preset = typeof o.presetId === "string" ? presetById(o.presetId) : undefined;
    if (!preset || !preset.types.includes(o.type)) return null;
    return { kind: "preset", id: o.id, title: o.title, presetId: o.presetId as string, type: o.type };
  }
  if (o.kind === "query") {
    const entity = typeof o.entity === "string" ? entityById(o.entity) : undefined;
    if (!entity) return null;
    const dim = entity.fields.find((f) => f.key === o.dimension && f.kind === "dimension");
    if (!dim) return null;
    if (!isAggregation(o.aggregation)) return null;
    // La misura serve solo se l'aggregazione non è "count"; se invalida, ripiega
    // sulla prima misura disponibile.
    const measures = entity.fields.filter((f) => f.kind === "measure");
    const measure =
      measures.find((m) => m.key === o.measure)?.key ?? measures[0]?.key ?? "";
    // Denominatore valido solo per i rapporti; ripiega su una misura disponibile.
    const measure2 =
      o.aggregation === "ratio"
        ? measures.find((m) => m.key === o.measure2)?.key ?? measures[0]?.key ?? ""
        : undefined;
    return {
      kind: "query",
      id: o.id,
      title: o.title,
      entity: o.entity as string,
      dimension: o.dimension as string,
      measure,
      ...(measure2 ? { measure2 } : {}),
      aggregation: o.aggregation,
      type: o.type,
    };
  }
  return null;
}

export function loadCharts(companyId: string): CustomChart[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(companyId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Una config salvata vuota è legittima (l'utente ha rimosso tutto).
        return parsed
          .map(sanitizeChart)
          .filter((c): c is CustomChart => c != null);
      }
    }
  } catch {
    /* localStorage non disponibile o JSON corrotto: si ricade sui default */
  }
  return defaultCharts();
}

export function persistCharts(companyId: string, charts: CustomChart[]): void {
  try {
    globalThis.localStorage?.setItem(storageKey(companyId), JSON.stringify(charts));
  } catch {
    /* no-op */
  }
}
