import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dell'orticoltura: Kc per fase della specie "pomodoro" (FAO-56). */
export function bilancioOrticoltura(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "pomodoro",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
