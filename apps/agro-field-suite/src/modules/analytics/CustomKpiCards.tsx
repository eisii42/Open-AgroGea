import { cn } from "@geolibre/ui";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer } from "recharts";
import {
  type Aggregation,
  AGGREGATIONS,
  type EntityDef,
  ENTITIES,
  entityById,
} from "./dashboard-analytics";
import type { DashboardData } from "./dashboard-datasets";
import {
  type CustomKpiCard,
  type KpiCardValue,
  type KpiPeriod,
  type KpiSeverity,
  computeKpiCard,
  dimensionValues,
} from "./kpi-cards";
import { loadKpiCards, persistKpiCards } from "./kpi-cards-config";

/**
 * Griglia delle schede KPI PERSONALIZZATE del Command Center (Modulo 3), al
 * posto della vecchia griglia a indici fissi. Ogni scheda è un indice composto
 * dall'utente sul catalogo dati completo (`dashboard-analytics`): sorgente,
 * funzione, misura, periodo, con filtro e soglie di colore facoltativi.
 *
 * Riordinabile in drag-and-drop nativo, come i grafici della dashboard, e
 * persistita per azienda in localStorage.
 */

const SEVERITY_COLOR: Record<KpiSeverity, string> = {
  neutral: "var(--ink)",
  good: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

function dimensionsOf(entity: EntityDef) {
  return entity.fields.filter((f) => f.kind === "dimension");
}

function measuresOf(entity: EntityDef) {
  return entity.fields.filter((f) => f.kind === "measure");
}

function inputClass(): string {
  return "rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm";
}

function TrendChip({ pct, label }: { pct: number; label: string }) {
  const flat = Math.abs(pct) < 3;
  const up = pct > 0;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "var(--ink-4)" : up ? "var(--ok)" : "var(--danger)";
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium"
      style={{ color }}
    >
      <Icon size={13} />
      {up && !flat ? "+" : ""}
      {pct.toFixed(0)}%
      <span className="ml-1 text-[var(--ink-4)]">{label}</span>
    </span>
  );
}

function Sparkline({
  values,
  color,
  bars,
}: {
  values: number[];
  color: string;
  bars: boolean;
}) {
  if (values.length < 2) return <div className="h-10 w-full" />;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {bars ? (
          <BarChart data={data}>
            <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({
  card,
  value,
  campaignYear,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  dragging,
}: {
  card: CustomKpiCard;
  value: KpiCardValue;
  campaignYear: number;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  const { t } = useTranslation();
  const color = SEVERITY_COLOR[value.severity];
  const periodLabel =
    card.period.kind === "campaign"
      ? t("customKpiCards.periodCampaign", { year: campaignYear })
      : card.period.kind === "lastDays"
        ? t("customKpiCards.lastDaysBadge", { count: card.period.days })
        : t("customKpiCards.periodAll");

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)]",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-1">
        <span
          draggable
          onDragStart={onDragStart}
          title={t("customKpiCards.dragToReorder")}
          className="cursor-grab text-[var(--ink-4)] hover:text-[var(--ink-2)] active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink-3)]">
          {card.title}
        </span>
        <button
          type="button"
          onClick={onEdit}
          title={t("customKpiCards.editCard")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)] hover:text-[var(--ink-2)]"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title={t("customKpiCards.deleteCard")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--danger-l)] hover:text-[var(--danger)]"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums" style={{ color }}>
          {value.display}
        </span>
        {card.unit && !value.empty && (
          <span className="text-[11px] text-[var(--ink-4)]">{card.unit}</span>
        )}
      </div>

      {card.trend && <Sparkline
        values={value.spark}
        color={value.severity === "neutral" ? "var(--accent)" : color}
        bars={card.aggregation === "count"}
      />}

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-[var(--ink-4)]">
          {value.empty
            ? t("customKpiCards.noData")
            : t("customKpiCards.records", { count: value.sampleCount })}
          {" · "}
          {periodLabel}
        </span>
        {value.trendPct != null && (
          <TrendChip
            pct={value.trendPct}
            label={t("customKpiCards.trendVsPrevious")}
          />
        )}
      </div>
    </div>
  );
}

