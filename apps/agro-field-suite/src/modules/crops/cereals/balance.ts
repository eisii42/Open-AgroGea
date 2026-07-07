import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  cropWaterBalance,
  type CropBalanceOutput,
} from "../shared/balance";

/** Bilancio idrico dei cereali: Kc per fase della specie "frumento" (FAO-56). */
export function bilancioCereali(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): CropBalanceOutput {
  return cropWaterBalance({
    specie: "frumento",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
