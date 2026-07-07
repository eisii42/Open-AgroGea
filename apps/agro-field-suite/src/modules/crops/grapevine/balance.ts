import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico della vite: Kc per fase della specie "vite" (FAO-56). */
export function bilancioVite(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "vite",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
