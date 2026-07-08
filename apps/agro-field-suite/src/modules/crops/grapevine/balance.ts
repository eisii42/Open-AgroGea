import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico della vite: Kc per phase della specie "vite" (FAO-56). */
export function bilancioVite(
  phase: PhenologicalPhase,
  meteo: WeatherDataDay[],
  pioggiaSerie: number[],
  soil: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "vite",
    phase,
    meteo,
    pioggiaSerie,
    soil,
    deplezioneIniziale,
  });
}
