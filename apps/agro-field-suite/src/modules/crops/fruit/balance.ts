import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico della frutta: Kc per fase della specie "melo" (FAO-56). */
export function bilancioFrutta(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "melo",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
