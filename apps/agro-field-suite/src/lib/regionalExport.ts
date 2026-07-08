/**
 * Motore di esportazione REGIONALE del Quaderno di Campagna (Modulo 4).
 *
 * Adapter Pattern: l'interfaccia {@link RegionalExporter} è istanziata in base al
 * `country_code` del tenant. Ogni adapter conosce il tracciato ufficiale del suo
 * paese:
 *   * IT → SIAN/PAN: CSV `;`, UTF-8 con BOM (apertura corretta in Excel IT),
 *     header e codici Isola/Plot ministeriali (riusa `sianExport`).
 *   * ES → SIEX/CUE: JSON strutturato del *Cuaderno Digital de Explotación*
 *     (FEGA), campi in spagnolo.
 *   * EU → base internazionale: CSV `,`, UTF-8 pulito, date ISO `YYYY-MM-DD`.
 *
 * Parte PURA (nessun DOM/React): `build*` ritorna stringhe, testabili sotto
 * `node --test`. Il download nel browser è in `scaricaExport`.
 */
import type {
  Plot,
  PlotCampaign,
  CountryCode,
  TreatmentLog,
} from "@agrogea/core";
import {
  buildSianCsv,
  CONFIG_SIAN_DEFAULT,
  type SianExportConfig,
} from "./sianExport";

/** Dati grezzi dell'export (registro + anagrafica fisica + stato di campagna). */
export interface RegionalExportInput {
  treatments: TreatmentLog[];
  plots: Plot[];
  campaignFields: PlotCampaign[];
  aziendaName?: string;
}

/** Record neutro EU-agnostico per una singola operation (base di ES/EU). */
export interface NeutralOperation {
  operation_date: string; // ISO YYYY-MM-DD
  plot_name: string;
  reference_parcel_external_id: string;
  agricultural_parcel_external_id: string;
  crop_external_code: string;
  declared_area_ha: number | null;
  operation_type: string;
  product_name: string;
  registration_number: string;
  active_substance: string;
  applied_dose: number | null;
  unit_of_measure: string;
  total_quantity: number | null;
  target: string;
  operator_license_number: string;
  reentry_hours: number | null;
  phi_days: number | null;
}

function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Appiattisce il registro in record neutri, congelando lo stato di campagna. */
export function flattenOperations(
  input: RegionalExportInput,
): NeutralOperation[] {
  const plotById = new Map(input.plots.map((a) => [a.id, a]));
  const campaignById = new Map(input.campaignFields.map((c) => [c.id, c]));
  return input.treatments.map((t) => {
    const plot = t.plot_id ? plotById.get(t.plot_id) : undefined;
    const campaign = t.plot_campaign_id
      ? campaignById.get(t.plot_campaign_id)
      : undefined;
    return {
      operation_date: isoDate(t.executed_at),
      plot_name: plot?.user_plot_name ?? "",
      reference_parcel_external_id: campaign?.reference_parcel_external_id ?? "",
      agricultural_parcel_external_id:
        campaign?.agricultural_parcel_external_id ?? "",
      crop_external_code: campaign?.crop_external_code ?? "",
      declared_area_ha: campaign?.declared_area_ha ?? plot?.area_ha ?? null,
      operation_type: t.operation_type,
      product_name: t.product_name ?? "",
      registration_number: t.registration_number ?? "",
      active_substance: t.active_substance ?? "",
      applied_dose: t.dose_value ?? null,
      unit_of_measure: t.dose_unit ?? "",
      total_quantity: t.total_quantity ?? null,
      target: t.target_disease ?? "",
      operator_license_number: t.license_number ?? "",
      reentry_hours: t.reentry_interval_h ?? null,
      phi_days: t.safety_period_days ?? null,
    };
  });
}

