import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dei cereali: Kc per phase della specie "frumento" (FAO-56). */
export function cerealsBalance(
  phase: PhenologicalPhase,
  weather: WeatherDataDay[],
  pioggiaSerie: number[],
  soil: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "frumento",
    phase,
    weather,
    pioggiaSerie,
    soil,
    deplezioneIniziale,
  });
}
