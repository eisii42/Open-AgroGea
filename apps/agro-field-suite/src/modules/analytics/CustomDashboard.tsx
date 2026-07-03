import { cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartData,
  type ChartType,
  type DashboardData,
  type TemporalRange,
  PALETTE,
  PRESETS,
  campaignYearRange,
  filterByRange,
  presetById,
} from "./dashboard-datasets";
import {
  type Aggregation,
  AGGREGATIONS,
  type EntityDef,
  ENTITIES,
  buildQuery,
  entityById,
} from "./dashboard-analytics";
import {
  type CustomChart,
  loadCharts,
  persistCharts,
} from "./dashboard-config";

/**
 * Dashboard aziendale EDITABILE del Command Center: griglia di grafici
 * riordinabili via drag-and-drop nativo, eliminabili e creabili come PRESET
 * multi-serie (es. bilancio idrico) o come ANALISI libera (entità → dimensione →
 * funzione(misura) → tipo). Config persistita per azienda.
 */

function typeLabel(t: TFunction, type: ChartType): string {
  const TYPE_LABEL: Record<ChartType, string> = {
    line: t("customDashboard.chartType.line"),
    area: t("customDashboard.chartType.area"),
    bar: t("customDashboard.chartType.bar"),
    pie: t("customDashboard.chartType.pie"),
  };
  return TYPE_LABEL[type];
}

const ALL_TYPES: ChartType[] = ["bar", "line", "area", "pie"];

/** Calcola i dati di un grafico (preset o query). */
function chartDataFor(chart: CustomChart, data: DashboardData): ChartData {
  if (chart.kind === "preset") {
    const p = presetById(chart.presetId);
    return p ? p.build(data) : { rows: [], categoryKey: "x", series: [], empty: true };
  }
  return buildQuery(
    {
      entity: chart.entity,
      dimension: chart.dimension,
      measure: chart.measure,
      measure2: chart.measure2,
      aggregation: chart.aggregation,
    },
    data,
  );
}

function ChartRenderer({ type, data }: { type: ChartType; data: ChartData }) {
  const { t } = useTranslation();
  if (data.empty) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--ink-4)]">
        {t("customDashboard.noDataForSelection")}
      </div>
    );
  }
  const tooltip = (
    <Tooltip
      contentStyle={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        fontSize: 12,
      }}
    />
  );

  if (type === "pie") {
    const s = data.series[0];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data.rows}
            dataKey={s.key}
            nameKey={data.categoryKey}
            outerRadius="78%"
            isAnimationActive={false}
          >
            {data.rows.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
      <XAxis
        dataKey={data.categoryKey}
        tick={{ fontSize: 9, fill: "var(--ink-3)" }}
        interval="preserveStartEnd"
        minTickGap={20}
      />
      <YAxis tick={{ fontSize: 10, fill: "var(--ink-3)" }} width={32} />
      {tooltip}
      <Legend wrapperStyle={{ fontSize: 10 }} />
    </>
  );

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          {axes}
          {data.series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.18}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          {axes}
          {data.series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data.rows} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        {axes}
        {data.series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartCard({
  chart,
  data,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  dragging,
}: {
  chart: CustomChart;
  data: ChartData;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex flex-col rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)]",
        dragging && "opacity-50",
      )}
    >
      <div className="mb-2 flex items-center gap-1">
        <span
          draggable
          onDragStart={onDragStart}
          title={t("customDashboard.dragToReorder")}
          className="cursor-grab text-[var(--ink-4)] hover:text-[var(--ink-2)] active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </span>
        <span className="flex-1 truncate text-sm font-semibold">{chart.title}</span>
        <button
          type="button"
          onClick={onEdit}
          title={t("customDashboard.editChart")}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)] hover:text-[var(--ink-2)]"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title={t("customDashboard.deleteChart")}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--danger-l)] hover:text-[var(--danger)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="h-56 w-full">
        <ChartRenderer type={chart.type} data={data} />
      </div>
    </div>
  );
}

function selectClass(): string {
  return "rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm";
}

