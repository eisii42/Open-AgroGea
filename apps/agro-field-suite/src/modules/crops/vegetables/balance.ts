import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dell'orticoltura: Kc per phase della specie "pomodoro" (FAO-56). */
export function bilancioOrticoltura(
  phase: PhenologicalPhase,
  meteo: WeatherDataDay[],
  pioggiaSerie: number[],
  suolo: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "pomodoro",
    phase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