function KpiCardEditModal({
  initial,
  data,
  campaignYear,
  onSave,
  onClose,
}: {
  initial: CustomKpiCard | null;
  data: DashboardData;
  campaignYear: number;
  onSave: (card: CustomKpiCard) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const firstEntity = ENTITIES[0];

  const [title, setTitle] = useState(initial?.title ?? "");
  const [entity, setEntity] = useState(initial?.entity ?? firstEntity.id);
  const [aggregation, setAggregation] = useState<Aggregation>(
    initial?.aggregation ?? "count",
  );
  const [measure, setMeasure] = useState(
    initial?.measure ?? measuresOf(firstEntity)[0]?.key ?? "",
  );
  const [measure2, setMeasure2] = useState(
    initial?.measure2 ??
      measuresOf(firstEntity)[1]?.key ??
      measuresOf(firstEntity)[0]?.key ??
      "",
  );
  const [filterDimension, setFilterDimension] = useState(
    initial?.filter?.dimension ?? "",
  );
  const [filterValue, setFilterValue] = useState(initial?.filter?.value ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [decimals, setDecimals] = useState(initial?.decimals ?? 1);
  const [periodKind, setPeriodKind] = useState<KpiPeriod["kind"]>(
    initial?.period.kind ?? "campaign",
  );
  const [periodDays, setPeriodDays] = useState(
    initial?.period.kind === "lastDays" ? initial.period.days : 30,
  );
  const [trend, setTrend] = useState(initial?.trend ?? true);
  const [direction, setDirection] = useState<"above" | "below">(
    initial?.thresholds?.direction ?? "above",
  );
  const [warn, setWarn] = useState(
    initial?.thresholds?.warn != null ? String(initial.thresholds.warn) : "",
  );
  const [danger, setDanger] = useState(
    initial?.thresholds?.danger != null ? String(initial.thresholds.danger) : "",
  );

  const entityDef = entityById(entity) ?? firstEntity;
  const dimensions = dimensionsOf(entityDef);
  const measures = measuresOf(entityDef);

  // Valori del filtro: presi dai dati reali dell'entità, non da un elenco fisso.
  const filterOptions = useMemo(
    () => (filterDimension ? dimensionValues(entity, filterDimension, data) : []),
    [entity, filterDimension, data],
  );

  const changeEntity = (id: string) => {
    setEntity(id);
    const e = entityById(id);
    if (!e) return;
    setMeasure(measuresOf(e)[0]?.key ?? "");
    setMeasure2(measuresOf(e)[1]?.key ?? measuresOf(e)[0]?.key ?? "");
    setFilterDimension("");
    setFilterValue("");
  };

  const changeFilterDimension = (key: string) => {
    setFilterDimension(key);
    setFilterValue("");
  };

  const numberOrNull = (v: string): number | null => {
    const n = Number(v.replace(",", "."));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };

  const save = () => {
    const period: KpiPeriod =
      periodKind === "lastDays"
        ? { kind: "lastDays", days: Math.max(1, Math.round(periodDays)) }
        : { kind: periodKind === "all" ? "all" : "campaign" };
    const warnValue = numberOrNull(warn);
    const dangerValue = numberOrNull(danger);
    const fallbackTitle = `${entityDef.label} · ${
      AGGREGATIONS.find((a) => a.id === aggregation)?.label ?? ""
    }`;
    onSave({
      id: initial?.id ?? uuidv4(),
      title: title.trim() || fallbackTitle,
      entity,
      aggregation,
      measure,
      ...(aggregation === "ratio" ? { measure2 } : {}),
      ...(filterDimension && filterValue
        ? { filter: { dimension: filterDimension, value: filterValue } }
        : {}),
      ...(unit.trim() ? { unit: unit.trim() } : {}),
      decimals,
      period,
      trend,
      ...(warnValue != null || dangerValue != null
        ? { thresholds: { warn: warnValue, danger: dangerValue, direction } }
        : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {initial
              ? t("customKpiCards.editCard")
              : t("customKpiCards.newCard")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
            {t("customKpiCards.cardTitle")}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("customKpiCards.cardTitlePlaceholder")}
              className={inputClass()}
            />
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
            {t("customKpiCards.dataEntity")}
            <select
              value={entity}
              onChange={(e) => changeEntity(e.target.value)}
              className={inputClass()}
            >
              {ENTITIES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
            {t("customKpiCards.aggregationFunction")}
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value as Aggregation)}
              className={inputClass()}
            >
              {AGGREGATIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          {aggregation === "ratio" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.numeratorA")}
                <select
                  value={measure}
                  onChange={(e) => setMeasure(e.target.value)}
                  className={inputClass()}
                >
                  {measures.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.denominatorB")}
                <select
                  value={measure2}
                  onChange={(e) => setMeasure2(e.target.value)}
                  className={inputClass()}
                >
                  {measures.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            aggregation !== "count" && (
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.measure")}
                <select
                  value={measure}
                  onChange={(e) => setMeasure(e.target.value)}
                  className={inputClass()}
                >
                  {measures.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}

          {/* Filtro facoltativo su una dimensione: è ciò che rende l'indice
              "personalizzato" (es. solo le operazioni fitosanitarie). */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.filterLabel")}
              <select
                value={filterDimension}
                onChange={(e) => changeFilterDimension(e.target.value)}
                className={inputClass()}
              >
                <option value="">{t("customKpiCards.filterNone")}</option>
                {dimensions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.filterValue")}
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                disabled={!filterDimension}
                className={cn(inputClass(), !filterDimension && "opacity-50")}
              >
                <option value="">{t("customKpiCards.filterAnyValue")}</option>
                {filterOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.unit")}
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={t("customKpiCards.unitPlaceholder")}
                className={inputClass()}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.decimals")}
              <input
                type="number"
                min={0}
                max={3}
                step={1}
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                className={cn(inputClass(), "tabular-nums")}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.period")}
              <select
                value={periodKind}
                onChange={(e) =>
                  setPeriodKind(e.target.value as KpiPeriod["kind"])
                }
                className={inputClass()}
              >
                <option value="campaign">
                  {t("customKpiCards.periodCampaign", { year: campaignYear })}
                </option>
                <option value="lastDays">
                  {t("customKpiCards.periodLastDays")}
                </option>
                <option value="all">{t("customKpiCards.periodAll")}</option>
              </select>
            </label>
            {periodKind === "lastDays" && (
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.days")}
                <input
                  type="number"
                  min={1}
                  max={730}
                  step={1}
                  value={periodDays}
                  onChange={(e) => setPeriodDays(Number(e.target.value))}
                  className={cn(inputClass(), "tabular-nums")}
                />
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 text-[12px] text-[var(--ink-3)]">
            <input
              type="checkbox"
              checked={trend}
              onChange={(e) => setTrend(e.target.checked)}
              className="h-4 w-4"
            />
            {t("customKpiCards.trend")}
          </label>

          {/* Soglie: opzionali, colorano il valore quando l'indice esce dai
              limiti che l'utente considera accettabili. */}
          <fieldset className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] p-2">
            <legend className="px-1 text-[11px] text-[var(--ink-4)]">
              {t("customKpiCards.thresholds")}
            </legend>
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customKpiCards.thresholdDirection")}
              <select
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as "above" | "below")
                }
                className={inputClass()}
              >
                <option value="above">
                  {t("customKpiCards.directionAbove")}
                </option>
                <option value="below">
                  {t("customKpiCards.directionBelow")}
                </option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.warnThreshold")}
                <input
                  value={warn}
                  onChange={(e) => setWarn(e.target.value)}
                  inputMode="decimal"
                  className={cn(inputClass(), "tabular-nums")}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customKpiCards.dangerThreshold")}
                <input
                  value={danger}
                  onChange={(e) => setDanger(e.target.value)}
                  inputMode="decimal"
                  className={cn(inputClass(), "tabular-nums")}
                />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-2)] px-3 py-1.5 text-sm text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            {t("logbook.common.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {initial ? t("customKpiCards.save") : t("customKpiCards.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomKpiCards({
  data,
  companyId,
  campaignYear,
}: {
  data: DashboardData;
  companyId: string;
  campaignYear: number;
}) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CustomKpiCard[]>(() =>
    loadKpiCards(companyId),
  );
  const [editing, setEditing] = useState<CustomKpiCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const apply = (next: CustomKpiCard[]) => {
    setCards(next);
    persistKpiCards(companyId, next);
  };

  const values = useMemo(() => {
    const map = new Map<string, KpiCardValue>();
    for (const c of cards) map.set(c.id, computeKpiCard(c, data, campaignYear));
    return map;
  }, [cards, data, campaignYear]);

  const onDrop = (target: number) => {
    if (dragIndex == null || dragIndex === target) {
      setDragIndex(null);
      return;
    }
    const next = [...cards];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    apply(next);
    setDragIndex(null);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("customKpiCards.title")}</h2>
          <p className="text-[11px] text-[var(--ink-4)]">
            {t("customKpiCards.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
        >
          <Plus size={15} /> {t("customKpiCards.addCard")}
        </button>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">
          {t("customKpiCards.noCards")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {cards.map((c, i) => (
            <KpiCard
              key={c.id}
              card={c}
              value={
                values.get(c.id) ?? {
                  value: 0,
                  display: "—",
                  spark: [],
                  trendPct: null,
                  severity: "neutral",
                  empty: true,
                  sampleCount: 0,
                }
              }
              campaignYear={campaignYear}
              onEdit={() => setEditing(c)}
              onDelete={() => apply(cards.filter((x) => x.id !== c.id))}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              dragging={dragIndex === i}
            />
          ))}
        </div>
      )}

      {(editing || creating) && (
        <KpiCardEditModal
          initial={editing}
          data={data}
          campaignYear={campaignYear}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={(card) => {
            if (editing) {
              apply(cards.map((x) => (x.id === card.id ? card : x)));
            } else {
              apply([...cards, card]);
            }
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}
