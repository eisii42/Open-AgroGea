import type { WeatherDataDay, PhenologicalPhase, SoilParameters } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dell'olivo: Kc per phase della specie "olivo" (FAO-56). */
export function bilancioOlivo(
  phase: PhenologicalPhase,
  meteo: WeatherDataDay[],
  pioggiaSerie: number[],
  suolo: SoilParameters,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "olivo",
    phase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
