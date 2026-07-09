import type { PlotCampaign } from "../types";

/**
 * Compliance DICHIARATIVA della Campagna Agraria: i campi di `plots_campaign`
 * richiesti perché l'export ministeriale della stagione sia completo. Unica
 * fonte di verità per i punti UI che segnalano/gateano la compilazione (badge
 * nei selettori, banner alla harvest, contatore nella pagina Company).
 *
 * I sistemi nazionali coperti condividono la STESSA terna di columns (il
 * modello è EU-agnostico), cambia solo la semantica:
 *   * IT — SIAN (AGEA): codice crop ministeriale, Isola (reference parcel),
 *     Plot SIAN — consumati da `buildSianCsv`;
 *   * ES — SIEX/CUE (FEGA): código de cultivo, parcela de referencia e recinto
 *     SIGPAC — consumati da `buildSiexJson` (cultivo/parcela_referencia/recinto).
 * Gli altri paesi non hanno (ancora) un sistema gateato: nessun vincolo.
 */

/** Sistema dichiarativo nazionale che richiede i campi di campagna compilati. */
export type DeclarativeSystem = "SIAN" | "SIEX";

/** Campo dichiarativo mancante su una campagna. */
export type MissingDeclarativeField =
  | "crop_external_code"
  | "reference_parcel_external_id"
  | "agricultural_parcel_external_id";

/** @deprecated alias storico (prima versione IT-only): usa MissingDeclarativeField. */
export type MissingSianField = MissingDeclarativeField;

const DECLARATIVE_FIELDS: MissingDeclarativeField[] = [
  "crop_external_code",
  "reference_parcel_external_id",
  "agricultural_parcel_external_id",
];

/**
 * Sistema dichiarativo del paese risolto, o null se il paese non ne ha uno
 * gateato (il gate UI si disattiva del tutto).
 */
export function declarativeSystem(
  countryCode: string | null | undefined,
): DeclarativeSystem | null {
  switch (countryCode) {
    case "IT":
      return "SIAN";
    case "ES":
      return "SIEX";
    default:
      return null;
  }
}

/**
 * Elenca i campi dichiarativi non compilati della campagna (vuoto = compliant
 * o paese senza sistema gateato). `variety_external_code` resta facoltativo
 * (non tutte le crops lo hanno).
 */
export function missingDeclarative(
  countryCode: string | null | undefined,
  field: Pick<PlotCampaign, MissingDeclarativeField>,
): MissingDeclarativeField[] {
  if (!declarativeSystem(countryCode)) return [];
  return DECLARATIVE_FIELDS.filter((key) => {
    const v = field[key];
    return v == null || v.trim() === "";
  });
}

/** Variante IT-only, senza country (test e chiamate esplicitamente SIAN). */
export function missingSian(
  field: Pick<PlotCampaign, MissingDeclarativeField>,
): MissingDeclarativeField[] {
  return missingDeclarative("IT", field);
}

/** true se la campagna ha tutti i dati dichiarativi richiesti dal paese. */
export function sianComplete(
  field: Pick<PlotCampaign, MissingDeclarativeField>,
): boolean {
  return missingSian(field).length === 0;
}
