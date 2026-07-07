import type { CampoCampagna } from "../types";

/**
 * Compliance SIAN della Campagna Agraria (Italia): i campi dichiarativi di
 * `plots_campaign` richiesti perché l'export ministeriale della stagione sia
 * completo. Unica fonte di verità per i punti UI che segnalano/gateano la
 * compilazione (badge nei selettori, banner alla raccolta, contatore nella
 * pagina Azienda). La UI applica il controllo solo con country risolto "IT".
 */

/** Campo dichiarativo SIAN mancante su una campagna. */
export type CampoSianMancante =
  | "crop_external_code"
  | "reference_parcel_external_id"
  | "agricultural_parcel_external_id";

const CAMPI_SIAN: CampoSianMancante[] = [
  "crop_external_code",
  "reference_parcel_external_id",
  "agricultural_parcel_external_id",
];

/**
 * Elenca i campi SIAN non compilati della campagna (vuoto = compliant).
 * `variety_external_code` resta facoltativo (non tutte le colture lo hanno).
 */
export function sianMancanti(
  campo: Pick<CampoCampagna, CampoSianMancante>,
): CampoSianMancante[] {
  return CAMPI_SIAN.filter((key) => {
    const v = campo[key];
    return v == null || v.trim() === "";
  });
}

/** true se la campagna ha tutti i dati dichiarativi SIAN richiesti. */
export function sianCompleta(
  campo: Pick<CampoCampagna, CampoSianMancante>,
): boolean {
  return sianMancanti(campo).length === 0;
}
