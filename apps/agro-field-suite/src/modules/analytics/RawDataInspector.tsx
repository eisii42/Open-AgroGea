import {
  type OperationType,
  useAgroStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import { ArrowDown, ArrowUp, Crosshair, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Raw Data Inspector (Modulo 5): sostituisce la vecchia analisi da tabelle,
 * spostata qui dal Command Center. Tabella ad alte prestazioni con ricerca
 * globale, filtri per colonna e ordinamento; la modifica INLINE dei field
 * attributes alfanumerici save all'istante in PGlite (via store → outbox) e i
 * KPI collegati si ricalcolano alla riscrittura del dominio.
 */

type CellType = "text" | "number" | "readonly";

interface InspectorColumn {
  key: string;
  label: string;
  type: CellType;
}

type CellValue = string | number | null;

interface InspectorRow extends Record<string, CellValue> {
  __id: string;
  /** Plot di riferimento per il cross-filtering (null se assente). */
  __plotId: string | null;
}

interface InspectorDataset {
  id: string;
  label: string;
  columns: InspectorColumn[];
  rows: InspectorRow[];
  save: (rowId: string, key: string, value: string) => Promise<void>;
}

function opLabel(t: TFunction, type: OperationType): string {
  const OP_LABEL: Record<OperationType, string> = {
    phytosanitary: t("rawDataInspector.opType.phytosanitary"),
    fertilization: t("rawDataInspector.opType.fertilization"),
    irrigation: t("rawDataInspector.opType.irrigation"),
    tillage: t("rawDataInspector.opType.tillage"),
    sowing: t("rawDataInspector.opType.sowing"),
    harvest: t("rawDataInspector.opType.harvest"),
    sampling: t("rawDataInspector.opType.sampling"),
  };
  return OP_LABEL[type];
}

// PGlite restituisce le date come oggetti `Date` a runtime (i tipi dicono
// `string`): normalizziamo entrambe le forme.
function dateIt(value: CellValue | Date): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT");
}

export function RawDataInspector({
  plotIds,
  campaignYear,
  focusedPlotId = null,
  onFocusPlot,
}: {
  plotIds: Set<string> | null;
  campaignYear: number;
  /** Plot attualmente isolato dal cross-filtering (row evidenziata). */
  focusedPlotId?: string | null;
  /** Innesca il cross-filtering su un plot (clic sul focus di row). */
  onFocusPlot?: (plotId: string) => void;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const treatments = useAgroStore((s) => s.treatments);
  const harvests = useAgroStore((s) => s.harvests);
  const updatePlot = useAgroStore((s) => s.updatePlot);
  const updateTreatment = useAgroStore((s) => s.updateTreatment);
  const saveHarvest = useAgroStore((s) => s.saveHarvest);

  const inScope = (plotId: string | null): boolean =>
    plotIds == null || (plotId != null && plotIds.has(plotId));

  const datasets = useMemo<InspectorDataset[]>(() => {
    const scopedPlots = plots.filter((a) => inScope(a.id));
    const ops = treatments.filter(
      (t) =>
        t.deleted_at == null &&
        inScope(t.plot_id) &&
        new Date(t.executed_at).getUTCFullYear() === campaignYear,
    );
    const scopedHarvests = harvests.filter(
      (r) =>
        r.deleted_at == null &&
        inScope(r.plot_id) &&
        new Date(r.harvested_at).getUTCFullYear() === campaignYear,
    );

    return [
      {
        id: "plots",
        label: t("rawDataInspector.dataset.plots", { count: scopedPlots.length }),
        columns: [
          { key: "user_plot_name", label: t("rawDataInspector.column.name"), type: "text" },
          { key: "cadastral_sheet", label: t("rawDataInspector.column.sheet"), type: "text" },
          { key: "cadastral_parcel", label: t("rawDataInspector.column.parcel"), type: "text" },
          { key: "area_ha", label: t("rawDataInspector.column.areaHa"), type: "readonly" },
          { key: "last_ndvi_mean", label: t("rawDataInspector.column.ndvi"), type: "readonly" },
          { key: "historical_notes", label: t("rawDataInspector.column.notes"), type: "text" },
        ],
        rows: scopedPlots.map((p) => ({
          __id: p.id,
          __plotId: p.id,
          user_plot_name: p.user_plot_name,
          cadastral_sheet: p.cadastral_sheet,
          cadastral_parcel: p.cadastral_parcel,
          area_ha: p.area_ha,
          last_ndvi_mean: p.last_ndvi_mean,
          historical_notes: p.historical_notes ?? null,
        })),
        save: async (id, key, value) => {
          const patch: Record<string, CellValue> = { [key]: value.trim() || null };
          await updatePlot(
            id,
            patch as unknown as Parameters<typeof updatePlot>[1],
          );
        },
      },
      {
        id: "ops",
        label: t("rawDataInspector.dataset.ops", { count: ops.length }),
        columns: [
          { key: "executed_at", label: t("rawDataInspector.column.date"), type: "readonly" },
          { key: "operation_type", label: t("rawDataInspector.column.type"), type: "readonly" },
          { key: "product_name", label: t("rawDataInspector.column.product"), type: "text" },
          { key: "active_substance", label: t("rawDataInspector.column.activeSubstance"), type: "text" },
          { key: "dose_value", label: t("rawDataInspector.column.dose"), type: "number" },
          { key: "target_disease", label: t("rawDataInspector.column.targetDisease"), type: "text" },
          { key: "note", label: t("rawDataInspector.column.notes"), type: "text" },
        ],
        rows: ops.map((op) => ({
          __id: op.id,
          __plotId: op.plot_id,
          executed_at: dateIt(op.executed_at),
          operation_type: opLabel(t, op.operation_type),
          product_name: op.product_name,
          active_substance: op.active_substance,
          dose_value: op.dose_value,
          target_disease: op.target_disease,
          note: op.note,
        })),
        save: async (id, key, value) => {
          const patch: Record<string, CellValue> =
            key === "dose_value"
              ? { dose_value: value.trim() === "" ? null : Number(value) }
              : { [key]: value.trim() || null };
          await updateTreatment(
            id,
            patch as unknown as Parameters<typeof updateTreatment>[1],
          );
        },
      },
      {
        id: "harvests",
        label: t("rawDataInspector.dataset.harvests", { count: scopedHarvests.length }),
        columns: [
          { key: "harvested_at", label: t("rawDataInspector.column.date"), type: "readonly" },
          { key: "cultivar", label: t("rawDataInspector.column.cultivar"), type: "text" },
          { key: "quantity_kg", label: t("rawDataInspector.column.quantityKg"), type: "number" },
          { key: "destination_logistics", label: t("rawDataInspector.column.destination"), type: "text" },
          { key: "notes", label: t("rawDataInspector.column.notes"), type: "text" },
        ],
        rows: scopedHarvests.map((r) => ({
          __id: r.id,
          __plotId: r.plot_id,
          harvested_at: dateIt(r.harvested_at),
          cultivar: r.cultivar,
          quantity_kg: r.quantity_kg,
          destination_logistics: r.destination_logistics,
          notes: r.notes,
        })),
        save: async (id, key, value) => {
          const existing = scopedHarvests.find((r) => r.id === id);
          if (!existing) return;
          const patch: Record<string, CellValue> =
            key === "quantity_kg"
              ? { quantity_kg: value.trim() === "" ? null : Number(value) }
              : { [key]: value.trim() || null };
          await saveHarvest(
            { ...existing, ...patch } as unknown as Parameters<
              typeof saveHarvest
            >[0],
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plots, treatments, harvests, plotIds, campaignYear, t]);

  const [activeId, setActiveId] = useState(datasets[0]?.id ?? "plots");
  const dataset =
    datasets.find((d) => d.id === activeId) ?? datasets[0];

  return (
    <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-semibold">{t("rawDataInspector.title")}</h3>
        <div className="flex items-center gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
          {datasets.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              className={cn(
                "rounded-[var(--r-1)] px-2.5 py-1 text-xs font-medium",
                d.id === activeId
                  ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
                  : "text-[var(--ink-3)]",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {dataset && (
        <InspectorTable
          dataset={dataset}
          focusedPlotId={focusedPlotId}
          onFocusPlot={onFocusPlot}
        />
      )}
    </div>
  );
}

function InspectorTable({
  dataset,
  focusedPlotId,
  onFocusPlot,
}: {
  dataset: InspectorDataset;
  focusedPlotId: string | null;
  onFocusPlot?: (plotId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");

  const toText = (v: CellValue): string => (v == null ? "" : String(v));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dataset.rows.filter((r) => {
      if (q) {
        const hay = dataset.columns
          .map((c) => toText(r[c.key]).toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      for (const [key, val] of Object.entries(colFilters)) {
        if (val && !toText(r[key]).toLowerCase().includes(val.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [dataset, query, colFilters]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const commit = async () => {
    if (!editing) return;
    const { id, key } = editing;
    setEditing(null);
    await dataset.save(id, key, draft);
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2">
          <Search size={14} className="text-[var(--ink-4)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rawDataInspector.searchPlaceholder")}
            className="w-full bg-transparent py-1.5 text-sm outline-none"
          />
        </div>
        <span className="text-xs text-[var(--ink-4)]">
          {t("rawDataInspector.rowsCount", { shown: sorted.length, total: dataset.rows.length })}
        </span>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-[var(--r-2)] border border-[var(--line)]">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-[var(--panel-2)]">
            <tr>
              {onFocusPlot && (
                <th className="border-b border-[var(--line)] px-1 py-1.5" />
              )}
              {dataset.columns.map((c) => (
                <th
                  key={c.key}
                  className="border-b border-[var(--line)] px-2 py-1.5 text-left font-medium text-[var(--ink-2)]"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="flex items-center gap-1 hover:text-[var(--accent)]"
                  >
                    {c.label}
                    {sortKey === c.key &&
                      (sortDir === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {onFocusPlot && <th className="bg-[var(--panel-2)] px-1 pb-1.5" />}
              {dataset.columns.map((c) => (
                <th key={c.key} className="bg-[var(--panel-2)] px-1.5 pb-1.5">
                  <input
                    value={colFilters[c.key] ?? ""}
                    onChange={(e) =>
                      setColFilters((f) => ({ ...f, [c.key]: e.target.value }))
                    }
                    placeholder={t("rawDataInspector.filterPlaceholder")}
                    className="w-full rounded-[var(--r-1)] border border-[var(--line)] bg-[var(--panel)] px-1.5 py-1 text-[11px] font-normal outline-none"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const focused =
                focusedPlotId != null && r.__plotId === focusedPlotId;
              return (
              <tr
                key={r.__id}
                className={cn(
                  "hover:bg-[var(--panel-2)]",
                  focused && "bg-[var(--accent-l)]",
                )}
              >
                {onFocusPlot && (
                  <td className="border-b border-[var(--line)] px-1 py-1 align-top">
                    <button
                      type="button"
                      disabled={r.__plotId == null}
                      onClick={() => r.__plotId && onFocusPlot(r.__plotId)}
                      title={
                        focused
                          ? t("rawDataInspector.removeFocus")
                          : t("rawDataInspector.focusPlot")
                      }
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-[var(--r-1)]",
                        focused
                          ? "bg-[var(--accent)] text-white"
                          : "text-[var(--ink-4)] hover:bg-[var(--panel-3)] hover:text-[var(--accent)]",
                        r.__plotId == null && "cursor-not-allowed opacity-30",
                      )}
                    >
                      <Crosshair size={13} />
                    </button>
                  </td>
                )}
                {dataset.columns.map((c) => {
                  const isEditing =
                    editing?.id === r.__id && editing?.key === c.key;
                  const editable = c.type !== "readonly";
                  return (
                    <td
                      key={c.key}
                      onClick={() => {
                        if (!editable || isEditing) return;
                        setEditing({ id: r.__id, key: c.key });
                        setDraft(toText(r[c.key]));
                      }}
                      className={cn(
                        "border-b border-[var(--line)] px-2 py-1 align-top",
                        editable && !isEditing && "cursor-text",
                        c.type === "readonly" && "text-[var(--ink-3)]",
                      )}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          type={c.type === "number" ? "number" : "text"}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => void commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-full rounded-[var(--r-1)] border border-[var(--accent)] bg-[var(--panel)] px-1 py-0.5 text-[13px] outline-none"
                        />
                      ) : (
                        <span className="block truncate">
                          {toText(r[c.key]) || (
                            <span className="text-[var(--ink-4)]">—</span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={dataset.columns.length + (onFocusPlot ? 1 : 0)}
                  className="px-2 py-6 text-center text-sm text-[var(--ink-4)]"
                >
                  {t("rawDataInspector.noRowsMatch")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