function csvCell(value: unknown, sep: string): string {
  if (value == null) return "";
  const s = String(value);
  const needsQuote = s.includes('"') || s.includes("\n") || s.includes(sep);
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Colonne del tracciato internazionale (chiavi neutre EU-agnostiche). */
const BASE_COLUMNS: (keyof NeutralOperation)[] = [
  "operation_date",
  "plot_name",
  "reference_parcel_external_id",
  "agricultural_parcel_external_id",
  "crop_external_code",
  "declared_area_ha",
  "operation_type",
  "product_name",
  "registration_number",
  "active_substance",
  "applied_dose",
  "unit_of_measure",
  "total_quantity",
  "target",
  "operator_license_number",
  "reentry_hours",
  "phi_days",
];

/** EU — CSV internazionale: separatore `,`, UTF-8 pulito, date ISO. */
export function buildBaseCsv(input: RegionalExportInput): string {
  const rows = flattenOperations(input);
  const header = BASE_COLUMNS.join(",");
  const lines = rows.map((r) =>
    BASE_COLUMNS.map((c) => csvCell(r[c], ",")).join(","),
  );
  return [header, ...lines].join("\n");
}

/**
 * ES — Cuaderno Digital de Explotación (SIEX/FEGA): JSON strutturato con
 * intestazione dell'esplotazione e array delle operaciones, campi in spagnolo.
 */
export function buildSiexJson(input: RegionalExportInput): string {
  const operaciones = flattenOperations(input).map((r) => ({
    fecha: r.operation_date,
    recinto: r.agricultural_parcel_external_id,
    parcela_referencia: r.reference_parcel_external_id,
    cultivo: r.crop_external_code,
    superficie_ha: r.declared_area_ha,
    tipo_operacion: r.operation_type,
    producto: r.product_name,
    num_registro: r.registration_number,
    materia_activa: r.active_substance,
    dosis: r.applied_dose,
    unidad: r.unit_of_measure,
    cantidad_total: r.total_quantity,
    objetivo: r.target,
    num_carne_aplicador: r.operator_license_number,
    plazo_reentrada_h: r.reentry_hours,
    plazo_seguridad_dias: r.phi_days,
  }));
  return JSON.stringify(
    {
      cuaderno_digital_explotacion: {
        version: "1.0",
        explotacion: input.aziendaName ?? "",
        generado: new Date().toISOString(),
        operaciones,
      },
    },
    null,
    2,
  );
}

/** Esportatore regionale concreto. */
export interface RegionalExporter {
  countryCode: CountryCode;
  /** Tracciato ufficiale (per log/UI). */
  label: string;
  format: "csv" | "json" | "xml";
  fileExtension: string;
  mimeType: string;
  /** Premette il BOM UTF-8 al contenuto (Excel IT). */
  bom: boolean;
  build(input: RegionalExportInput): string;
  fileName(aziendaName?: string): string;
}

function slug(name = "azienda"): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "azienda";
}
function oggi(): string {
  return new Date().toISOString().slice(0, 10);
}

/** IT — SIAN/PAN. Riusa il tracciato CSV configurabile di `sianExport`. */
export function makeItExporter(
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
): RegionalExporter {
  return {
    countryCode: "IT",
    label: "SIAN/PAN (Quaderno di Campagna)",
    format: "csv",
    fileExtension: "csv",
    mimeType: "text/csv;charset=utf-8",
    bom: config.bom,
    build: (input) =>
      buildSianCsv(
        input.treatments,
        input.plots,
        config,
        input.campaignFields,
      ),
    fileName: (name) => `quaderno-sian-${slug(name)}-${oggi()}.csv`,
  };
}

/** ES — SIEX/CUE (Cuaderno Digital de Explotación, JSON). */
export const esExporter: RegionalExporter = {
  countryCode: "ES",
  label: "SIEX/CUE (Cuaderno Digital de Explotación)",
  format: "json",
  fileExtension: "json",
  mimeType: "application/json;charset=utf-8",
  bom: false,
  build: buildSiexJson,
  fileName: (name) => `cuaderno-digital-${slug(name)}-${oggi()}.json`,
};

/** EU — base internazionale (CSV ISO). */
export const baseExporter: RegionalExporter = {
  countryCode: "EU",
  label: "International base (ISO CSV)",
  format: "csv",
  fileExtension: "csv",
  mimeType: "text/csv;charset=utf-8",
  bom: false,
  build: buildBaseCsv,
  fileName: (name) => `field-logbook-${slug(name)}-${oggi()}.csv`,
};

/**
 * Istanzia l'esportatore corretto in base alla geolocalizzazione del tenant.
 * FR usa il base internazionale finché non è disponibile un adapter TelePAC
 * dedicato in export (l'import FR è già coperto da AbstractGisParser).
 */
export function getRegionalExporter(countryCode: CountryCode): RegionalExporter {
  switch (countryCode) {
    case "IT":
      return makeItExporter();
    case "ES":
      return esExporter;
    default:
      return baseExporter;
  }
}

/** Scarica nel browser l'export product dall'adapter regionale. Ritorna il name file. */
export function downloadExport(
  exporter: RegionalExporter,
  input: RegionalExportInput,
): string {
  const contenuto = exporter.build(input);
  const payload = exporter.bom ? `﻿${contenuto}` : contenuto;
  const blob = new Blob([payload], { type: exporter.mimeType });
  const url = URL.createObjectURL(blob);
  const fileName = exporter.fileName(input.aziendaName);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return fileName;
}
