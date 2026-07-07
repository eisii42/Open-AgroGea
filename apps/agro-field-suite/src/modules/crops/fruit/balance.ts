import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico della frutta: Kc per phase della specie "melo" (FAO-56). */
export function bilancioFrutta(
  phase: PhenologicalPhase,
  meteo: WeatherDataDay[],
  pioggiaSerie: number[],
  suolo: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "melo",
    phase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
