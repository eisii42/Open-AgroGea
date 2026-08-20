import { useAgroStore } from "@agrogea/core";
import { Button, Input, cn } from "@geolibre/ui";
import { Download } from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadArtifact } from "../../services/gis/geo-export";
import {
  parseProductCsv,
  productCsvTemplate,
  productKey,
} from "./product-import";

/**
 * Import CSV dell'anagrafica prodotti (§5.9, come i mezzi): lettura 100% locale
 * (nessuna rete), anteprima con validazione riga per riga e import PARZIALE
 * delle sole righe valide. Ogni riga valida genera un `saveProduct` e, se il
 * file porta un carico iniziale, un `receiveLot` che muove anche il CUMP —
 * esattamente ciò che fa il form di creazione singola.
 *
 * Analisi e giudizio delle righe stanno nel modulo puro `product-import.ts`.
 */
export function ProductImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const products = useAgroStore((s) => s.products);
  const saveProduct = useAgroStore((s) => s.saveProduct);
  const receiveLot = useAgroStore((s) => s.receiveLot);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    success: number;
    failed: number;
    total: number;
  } | null>(null);

  // Anagrafica già in magazzino: una riga che la ripete viene scartata invece
  // di creare un doppione (categoria + nome, senza distinzione di caso).
  const existingKeys = useMemo(
    () => new Set(products.map((p) => productKey(p.category, p.name))),
    [products],
  );

  const parsed = useMemo(
    () => (csvText != null ? parseProductCsv(csvText, existingKeys) : null),
    [csvText, existingKeys],
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
      setReadError(
        t("warehouse.import.parseError", { message: reader.error?.message ?? "" }),
      );
    reader.readAsText(file);
  }

  function handleTemplate() {
    downloadArtifact({
      filename: "agrogea-prodotti-modello.csv",
      blobPart: productCsvTemplate(),
      mime: "text/csv;charset=utf-8",
    });
  }

  async function handleImport() {
    if (importing || validRows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: validRows.length });
    let success = 0;
    let failed = 0;
    for (const row of validRows) {
      try {
        const record = await saveProduct(row.product);
        if (record) {
          success += 1;
          if (row.lot) {
            await receiveLot({ product_id: record.id, ...row.lot });
          }
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setResult({ success, failed, total: validRows.length });
    setImporting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--ink-3)]">
        {t("warehouse.import.instructions")}
      </p>
      <p className="text-xs text-[var(--ink-3)]">
        {t("warehouse.import.categoryRules")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-[var(--touch-min)] gap-1.5"
          onClick={handleTemplate}
        >
          <Download size={16} /> {t("warehouse.import.template")}
        </Button>
      </div>
      {fileName && <p className="text-xs text-[var(--ink-2)]">{fileName}</p>}

      {readError && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {readError}
        </p>
      )}

      {parsed && parsed.missingColumns.length > 0 && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {t("warehouse.import.missingHeader", {
            columns: parsed.missingColumns.join(", "),
          })}
        </p>
      )}

      {!result && parsed && parsed.missingColumns.length === 0 && parsed.rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-[var(--ink-2)]">
            {t("warehouse.import.previewTitle", {
              valid: validRows.length,
              total: parsed.rows.length,
            })}
          </p>
          <div className="overflow-x-auto rounded-[var(--r-2)] border border-[var(--line)]">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="bg-[var(--panel-2)] text-[var(--ink-3)]">
                <tr>
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">category</th>
                  <th className="px-2 py-1 text-left">name</th>
                  <th className="px-2 py-1 text-left">unit</th>
                  <th className="px-2 py-1 text-right">initial_quantity</th>
                  <th className="px-2 py-1 text-right">unit_cost</th>
                  <th className="px-2 py-1 text-left">expires_at</th>
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
                    <td className="agro-num px-2 py-1 text-[var(--ink-3)]">
                      {row.index}
                    </td>
                    <td className="px-2 py-1">
                      {t(
                        `warehouse.categoryLabel.${row.product.category}` as never,
                      )}
                    </td>
                    <td className="px-2 py-1">{row.product.name || "—"}</td>
                    <td className="px-2 py-1">{row.product.unit}</td>
                    <td className="agro-num px-2 py-1 text-right">
                      {row.lot?.initial_quantity ?? ""}
                    </td>
                    <td className="agro-num px-2 py-1 text-right">
                      {row.lot?.unit_cost ?? ""}
                    </td>
                    <td className="agro-num px-2 py-1">
                      {row.lot?.expires_at ?? ""}
                    </td>
                    <td className="px-2 py-1 text-[var(--danger)]">
                      {row.errorKey
                        ? t(row.errorKey as never, { value: row.errorValue ?? "" })
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--ink-3)]">
            {t("warehouse.import.lotNotice")}
          </p>
        </div>
      )}

      {result && (
        <p className="rounded-[var(--r-2)] bg-[var(--ok-l)] px-3 py-2 text-xs font-medium text-[var(--ok)]">
          {result.failed > 0
            ? t("warehouse.import.resultWithErrors", {
                success: result.success,
                failed: result.failed,
              })
            : t("warehouse.import.resultSummary", {
                success: result.success,
                total: result.total,
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
            {t("warehouse.import.close")}
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
                ? t("warehouse.import.importing", progress)
                : t("warehouse.import.submit", { count: validRows.length })}
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
