import {
  type CropType as PhenologicalSpecies,
  type WeatherDataDay,
  et0PenmanMonteith,
  cropEt,
  type PhenologicalPhase,
  getPhaseCalibration,
  type SoilParameters,
  type IrrigationPlanDay,
  irrigationPlan,
} from "@agrogea/tools";

/**
 * Bilancio idrico colturale (refactor §3, comune ai moduli coltura).
 *
 * Compone gli engine puri senza duplicarli:
 *   * `et0PenmanMonteith` (agrometeo) → ET0 di riferimento per ogni day;
 *   * Kc della phase fenologica dalla matrice della **specie** (`fenologia`);
 *   * `cropEt` = ET0·Kc → ETc giornaliera;
 *   * `irrigationPlan` (agrometeo) → bilancio idrico del suolo e piano irriguo.
 *
 * Il Kc "declinato per phase fenologica della coltura" è quello di `fenologia`:
 * qui si seleziona solo quello giusto per specie+phase e si proietta il bilancio.
 */

export interface CropBalanceInput {
  specie: PhenologicalSpecies;
  phase: PhenologicalPhase;
  /** Serie meteo giornaliera (stessa lunghezza di `pioggiaSerie`). */
  meteo: WeatherDataDay[];
  /** Pioggia giornaliera (mm), allineata a `meteo`. */
  pioggiaSerie: number[];
  suolo: SoilParameters;
  /** Deplezione iniziale del suolo (mm). */
  deplezioneIniziale?: number;
}

export interface CropBalanceOutput {
  /** Coefficiente colturale Kc usato (specie + phase). */
  kc: number;
  /** ETc giornaliera (mm). */
  etcSerie: number[];
  /** Bilancio day per day e piano irriguo. */
  series: IrrigationPlanDay[];
  /** Giorni di autonomia prima del primo stress senza irrigare. */
  autonomyDays: number;
}

export function cropWaterBalance(
  input: CropBalanceInput,
): CropBalanceOutput {
  const kc = getPhaseCalibration(input.specie, input.phase).kc;
  const etcSerie = input.meteo.map((day) =>
    cropEt(et0PenmanMonteith(day), kc),
  );
  const { series, autonomyDays } = irrigationPlan(
    input.suolo,
    etcSerie,
    input.pioggiaSerie,
    input.deplezioneIniziale ?? 0,
  );
  return { kc, etcSerie, series, autonomyDays };
}
