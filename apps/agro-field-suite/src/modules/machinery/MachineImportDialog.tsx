import { useAgroStore } from "@agrogea/core";
import { Button, Input, cn } from "@geolibre/ui";
import { type ChangeEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const todayIso = () => new Date().toISOString().slice(0, 10);
const EXPECTED_COLUMNS = [
  "name",
  "machine_type",
  "license_plate",
  "brand",
  "model",
  "year",
  "hour_counter",
] as const;

/**
 * Parser CSV minimale (RFC4180-ish), scritto ad-hoc per restare 100% offline
 * (nessuna dipendenza npm): gestisce campi tra virgolette (con virgole/a-capo
 * incorporati e `""` come escape della virgoletta) e CRLF/LF. Ritorna le righe
 * come array di celle grezze (stringhe), intestazione inclusa.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

interface ImportRow {
  index: number;
  name: string;
  machine_type: string | null;
  license_plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  hour_counter: number | null;
  valid: boolean;
  errorKey: string | null;
}

function parseAndValidate(text: string): { rows: ImportRow[]; headerError: boolean } {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], headerError: false };
  const header = raw[0].map((h) => h.trim().toLowerCase());
  const nameCol = header.indexOf("name");
  if (nameCol === -1) return { rows: [], headerError: true };
  const colIndex: Record<(typeof EXPECTED_COLUMNS)[number], number> = {
    name: nameCol,
    machine_type: header.indexOf("machine_type"),
    license_plate: header.indexOf("license_plate"),
    brand: header.indexOf("brand"),
    model: header.indexOf("model"),
    year: header.indexOf("year"),
    hour_counter: header.indexOf("hour_counter"),
  };
  const get = (cells: string[], col: number) =>
    col >= 0 && col < cells.length ? cells[col].trim() : "";

  const rows: ImportRow[] = raw.slice(1).map((cells, i) => {
    const name = get(cells, colIndex.name);
    const yearRaw = get(cells, colIndex.year);
    const hourRaw = get(cells, colIndex.hour_counter);

    let errorKey: string | null = null;
    let year: number | null = null;
    let hourCounter: number | null = null;

    if (name === "") {
      errorKey = "machinery.import.errorNameRequired";
    } else if (yearRaw !== "" && !Number.isFinite(Number(yearRaw))) {
      errorKey = "machinery.import.errorYear";
    } else if (hourRaw !== "" && !Number.isFinite(Number(hourRaw))) {
      errorKey = "machinery.import.errorHourCounter";
    } else {
      if (yearRaw !== "") year = Math.round(Number(yearRaw));
      if (hourRaw !== "") hourCounter = Number(hourRaw);
    }

    return {
      index: i + 2, // riga file (1-based, intestazione = riga 1)
      name,
      machine_type: get(cells, colIndex.machine_type) || null,
      license_plate: get(cells, colIndex.license_plate) || null,
      brand: get(cells, colIndex.brand) || null,
      model: get(cells, colIndex.model) || null,
      year,
      hour_counter: hourCounter,
      valid: errorKey === null,
      errorKey,
    };
  });
  return { rows, headerError: false };
}

/**
 * Import CSV dei mezzi (§5.9): parsing 100% locale (nessuna rete), anteprima
 * con validazione per riga (nome obbligatorio, anno/contaore numerici se
 * presenti) e import PARZIALE delle sole righe valide. Ogni riga valida
 * genera un `saveMachine` e, se `hour_counter` > 0, una rettifica
 * `initial_reading` (stesso comportamento del form di creazione singola).
 */
export function MachineImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const saveMachine = useAgroStore((s) => s.saveMachine);
  const adjustCounter = useAgroStore((s) => s.adjustCounter);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  const parsed = useMemo(
    () => (csvText != null ? parseAndValidate(csvText) : null),
    [csvText],
  );
  const validRows = parsed?.rows.filter((r) => r.valid) ?? [];

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setReadError(null);
    if (!file) {
      setFileName(null);
      setCsvText(null);
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.onerror = () =>
      setReadError(t("machinery.import.parseError", { message: reader.error?.message ?? "" }));
    reader.readAsText(file);
  }

  async function handleImport() {
    if (importing || validRows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: validRows.length });
    let success = 0;
    let failed = 0;
    for (const row of validRows) {
      try {
        const record = await saveMachine({
          name: row.name,
          machine_type: row.machine_type,
          license_plate: row.license_plate,
          chassis_number: null,
          brand: row.brand,
          model: row.model,
          year: row.year,
          status: "operational",
          purchase_value: null,
          purchase_date: null,
          useful_life_hours: null,
          useful_life_years: null,
          residual_value: null,
          notes: null,
        });
        if (record) {
          success += 1;
          if (row.hour_counter != null && row.hour_counter > 0) {
            await adjustCounter({
              machine_id: record.id,
              type: "initial_reading",
              new_value: row.hour_counter,
              adjusted_at: todayIso(),
            });
          }
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setResult({ success, failed });
    setImporting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--ink-3)]">{t("machinery.import.instructions")}</p>

      <Input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
      {fileName && <p className="text-xs text-[var(--ink-2)]">{fileName}</p>}

      {readError && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {readError}
        </p>
      )}

      {parsed?.headerError && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {t("machinery.import.missingHeader")}
        </p>
      )}

      {parsed && !parsed.headerError && parsed.rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-[var(--ink-2)]">
            {t("machinery.import.previewTitle", {
              valid: validRows.length,
              total: parsed.rows.length,
            })}
          </p>
          <div className="overflow-x-auto rounded-[var(--r-2)] border border-[var(--line)]">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="bg-[var(--panel-2)] text-[var(--ink-3)]">
                <tr>
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">name</th>
                  <th className="px-2 py-1 text-left">machine_type</th>
                  <th className="px-2 py-1 text-left">brand / model</th>
                  <th className="px-2 py-1 text-right">year</th>
                  <th className="px-2 py-1 text-right">hour_counter</th>
                  <th className="px-2 py-1 text-left" />
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((row) => (
                  <tr
                    key={row.index}
                    className={cn(
                      "border-t border-[var(--line)]",
                      !row.valid && "bg-[var(--danger-l)]",
                    )}
                  >
                    <td className="agro-num px-2 py-1 text-[var(--ink-3)]">{row.index}</td>
                    <td className="px-2 py-1">{row.name || "—"}</td>
                    <td className="px-2 py-1">{row.machine_type ?? ""}</td>
                    <td className="px-2 py-1">
                      {[row.brand, row.model].filter(Boolean).join(" ")}
                    </td>
                    <td className="agro-num px-2 py-1 text-right">{row.year ?? ""}</td>
                    <td className="agro-num px-2 py-1 text-right">{row.hour_counter ?? ""}</td>
                    <td className="px-2 py-1 text-[var(--danger)]">
                      {row.errorKey ? t(row.errorKey as never) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <p className="rounded-[var(--r-2)] bg-[var(--ok-l)] px-3 py-2 text-xs font-medium text-[var(--ok)]">
          {result.failed > 0
            ? t("machinery.import.resultWithErrors", {
                success: result.success,
                failed: result.failed,
              })
            : t("machinery.import.resultSummary", {
                success: result.success,
                total: validRows.length,
              })}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        {result ? (
          <Button
            type="button"
            className="min-h-[var(--touch-min)] flex-1"
            onClick={onClose}
          >
            {t("machinery.import.close")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              disabled={importing || validRows.length === 0}
              className="min-h-[var(--touch-min)] flex-1"
              onClick={() => void handleImport()}
            >
              {importing
                ? t("machinery.import.importing", progress)
                : t("machinery.import.submit", { count: validRows.length })}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-[var(--touch-min)]"
            >
              {t("logbook.common.cancel")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
