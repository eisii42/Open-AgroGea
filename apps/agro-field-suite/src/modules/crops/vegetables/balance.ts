import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dell'orticoltura: Kc per phase della specie "pomodoro" (FAO-56). */
export function balanceVegetables(
  phase: PhenologicalPhase,
  weather: WeatherDataDay[],
  pioggiaSerie: number[],
  soil: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "pomodoro",
    phase,
    weather,
    pioggiaSerie,
    soil,
    deplezioneIniziale,
  });
}
