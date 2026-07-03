import { cn } from "@geolibre/ui";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Lightbulb,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer } from "recharts";
import type { KpiResult, KpiSeverity } from "./CommandCenterEngine";
import {
  KPI_PARAM_META,
  type KpiParams,
} from "./kpi-config";

/**
 * Griglia configurabile dei KPI (Modulo 3). Card interattive: Metric Card con
 * indicatore di trend, Mini Chart (sparkline/barre) e Actionable Insight. Il
 * click sull'ingranaggio di una card con parametri editabili apre il modale di
 * modifica (soglie, periodo GDD, finestra ETc) che ricalcola i widget collegati.
 */

const SEVERITY_COLOR: Record<KpiSeverity, string> = {
  neutral: "var(--ink-3)",
  good: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

function TrendChip({ pct, label }: { pct: number; label?: string }) {
  const up = pct > 0;
  const flat = Math.abs(pct) < 3;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "var(--ink-4)" : up ? "var(--ok)" : "var(--danger)";
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium"
      style={{ color }}
      title={label}
    >
      <Icon size={13} />
      {up && !flat ? "+" : ""}
      {pct.toFixed(0)}%
      {label && <span className="ml-1 text-[var(--ink-4)]">{label}</span>}
    </span>
  );
}

function Sparkline({ kpi }: { kpi: KpiResult }) {
  if (kpi.spark.length === 0) return null;
  const color = SEVERITY_COLOR[kpi.severity];

  // GDD con proiezione fenologica: storico continuo + tratto previsionale
  // tratteggiato (Modulo 3.2). Il punto di confine appartiene a entrambe le
  // serie per saldare le due linee.
  if (kpi.projectionStart != null && kpi.projectionStart < kpi.spark.length) {
    const start = kpi.projectionStart;
    const data = kpi.spark.map((v, i) => ({
      i,
      h: i < start ? v : i === start - 1 ? v : null,
      p: i >= start || i === start - 1 ? v : null,
    }));
    return (
      <div className="h-10 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="h"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="p"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const data = kpi.spark.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kpi.id === "treatments_count" ? (
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

function MetricCard({
  kpi,
  onEdit,
}: {
  kpi: KpiResult;
  onEdit: (() => void) | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--ink-3)]">
          {kpi.title}
        </span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title={t("kpiGrid.editParams")}
            className="-mr-1 -mt-1 flex h-6 w-6 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)] hover:text-[var(--ink-2)]"
          >
            <SlidersHorizontal size={13} />
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-2xl font-semibold tabular-nums"
          style={{ color: SEVERITY_COLOR[kpi.severity] }}
        >
          {kpi.display}
        </span>
        {kpi.unit && (
          <span className="text-[11px] text-[var(--ink-4)]">{kpi.unit}</span>
        )}
      </div>
      <Sparkline kpi={kpi} />
      {kpi.trendPct != null ? (
        <TrendChip pct={kpi.trendPct} label={kpi.trendLabel} />
      ) : (
        kpi.trendLabel && (
          <span className="text-[11px] text-[var(--ink-4)]">{kpi.trendLabel}</span>
        )
      )}
    </div>
  );
}

function InsightCard({ kpi }: { kpi: KpiResult }) {
  const color = SEVERITY_COLOR[kpi.severity];
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)] sm:col-span-2"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <Lightbulb size={16} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold" style={{ color }}>
          {kpi.title}
        </span>
        <span className="text-[12px] leading-snug text-[var(--ink-2)]">
          {kpi.insight}
        </span>
      </div>
    </div>
  );
}

function KpiEditModal({
  kpi,
  params,
  onApply,
  onClose,
}: {
  kpi: KpiResult;
  params: KpiParams;
  onApply: (patch: Partial<KpiParams>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<KpiParams>(params);
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
          <h3 className="text-sm font-semibold">{t("kpiGrid.paramsTitle", { title: kpi.title })}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {kpi.editableParams.map((id) => {
            const meta = KPI_PARAM_META[id];
            return (
              <label key={id} className="flex flex-col gap-1">
                <span className="text-[12px] text-[var(--ink-3)]">
                  {meta.label}
                  {meta.unit && (
                    <span className="ml-1 text-[var(--ink-4)]">({meta.unit})</span>
                  )}
                </span>
                <input
                  type="number"
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  value={draft[id]}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [id]: Number(e.target.value),
                    }))
                  }
                  className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm tabular-nums"
                />
              </label>
            );
          })}
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
            onClick={() => {
              const patch: Partial<KpiParams> = {};
              for (const id of kpi.editableParams) patch[id] = draft[id];
              onApply(patch);
              onClose();
            }}
            className="rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {t("kpiGrid.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function KpiGrid({
  kpis,
  params,
  onChangeParams,
}: {
  kpis: KpiResult[];
  params: KpiParams;
  onChangeParams: (patch: Partial<KpiParams>) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<KpiResult | null>(null);

  if (kpis.length === 0) {
    return (
      <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-4)]">
        {t("kpiGrid.noKpis")}
      </p>
    );
  }

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          "md:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {kpis.map((kpi) =>
          kpi.kind === "insight" ? (
            <InsightCard key={kpi.id} kpi={kpi} />
          ) : (
            <MetricCard
              key={kpi.id}
              kpi={kpi}
              onEdit={
                kpi.editableParams.length > 0 ? () => setEditing(kpi) : null
              }
            />
          ),
        )}
      </div>
      {editing && (
        <KpiEditModal
          kpi={editing}
          params={params}
          onApply={onChangeParams}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
