import {
  type DssResult,
  type Harvest,
  type TreatmentLog,
  type OperationType,
  useAgroStore,
} from "@agrogea/core";
import { cn } from "@geolibre/ui";
import type { TFunction } from "i18next";
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Calendario operativo integrato (Modulo 4). Popola automaticamente gli eventi
 * da `treatment_logs` (operazioni eseguite e pianificate), `harvest_logs` (date
 * di raccolta) e dagli alert DSS (giorni a rischio malattia elevato). Al clic su
 * un giorno apre il dettaglio degli eventi con modifica rapida del record in
 * PGlite (note/data per i trattamenti, quantità/data per le raccolte).
 */

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

const OP_COLOR: Record<OperationType, string> = {
  phytosanitary: "var(--accent)",
  fertilization: "var(--ok)",
  irrigation: "#0ea5e9",
  tillage: "var(--ink-3)",
  sowing: "#a855f7",
  harvest: "var(--warn)",
  sampling: "var(--ink-3)",
};

const HARVEST_COLOR = "#d97706";
const DSS_COLOR = "var(--danger)";

type CalEventKind = "treatment" | "harvest" | "dss";

interface CalEvent {
  key: string;
  kind: CalEventKind;
  /** Riferimento al record sorgente (per l'editing). */
  refId: string;
  day: string; // YYYY-MM-DD
  label: string;
  color: string;
  future: boolean;
}

function weekdays(t: TFunction): string[] {
  return [
    t("operationsCalendar.weekday.mon"),
    t("operationsCalendar.weekday.tue"),
    t("operationsCalendar.weekday.wed"),
    t("operationsCalendar.weekday.thu"),
    t("operationsCalendar.weekday.fri"),
    t("operationsCalendar.weekday.sat"),
    t("operationsCalendar.weekday.sun"),
  ];
}

function months(t: TFunction): string[] {
  return [
    t("operationsCalendar.month.january"),
    t("operationsCalendar.month.february"),
    t("operationsCalendar.month.march"),
    t("operationsCalendar.month.april"),
    t("operationsCalendar.month.may"),
    t("operationsCalendar.month.june"),
    t("operationsCalendar.month.july"),
    t("operationsCalendar.month.august"),
    t("operationsCalendar.month.september"),
    t("operationsCalendar.month.october"),
    t("operationsCalendar.month.november"),
    t("operationsCalendar.month.december"),
  ];
}

/**
 * Chiave-giorno "YYYY-MM-DD" robusta: PGlite restituisce le colonne
 * timestamptz/date come oggetti `Date` a runtime (i tipi TS dicono `string`),
 * quindi normalizziamo entrambe le forme prima di affettare.
 */
