import type { DataTransferLog, FileFormat } from "@agrogea/core";
import { useAgroStore } from "@agrogea/core";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Tag di tracciabilità dei trasferimenti (FIX 2). Badge temporale generato al
 * successo di un import/export, es. `IMPORTATO · CSV`. Presentazionale e puro:
 * la sorgente è `dataTransferLogs` nello store.
 */

const ETICHETTA_FORMATO: Record<FileFormat, string> = {
  csv: "CSV",
  geojson: "GeoJSON",
  isoxml: "ISOXML",
  shapefile: "Shapefile",
  gpkg: "GeoPackage",
  kml: "KML",
  gpx: "GPX",
};

const COLORE: Record<DataTransferLog["operation_type"], string> = {
  import: "var(--accent)",
  export: "var(--crop-cereali, #2f8f6b)",
};

export function TransferTagBadge({ log }: { log: DataTransferLog }) {
  const isImport = log.operation_type === "import";
  const Icon = isImport ? ArrowDownToLine : ArrowUpFromLine;
  const colore = COLORE[log.operation_type];
  const quando = new Date(log.executed_at).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span
      title={`${log.file_name} · ${quando}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "var(--panel-2)", color: colore }}
    >
      <Icon size={12} className="shrink-0" />
      <span className="shrink-0 uppercase tracking-wide">
        {isImport ? "Importato" : "Esportato"} · {ETICHETTA_FORMATO[log.file_format]}
      </span>
      <span className="truncate text-[var(--ink-4)]">{log.file_name}</span>
    </span>
  );
}

/**
 * Feed dei tag di trasferimento. Usato sia nel popover Add Data (lista estesa)
 * sia come strip fluttuante sulla dashboard (ultimi pochi). Si nasconde quando
 * non c'è nulla da mostrare.
 */
export function TransferTagsFeed({
  limit = 6,
  className,
  empty = false,
  autoHideMs,
}: {
  limit?: number;
  className?: string;
  /** Mostra un placeholder quando il feed è vuoto (popover) invece di sparire. */
  empty?: boolean;
  /**
   * Se impostato, il feed si comporta come una NOTIFICA transitoria: compare
   * solo all'arrivo di un nuovo trasferimento e sparisce dopo `autoHideMs` ms.
   * I log preesistenti al mount non vengono mostrati (niente notifica "fissa").
   */
  autoHideMs?: number;
}) {
  const logs = useAgroStore((s) => s.dataTransferLogs);
  const visibili = logs.slice(0, limit);
  const latestKey = visibili[0]?.id ?? null;

  // Modalità notifica: visibile solo dopo un NUOVO log, per `autoHideMs`.
  const [visible, setVisible] = useState(false);
  const baselineSet = useRef(false);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!autoHideMs) return;
    // Al primo run registriamo il log più recente come baseline (preesistente):
    // non deve generare una notifica all'apertura dell'app.
    if (!baselineSet.current) {
      baselineSet.current = true;
      lastKey.current = latestKey;
      return;
    }
    if (latestKey && latestKey !== lastKey.current) {
      lastKey.current = latestKey;
      setVisible(true);
      const t = setTimeout(() => setVisible(false), autoHideMs);
      return () => clearTimeout(t);
    }
  }, [latestKey, autoHideMs]);

  if (autoHideMs && !visible) return null;

  if (visibili.length === 0) {
    if (!empty) return null;
    return (
      <p className="text-xs text-[var(--ink-4)]">
        Nessun trasferimento registrato per questa company.
      </p>
    );
  }

  return (
    <ul className={className ?? "flex flex-col gap-1.5"}>
      {visibili.map((log) => (
        <li key={log.id} className="flex">
          <TransferTagBadge log={log} />
        </li>
      ))}
    </ul>
  );
}
