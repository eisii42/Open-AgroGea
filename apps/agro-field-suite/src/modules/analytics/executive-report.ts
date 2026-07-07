import type { TreatmentLog, Harvest } from "@agrogea/core";
import { BOM_UTF8 } from "../../services/gis/geo-export";
import type { AnalyticsResult, KpiResult } from "./CommandCenterEngine";

/**
 * "Download Executive Report" del Command Center (Modulo 5). Genera un CSV
 * localizzato europeo (separatore `;`, codifica UTF-8-sig col BOM) con la sintesi
 * di TUTTI i KPI e dei log filtrati per la vista corrente. Serializzatore PURO
 * (solo stringhe): nessuna dipendenza pesante, coerente con la filiera di export
 * esistente (`geo-export`).
 */

const SEP = ";";

function cell(value: unknown): string {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const re = new RegExp(`["\r\n${SEP}]`);
  return re.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(cells: unknown[]): string {
  return cells.map(cell).join(SEP);
}

function kpiRows(kpis: KpiResult[]): string[] {
  const out = [row(["Titolo", "Valore", "Unità", "Trend %", "Note"])];
  for (const k of kpis) {
    if (k.kind === "insight") {
      out.push(row([k.title, "", "", "", k.insight ?? ""]));
    } else {
      out.push(
        row([
          k.title,
          k.display,
          k.unit ?? "",
          k.trendPct != null ? k.trendPct.toFixed(0) : "",
          k.trendLabel ?? "",
        ]),
      );
    }
  }
  return out;
}

function treatmentRows(treatments: TreatmentLog[]): string[] {
  const out = [
    row([
      "Data",
      "Operazione",
      "Product",
      "Sostanza attiva",
      "Dose",
      "Unità dose",
      "Quantità tot.",
      "Avversità",
      "Operatore",
      "Note",
    ]),
  ];
  for (const t of treatments) {
    out.push(
      row([
        new Date(t.executed_at).toLocaleDateString("it-IT"),
        t.operation_type,
        t.product_name ?? "",
        t.active_substance ?? "",
        t.dose_value ?? "",
        t.dose_unit ?? "",
        t.total_quantity ?? "",
        t.target_disease ?? "",
        t.operator_name ?? "",
        t.note ?? "",
      ]),
    );
  }
  return out;
}

function harvestRows(harvests: Harvest[]): string[] {
  const out = [
    row(["Data", "Cultivar", "Quantità (kg)", "Destinazione", "Note"]),
  ];
  for (const r of harvests) {
    out.push(
      row([
        new Date(r.harvested_at).toLocaleDateString("it-IT"),
        r.cultivar ?? "",
        r.quantity_kg ?? "",
        r.destination_logistics ?? "",
        r.notes ?? "",
      ]),
    );
  }
  return out;
}

/**
 * Costruisce il contenuto CSV dell'executive report: intestazione di contesto,
 * blocco KPI, blocco operazioni e blocco harvests, separati da righe vuote.
 */
export function buildExecutiveReportCsv(args: {
  result: AnalyticsResult;
  treatments: TreatmentLog[];
  harvests: Harvest[];
  companyName: string;
}): string {
  const { result, treatments, harvests, companyName } = args;
  const { summary, kpis } = result;
  const lines: string[] = [];

  lines.push(row(["AgroGea — Executive Report"]));
  lines.push(row(["Company", companyName]));
  lines.push(row(["Annata agraria", summary.campaignYear]));
  lines.push(row(["CropType", summary.categoryLabel]));
  lines.push(row(["Appezzamenti", summary.plotCount]));
  lines.push(row(["Superficie (ha)", summary.totalAreaHa.toFixed(2)]));
  lines.push(row(["Generato il", new Date().toLocaleString("it-IT")]));
  lines.push("");

  lines.push(row(["KPI"]));
  lines.push(...kpiRows(kpis));
  lines.push("");

  lines.push(row(["Operazioni (Quaderno di Campagna)"]));
  lines.push(...treatmentRows(treatments));
  lines.push("");

  lines.push(row(["Raccolte"]));
  lines.push(...harvestRows(harvests));

  return BOM_UTF8 + lines.join("\r\n");
}

/** Nome file suggerito per l'export (azienda + annata + data). */
export function executiveReportFilename(
  companyName: string,
  campaignYear: number,
): string {
  const slug = companyName
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "azienda";
  const stamp = new Date().toISOString().slice(0, 10);
  return `executive_report_${slug}_${campaignYear}_${stamp}.csv`;
}