function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OperationsCalendar({
  campaignYear,
  plotIds,
  trattamenti,
  raccolte,
  dssRisultati,
}: {
  campaignYear: number;
  /** Appezzamenti nello scope (null = tutta l'azienda). */
  plotIds: Set<string> | null;
  trattamenti: TreatmentLog[];
  raccolte: Harvest[];
  dssRisultati: DssResult[];
}) {
  const { t } = useTranslation();
  const initialMonth =
    new Date().getFullYear() === campaignYear ? new Date().getMonth() : 5;
  const [month, setMonth] = useState(initialMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const inScope = (plotId: string | null): boolean =>
    plotIds == null || (plotId != null && plotIds.has(plotId));

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    const today = todayKey();
    for (const op of trattamenti) {
      if (op.deleted_at != null || !inScope(op.plot_id)) continue;
      const day = dayKey(op.executed_at);
      out.push({
        key: `t-${op.id}`,
        kind: "treatment",
        refId: op.id,
        day,
        label: `${opLabel(t, op.operation_type)}${op.product_name ? ` · ${op.product_name}` : ""}`,
        color: OP_COLOR[op.operation_type],
        future: day > today,
      });
    }
    for (const r of raccolte) {
      if (r.deleted_at != null || !inScope(r.plot_id)) continue;
      const day = dayKey(r.harvested_at);
      out.push({
        key: `h-${r.id}`,
        kind: "harvest",
        refId: r.id,
        day,
        label: `${t("operationsCalendar.harvest")}${r.quantity_kg ? ` · ${r.quantity_kg} kg` : ""}`,
        color: HARVEST_COLOR,
        future: day > today,
      });
    }
    for (const d of dssRisultati) {
      if (d.risk_level !== "high" || !inScope(d.plot_id)) continue;
      const day = dayKey(d.calculated_at);
      out.push({
        key: `d-${d.id}`,
        kind: "dss",
        refId: d.id,
        day,
        label: t("operationsCalendar.highRisk", { model: d.model_name }),
        color: DSS_COLOR,
        future: false,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trattamenti, raccolte, dssRisultati, plotIds, t]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = map.get(e.day) ?? [];
      list.push(e);
      map.set(e.day, list);
    }
    return map;
  }, [events]);

  // Costruzione della griglia mensile (settimana lun→dom, 6 righe).
  const first = new Date(Date.UTC(campaignYear, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lun=0
  const daysInMonth = new Date(Date.UTC(campaignYear, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${campaignYear}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-1)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("operationsCalendar.title")}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth((m) => (m + 11) % 12)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[120px] text-center text-sm font-medium">
            {months(t)[month]} {campaignYear}
          </span>
          <button
            type="button"
            onClick={() => setMonth((m) => (m + 1) % 12)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdays(t).map((w) => (
          <div
            key={w}
            className="pb-1 text-center text-[11px] font-medium text-[var(--ink-4)]"
          >
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;
          const dayEvents = eventsByDay.get(day) ?? [];
          const isToday = day === todayKey();
          const dayNum = Number(day.slice(8, 10));
          return (
            <button
              type="button"
              key={day}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "flex min-h-[64px] flex-col gap-0.5 rounded-[var(--r-1)] border p-1 text-left transition-colors",
                isToday
                  ? "border-[var(--accent)] bg-[var(--accent-l)]"
                  : "border-[var(--line)] hover:bg-[var(--panel-2)]",
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isToday ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
                )}
              >
                {dayNum}
              </span>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <span
                    key={e.key}
                    className={cn(
                      "truncate rounded-sm px-1 text-[9px] leading-tight text-white",
                      e.future && "opacity-60 ring-1 ring-inset",
                    )}
                    style={{ background: e.color }}
                    title={e.label}
                  >
                    {e.label}
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1 text-[9px] text-[var(--ink-4)]">
                    +{dayEvents.length - 3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <DayDetail
          day={selectedDay}
          events={eventsByDay.get(selectedDay) ?? []}
          trattamenti={trattamenti}
          raccolte={raccolte}
          dssRisultati={dssRisultati}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer dettaglio giorno + editing rapido
// ---------------------------------------------------------------------------

function DayDetail({
  day,
  events,
  trattamenti,
  raccolte,
  dssRisultati,
  onClose,
}: {
  day: string;
  events: CalEvent[];
  trattamenti: TreatmentLog[];
  raccolte: Harvest[];
  dssRisultati: DssResult[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const dataLeggibile = new Date(`${day}T00:00:00Z`).toLocaleDateString(i18n.language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-sm font-semibold capitalize">{dataLeggibile}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-1)] text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {events.length === 0 && (
            <p className="p-4 text-center text-sm text-[var(--ink-4)]">
              {t("operationsCalendar.noEventsForDay")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {events.map((e) => {
              const open = openKey === e.key;
              return (
                <div
                  key={e.key}
                  className="rounded-[var(--r-2)] border border-[var(--line)]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenKey(open || e.kind === "dss" ? null : e.key)
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: e.color }}
                    />
                    <span className="flex-1 truncate text-[13px]">{e.label}</span>
                    {e.future && (
                      <span className="rounded-full bg-[var(--panel-3)] px-1.5 text-[10px] text-[var(--ink-4)]">
                        {t("operationsCalendar.planned")}
                      </span>
                    )}
                  </button>
                  {open && e.kind === "treatment" && (
                    <TreatmentEditor
                      record={trattamenti.find((t) => t.id === e.refId)}
                      onDone={() => setOpenKey(null)}
                    />
                  )}
                  {open && e.kind === "harvest" && (
                    <HarvestEditor
                      record={raccolte.find((r) => r.id === e.refId)}
                      onDone={() => setOpenKey(null)}
                    />
                  )}
                  {e.kind === "dss" && (
                    <DssDetail
                      record={dssRisultati.find((d) => d.id === e.refId)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function fieldClass(): string {
  return "w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-sm";
}

function TreatmentEditor({
  record,
  onDone,
}: {
  record: TreatmentLog | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const aggiorna = useAgroStore((s) => s.aggiornaTrattamento);
  const elimina = useAgroStore((s) => s.eliminaTrattamento);
  const [product, setProduct] = useState(record?.product_name ?? "");
  const [date, setDate] = useState(
    record ? dayKey(record.executed_at) : "",
  );
  const [note, setNote] = useState(record?.note ?? "");
  const [saving, setSaving] = useState(false);
  if (!record) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--line)] p-3">
      <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
        {t("operationsCalendar.product")}
        <input
          className={fieldClass()}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
        {t("operationsCalendar.executionDate")}
        <input
          type="date"
          className={fieldClass()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
        {t("rawDataInspector.column.notes")}
        <textarea
          rows={2}
          className={fieldClass()}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={async () => {
            await elimina(record.id);
            onDone();
          }}
          className="flex items-center gap-1 rounded-[var(--r-2)] px-2 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-l)]"
        >
          <Trash2 size={13} /> {t("operationsCalendar.delete")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await aggiorna(record.id, {
              product_name: product.trim() || null,
              executed_at: new Date(`${date}T12:00:00`).toISOString(),
              note: note.trim() || null,
            });
            setSaving(false);
            onDone();
          }}
          className="rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("operationsCalendar.save")}
        </button>
      </div>
    </div>
  );
}

function HarvestEditor({
  record,
  onDone,
}: {
  record: Harvest | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const salva = useAgroStore((s) => s.salvaRaccolta);
  const elimina = useAgroStore((s) => s.eliminaRaccolta);
  const [qty, setQty] = useState(record?.quantity_kg?.toString() ?? "");
  const [date, setDate] = useState(
    record ? dayKey(record.harvested_at) : "",
  );
  const [saving, setSaving] = useState(false);
  if (!record) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--line)] p-3">
      <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
        {t("rawDataInspector.column.quantityKg")}
        <input
          type="number"
          className={fieldClass()}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
        {t("operationsCalendar.harvestDate")}
        <input
          type="date"
          className={fieldClass()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={async () => {
            await elimina(record.id);
            onDone();
          }}
          className="flex items-center gap-1 rounded-[var(--r-2)] px-2 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-l)]"
        >
          <Trash2 size={13} /> {t("operationsCalendar.delete")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await salva({
              ...record,
              quantity_kg: qty.trim() === "" ? null : Number(qty),
              harvested_at: new Date(`${date}T12:00:00`).toISOString(),
            });
            setSaving(false);
            onDone();
          }}
          className="rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("operationsCalendar.save")}
        </button>
      </div>
    </div>
  );
}

function DssDetail({ record }: { record: DssResult | undefined }) {
  const { t, i18n } = useTranslation();
  if (!record) return null;
  return (
    <div className="border-t border-[var(--line)] p-3 text-[12px] text-[var(--ink-2)]">
      {t("operationsCalendar.dssModel")} <b>{record.model_name}</b>: {t("operationsCalendar.dssRisk")}{" "}
      <span className="font-semibold text-[var(--danger)]">{t("operationsCalendar.dssHigh")}</span>{" "}
      ({t("operationsCalendar.dssIndex")}{" "}
      {record.output_value.toFixed(1)}). {t("operationsCalendar.dssCalculatedOn")}{" "}
      {new Date(record.calculated_at).toLocaleDateString(i18n.language)}.
    </div>
  );
}
