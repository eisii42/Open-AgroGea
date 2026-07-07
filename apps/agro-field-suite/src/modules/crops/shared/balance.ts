import {
  type CropType as SpecieFenologica,
  type DatiMeteoGiorno,
  et0PenmanMonteith,
  etColturale,
  type FaseFenologica,
  getCalibrazioneFase,
  type ParametriSuolo,
  type PianoIrriguoGiorno,
  pianoIrriguo,
} from "@agrogea/tools";

/**
 * Bilancio idrico colturale (refactor §3, comune ai moduli coltura).
 *
 * Compone gli engine puri senza duplicarli:
 *   * `et0PenmanMonteith` (agrometeo) → ET0 di riferimento per ogni giorno;
 *   * Kc della fase fenologica dalla matrice della **specie** (`fenologia`);
 *   * `etColturale` = ET0·Kc → ETc giornaliera;
 *   * `pianoIrriguo` (agrometeo) → bilancio idrico del suolo e piano irriguo.
 *
 * Il Kc "declinato per fase fenologica della coltura" è quello di `fenologia`:
 * qui si seleziona solo quello giusto per specie+fase e si proietta il bilancio.
 */

export interface BilancioColturaInput {
  specie: SpecieFenologica;
  fase: FaseFenologica;
  /** Serie meteo giornaliera (stessa lunghezza di `pioggiaSerie`). */
  meteo: DatiMeteoGiorno[];
  /** Pioggia giornaliera (mm), allineata a `meteo`. */
  pioggiaSerie: number[];
  suolo: ParametriSuolo;
  /** Deplezione iniziale del suolo (mm). */
  deplezioneIniziale?: number;
}

export interface BilancioColturaOutput {
  /** Coefficiente colturale Kc usato (specie + fase). */
  kc: number;
  /** ETc giornaliera (mm). */
  etcSerie: number[];
  /** Bilancio giorno per giorno e piano irriguo. */
  serie: PianoIrriguoGiorno[];
  /** Giorni di autonomia prima del primo stress senza irrigare. */
  giorniAutonomia: number;
}

export function bilancioIdricoColtura(
  input: BilancioColturaInput,
): BilancioColturaOutput {
  const kc = getCalibrazioneFase(input.specie, input.fase).kc;
  const etcSerie = input.meteo.map((giorno) =>
    etColturale(et0PenmanMonteith(giorno), kc),
  );
  const { serie, giorniAutonomia } = pianoIrriguo(
    input.suolo,
    etcSerie,
    input.pioggiaSerie,
    input.deplezioneIniziale ?? 0,
  );
  return { kc, etcSerie, serie, giorniAutonomia };
}