function ChartEditModal({
  initial,
  onSave,
  onClose,
}: {
  initial: CustomChart | null;
  onSave: (chart: CustomChart) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<"preset" | "query">(initial?.kind ?? "query");

  // -- preset --
  const [presetId, setPresetId] = useState(
    initial?.kind === "preset" ? initial.presetId : PRESETS[0].id,
  );

  // -- query --
  const initQ = initial?.kind === "query" ? initial : null;
  const firstEntity = ENTITIES[0];
  const dimsOf = (e: EntityDef) => e.fields.filter((f) => f.kind === "dimension");
  const measOf = (e: EntityDef) => e.fields.filter((f) => f.kind === "measure");
  const [entity, setEntity] = useState(initQ?.entity ?? firstEntity.id);
  const [dimension, setDimension] = useState(
    initQ?.dimension ?? dimsOf(firstEntity)[0]?.key ?? "",
  );
  const [measure, setMeasure] = useState(
    initQ?.measure ?? measOf(firstEntity)[0]?.key ?? "",
  );
  const [measure2, setMeasure2] = useState(
    initQ?.measure2 ?? measOf(firstEntity)[1]?.key ?? measOf(firstEntity)[0]?.key ?? "",
  );
  const [aggregation, setAggregation] = useState<Aggregation>(
    initQ?.aggregation ?? "count",
  );

  const [type, setType] = useState<ChartType>(initial?.type ?? "bar");

  const entityDef = entityById(entity) ?? firstEntity;
  const dimensions = dimsOf(entityDef);
  const measures = measOf(entityDef);

  const changeEntity = (id: string) => {
    setEntity(id);
    const e = entityById(id);
    if (e) {
      setDimension(dimsOf(e)[0]?.key ?? "");
      setMeasure(measOf(e)[0]?.key ?? "");
      setMeasure2(measOf(e)[1]?.key ?? measOf(e)[0]?.key ?? "");
    }
  };

  const changeKind = (k: "preset" | "query") => {
    setKind(k);
    if (k === "preset") {
      const p = presetById(presetId) ?? PRESETS[0];
      if (!p.types.includes(type)) setType(p.types[0]);
    }
  };

  const changePreset = (id: string) => {
    setPresetId(id);
    const p = presetById(id);
    if (p && !p.types.includes(type)) setType(p.types[0]);
  };

  const typeOptions =
    kind === "preset" ? presetById(presetId)?.types ?? ALL_TYPES : ALL_TYPES;

  const save = () => {
    if (kind === "preset") {
      const p = presetById(presetId) ?? PRESETS[0];
      onSave({
        kind: "preset",
        id: initial?.id ?? uuidv4(),
        title: title.trim() || p.label,
        presetId,
        type,
      });
    } else {
      onSave({
        kind: "query",
        id: initial?.id ?? uuidv4(),
        title:
          title.trim() ||
          `${entityDef.label} · ${dimensions.find((d) => d.key === dimension)?.label ?? ""}`,
        entity,
        dimension,
        measure,
        ...(aggregation === "ratio" ? { measure2 } : {}),
        aggregation,
        type,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {initial ? t("customDashboard.editChart") : t("customDashboard.newChart")}
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
            {t("customDashboard.chartTitle")}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("customDashboard.chartTitlePlaceholder")}
              className={selectClass()}
            />
          </label>

          {/* Modalità: preset multi-serie o analisi libera. */}
          <div className="flex items-center gap-0.5 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
            {(["query", "preset"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(k)}
                className={cn(
                  "flex-1 rounded-[var(--r-1)] px-2 py-1 text-xs font-medium",
                  kind === k
                    ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
                    : "text-[var(--ink-3)]",
                )}
              >
                {k === "query" ? t("customDashboard.dataAnalysis") : t("customDashboard.preset")}
              </button>
            ))}
          </div>

          {kind === "preset" ? (
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
              {t("customDashboard.preset")}
              <select
                value={presetId}
                onChange={(e) => changePreset(e.target.value)}
                className={selectClass()}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customDashboard.dataEntity")}
                <select
                  value={entity}
                  onChange={(e) => changeEntity(e.target.value)}
                  className={selectClass()}
                >
                  {ENTITIES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customDashboard.groupByDimension")}
                <select
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                  className={selectClass()}
                >
                  {dimensions.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                {t("customDashboard.aggregationFunction")}
                <select
                  value={aggregation}
                  onChange={(e) => setAggregation(e.target.value as Aggregation)}
                  className={selectClass()}
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
                    {t("customDashboard.numeratorA")}
                    <select
                      value={measure}
                      onChange={(e) => setMeasure(e.target.value)}
                      className={selectClass()}
                    >
                      {measures.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
                    {t("customDashboard.denominatorB")}
                    <select
                      value={measure2}
                      onChange={(e) => setMeasure2(e.target.value)}
                      className={selectClass()}
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
                    {t("customDashboard.measure")}
                    <select
                      value={measure}
                      onChange={(e) => setMeasure(e.target.value)}
                      className={selectClass()}
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
            </>
          )}

          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink-3)]">
            {t("customDashboard.chartTypeLabel")}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ChartType)}
              className={selectClass()}
            >
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {typeLabel(t, opt)}
                </option>
              ))}
            </select>
          </label>
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
            {initial ? t("customDashboard.save") : t("customDashboard.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

type RangeMode = "campaign" | "all" | "custom";

export function CustomDashboard({
  data,
  companyId,
  campaignYear,
}: {
  data: DashboardData;
  companyId: string;
  campaignYear: number;
}) {
  const { t } = useTranslation();
  const [charts, setCharts] = useState<CustomChart[]>(() => loadCharts(companyId));
  const [editing, setEditing] = useState<CustomChart | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Filtro temporale dei dati della dashboard (default: annata di campagna).
  const [rangeMode, setRangeMode] = useState<RangeMode>("campaign");
  const [customFrom, setCustomFrom] = useState(`${campaignYear}-01-01`);
  const [customTo, setCustomTo] = useState(`${campaignYear}-12-31`);

  const apply = (next: CustomChart[]) => {
    setCharts(next);
    persistCharts(companyId, next);
  };

  const range = useMemo<TemporalRange>(() => {
    if (rangeMode === "all") return { from: null, to: null };
    if (rangeMode === "custom") return { from: customFrom || null, to: customTo || null };
    return campaignYearRange(campaignYear);
  }, [rangeMode, customFrom, customTo, campaignYear]);

  // Dati ristretti al periodo selezionato, condivisi da tutti i grafici.
  const scopedData = useMemo(() => filterByRange(data, range), [data, range]);

  const chartData = useMemo(() => {
    const map = new Map<string, ChartData>();
    for (const c of charts) map.set(c.id, chartDataFor(c, scopedData));
    return map;
  }, [charts, scopedData]);

  const onDrop = (target: number) => {
    if (dragIndex == null || dragIndex === target) {
      setDragIndex(null);
      return;
    }
    const next = [...charts];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    apply(next);
    setDragIndex(null);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("customDashboard.title")}</h2>
          <p className="text-[11px] text-[var(--ink-4)]">
            {t("customDashboard.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filtro temporale: annata di campagna (default), tutto o intervallo. */}
          <select
            value={rangeMode}
            onChange={(e) => setRangeMode(e.target.value as RangeMode)}
            title={t("customDashboard.dataPeriod")}
            className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
          >
            <option value="campaign">{t("customDashboard.campaignYear", { year: campaignYear })}</option>
            <option value="all">{t("customDashboard.wholeHistory")}</option>
            <option value="custom">{t("customDashboard.customPeriod")}</option>
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
          >
            <Plus size={15} /> {t("customDashboard.addChart")}
          </button>
        </div>
      </div>

      {rangeMode === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
            {t("customDashboard.from")}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
            {t("customDashboard.to")}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      {charts.length === 0 ? (
        <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">
          {t("customDashboard.noCharts")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {charts.map((c, i) => (
            <ChartCard
              key={c.id}
              chart={c}
              data={chartData.get(c.id) ?? { rows: [], categoryKey: "x", series: [], empty: true }}
              onEdit={() => setEditing(c)}
              onDelete={() => apply(charts.filter((x) => x.id !== c.id))}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              dragging={dragIndex === i}
            />
          ))}
        </div>
      )}

      {(editing || creating) && (
        <ChartEditModal
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={(chart) => {
            if (editing) {
              apply(charts.map((x) => (x.id === chart.id ? chart : x)));
            } else {
              apply([...charts, chart]);
            }
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}
