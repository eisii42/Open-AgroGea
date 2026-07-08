/**
 * Validazione localizzata dei campi obbligatori comuni europei (PAN — Piano di
 * Azione Nazionale / uso sostenibile dei fitosanitari, Dir. 2009/128/CE).
 *
 * PURO (nessun DOM/React): ogni validatore ritorna una lista di
 * {@link ValidationError} con la `field` e una chiave i18n `messageKey` (namespace
 * `validation`), risolta dalla UI con `t()`. Testabile sotto `node --test`.
 */

/** Errore di validazione: field + chiave i18n del messaggio. */
export interface ValidationError {
  field: string;
  messageKey: string;
  /** Parametri di interpolazione per la stringa tradotta. */
  params?: Record<string, string | number>;
}

/** Unità di misura ammesse per la dose (PAN). */
export const PAN_DOSE_UNITS = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"] as const;
export type PanDoseUnit = (typeof PAN_DOSE_UNITS)[number];

/** Tipi di concime ammessi (organico/minerale, IT/EN). */
const FERTILIZER_TYPES = new Set([
  "organico",
  "minerale",
  "organic",
  "mineral",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NPK_RE = /^\d{1,3}-\d{1,3}-\d{1,3}$/;

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function isValidIsoDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isPositiveNumber(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Bozza di un treatment fitosanitario (campi PAN obbligatori). */
export interface TreatmentDraft {
  operation_date?: string | null;
  target_disease?: string | null;
  product_name?: string | null;
  registration_number?: string | null;
  active_substance?: string | null;
  applied_dose?: number | null;
  unit_of_measure?: string | null;
  operator_license_number?: string | null;
}

/** Valida un treatment fitosanitario secondo le regole PAN europee. */
export function validateTreatmentLog(d: TreatmentDraft): ValidationError[] {
  const errors: ValidationError[] = [];
  const required: [keyof TreatmentDraft, string][] = [
    ["target_disease", "target_disease"],
    ["product_name", "product_name"],
    ["registration_number", "registration_number"],
    ["active_substance", "active_substance"],
    ["operator_license_number", "operator_license_number"],
  ];

  if (isBlank(d.operation_date)) {
    errors.push({ field: "operation_date", messageKey: "validation.required" });
  } else if (!isValidIsoDate(String(d.operation_date))) {
    errors.push({ field: "operation_date", messageKey: "validation.dateFormat" });
  }

  for (const [field] of required) {
    if (isBlank(d[field])) {
      errors.push({ field: String(field), messageKey: "validation.required" });
    }
  }

  if (d.applied_dose == null) {
    errors.push({ field: "applied_dose", messageKey: "validation.required" });
  } else if (!isPositiveNumber(d.applied_dose)) {
    errors.push({ field: "applied_dose", messageKey: "validation.positiveNumber" });
  }

  if (isBlank(d.unit_of_measure)) {
    errors.push({ field: "unit_of_measure", messageKey: "validation.required" });
  } else if (!(PAN_DOSE_UNITS as readonly string[]).includes(String(d.unit_of_measure))) {
    errors.push({
      field: "unit_of_measure",
      messageKey: "validation.invalidUnit",
      params: { allowed: PAN_DOSE_UNITS.join(", ") },
    });
  }

  return errors;
}

/** Bozza di una fertilizzazione (campi PAN obbligatori). */
export interface FertilizationDraft {
  operation_date?: string | null;
  fertilizer_type?: string | null;
  commercial_name?: string | null;
  total_amount_kg?: number | null;
  npk_ratio?: string | null;
}

/** Valida una fertilizzazione secondo le regole PAN europee. */
export function validateFertilizationLog(d: FertilizationDraft): ValidationError[] {
  const errors: ValidationError[] = [];

  if (isBlank(d.operation_date)) {
    errors.push({ field: "operation_date", messageKey: "validation.required" });
  } else if (!isValidIsoDate(String(d.operation_date))) {
    errors.push({ field: "operation_date", messageKey: "validation.dateFormat" });
  }

  if (isBlank(d.fertilizer_type)) {
    errors.push({ field: "fertilizer_type", messageKey: "validation.required" });
  } else if (!FERTILIZER_TYPES.has(String(d.fertilizer_type).trim().toLowerCase())) {
    errors.push({
      field: "fertilizer_type",
      messageKey: "validation.invalidFertilizerType",
    });
  }

  if (isBlank(d.commercial_name)) {
    errors.push({ field: "commercial_name", messageKey: "validation.required" });
  }

  if (d.total_amount_kg == null) {
    errors.push({ field: "total_amount_kg", messageKey: "validation.required" });
  } else if (!isPositiveNumber(d.total_amount_kg)) {
    errors.push({ field: "total_amount_kg", messageKey: "validation.positiveNumber" });
  }

  if (isBlank(d.npk_ratio)) {
    errors.push({ field: "npk_ratio", messageKey: "validation.required" });
  } else if (!NPK_RE.test(String(d.npk_ratio).trim())) {
    errors.push({ field: "npk_ratio", messageKey: "validation.npkFormat" });
  }

  return errors;
}
