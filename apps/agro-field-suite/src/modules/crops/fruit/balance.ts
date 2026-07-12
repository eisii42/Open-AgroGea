import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico della frutta: Kc per phase della specie "melo" (FAO-56). */
export function fruitBalance(
  phase: PhenologicalPhase,
  weather: WeatherDataDay[],
  pioggiaSerie: number[],
  soil: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "melo",
    phase,
    weather,
    pioggiaSerie,
    soil,
    deplezioneIniziale,
  });
}
