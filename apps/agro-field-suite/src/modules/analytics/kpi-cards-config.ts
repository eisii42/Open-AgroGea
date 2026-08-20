import { v4 as uuidv4 } from "uuid";
import {
  AGGREGATIONS,
  type Aggregation,
  currentFieldKey,
  entityById,
} from "./dashboard-analytics";
import type {
  CustomKpiCard,
  KpiFilter,
  KpiPeriod,
  KpiThresholds,
} from "./kpi-cards";

/**
 * Persistenza delle schede KPI personalizzate del Command Center, per AZIENDA e
 * per-device (localStorage), come la config dei grafici in `dashboard-config`:
 * sono preferenze di visualizzazione, non dati di dominio, e non passano dal
 * DAL né dal sync.
 *
 * `defaultKpiCards()` propone tre indici generici — non gli ex indici fissi, che
 * sono stati rimossi: sono un punto di partenza modificabile o eliminabile.
 */

function storageKey(companyId: string): string {
  return `agrogea.commandCenter.kpiCards.${companyId}`;
}

export function defaultKpiCards(): CustomKpiCard[] {
  return [
    {
      id: uuidv4(),
      title: "Superficie in scope",
      entity: "plots",
      aggregation: "sum",
      measure: "areaHa",
      unit: "ha",
      decimals: 1,
      period: { kind: "all" },
      trend: false,
    },
    {
      id: uuidv4(),
      title: "Operazioni dell'annata",
      entity: "treatments",
      aggregation: "count",
      measure: "dose",
      decimals: 0,
      period: { kind: "campaign" },
      trend: true,
    },
    {
      id: uuidv4(),
      title: "Pioggia ultimi 30 giorni",
      entity: "weather",
      aggregation: "sum",
      measure: "rain",
      unit: "mm",
      decimals: 0,
      period: { kind: "lastDays", days: 30 },
      trend: true,
    },
  ];
}

function isAggregation(v: unknown): v is Aggregation {
  return typeof v === "string" && AGGREGATIONS.some((a) => a.id === v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sanitizePeriod(v: unknown): KpiPeriod {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.kind === "all") return { kind: "all" };
    if (o.kind === "lastDays") {
      const days = isFiniteNumber(o.days) ? Math.round(o.days) : 30;
      return { kind: "lastDays", days: Math.min(730, Math.max(1, days)) };
    }
  }
  return { kind: "campaign" };
}

function sanitizeThresholds(v: unknown): KpiThresholds | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const warn = isFiniteNumber(o.warn) ? o.warn : null;
  const danger = isFiniteNumber(o.danger) ? o.danger : null;
  if (warn == null && danger == null) return undefined;
  return {
    warn,
    danger,
    direction: o.direction === "below" ? "below" : "above",
  };
}

function sanitizeFilter(entityId: string, v: unknown): KpiFilter | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const dimension = currentFieldKey(entityId, o.dimension);
  const entity = entityById(entityId);
  const isDimension = entity?.fields.some(
    (f) => f.key === dimension && f.kind === "dimension",
  );
  if (!dimension || !isDimension || typeof o.value !== "string") return undefined;
  return { dimension, value: o.value };
}

/** Valida una scheda salvata; scarta quelle non più coerenti col catalogo dati. */
export function sanitizeKpiCard(c: unknown): CustomKpiCard | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  const entityId = typeof o.entity === "string" ? o.entity : "";
  const entity = entityById(entityId);
  if (!entity) return null;
  if (!isAggregation(o.aggregation)) return null;

  // La misura serve solo se l'aggregazione non è "count"; se invalida ripiega
  // sulla prima disponibile, come per i grafici.
  const measures = entity.fields.filter((f) => f.kind === "measure");
  const measureKey = currentFieldKey(entityId, o.measure);
  const measure =
    measures.find((m) => m.key === measureKey)?.key ?? measures[0]?.key ?? "";
  if (o.aggregation !== "count" && !measure) return null;
  const measure2Key = currentFieldKey(entityId, o.measure2);
  const measure2 =
    o.aggregation === "ratio"
      ? measures.find((m) => m.key === measure2Key)?.key ?? measures[0]?.key ?? ""
      : undefined;

  const decimals = isFiniteNumber(o.decimals)
    ? Math.min(3, Math.max(0, Math.round(o.decimals)))
    : 1;

  return {
    id: o.id,
    title: o.title,
    entity: entityId,
    aggregation: o.aggregation,
    measure,
    ...(measure2 ? { measure2 } : {}),
    ...(sanitizeFilter(entityId, o.filter)
      ? { filter: sanitizeFilter(entityId, o.filter) }
      : {}),
    ...(typeof o.unit === "string" && o.unit.trim() ? { unit: o.unit } : {}),
    decimals,
    period: sanitizePeriod(o.period),
    trend: o.trend !== false,
    ...(sanitizeThresholds(o.thresholds)
      ? { thresholds: sanitizeThresholds(o.thresholds) }
      : {}),
  };
}

export function loadKpiCards(companyId: string): CustomKpiCard[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(companyId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Una config salvata vuota è legittima (l'utente ha rimosso tutto).
        return parsed
          .map(sanitizeKpiCard)
          .filter((c): c is CustomKpiCard => c != null);
      }
    }
  } catch {
    /* localStorage non disponibile o JSON corrotto: si ricade sui default */
  }
  return defaultKpiCards();
}

export function persistKpiCards(
  companyId: string,
  cards: CustomKpiCard[],
): void {
  try {
    globalThis.localStorage?.setItem(
      storageKey(companyId),
      JSON.stringify(cards),
    );
  } catch {
    /* no-op */
  }
}
