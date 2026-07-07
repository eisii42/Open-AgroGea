import type { CampoCampagna } from "../types";

/**
 * Compliance DICHIARATIVA della Campagna Agraria: i campi di `plots_campaign`
 * richiesti perché l'export ministeriale della stagione sia completo. Unica
 * fonte di verità per i punti UI che segnalano/gateano la compilazione (badge
 * nei selettori, banner alla raccolta, contatore nella pagina Azienda).
 *
 * I sistemi nazionali coperti condividono la STESSA terna di colonne (il
 * modello è EU-agnostico), cambia solo la semantica:
 *   * IT — SIAN (AGEA): codice coltura ministeriale, Isola (reference parcel),
 *     Appezzamento SIAN — consumati da `buildSianCsv`;
 *   * ES — SIEX/CUE (FEGA): código de cultivo, parcela de referencia e recinto
 *     SIGPAC — consumati da `buildSiexJson` (cultivo/parcela_referencia/recinto).
 * Gli altri paesi non hanno (ancora) un sistema gateato: nessun vincolo.
 */

/** Sistema dichiarativo nazionale che richiede i campi di campagna compilati. */
export type SistemaDichiarativo = "SIAN" | "SIEX";

/** Campo dichiarativo mancante su una campagna. */
export type CampoDichiarativoMancante =
  | "crop_external_code"
  | "reference_parcel_external_id"
  | "agricultural_parcel_external_id";

/** @deprecated alias storico (prima versione IT-only): usa CampoDichiarativoMancante. */
export type CampoSianMancante = CampoDichiarativoMancante;

const CAMPI_DICHIARATIVI: CampoDichiarativoMancante[] = [
  "crop_external_code",
  "reference_parcel_external_id",
  "agricultural_parcel_external_id",
];

/**
 * Sistema dichiarativo del paese risolto, o null se il paese non ne ha uno
 * gateato (il gate UI si disattiva del tutto).
 */
export function sistemaDichiarativo(
  countryCode: string | null | undefined,
): SistemaDichiarativo | null {
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
 * (non tutte le colture lo hanno).
 */
export function dichiarativiMancanti(
  countryCode: string | null | undefined,
  campo: Pick<CampoCampagna, CampoDichiarativoMancante>,
): CampoDichiarativoMancante[] {
  if (!sistemaDichiarativo(countryCode)) return [];
  return CAMPI_DICHIARATIVI.filter((key) => {
    const v = campo[key];
    return v == null || v.trim() === "";
  });
}

/** Variante IT-only, senza country (test e chiamate esplicitamente SIAN). */
export function sianMancanti(
  campo: Pick<CampoCampagna, CampoDichiarativoMancante>,
): CampoDichiarativoMancante[] {
  return dichiarativiMancanti("IT", campo);
}

/** true se la campagna ha tutti i dati dichiarativi richiesti dal paese. */
export function sianCompleta(
  campo: Pick<CampoCampagna, CampoDichiarativoMancante>,
): boolean {
  return sianMancanti(campo).length === 0;
}
