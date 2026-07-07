import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  bilancioIdricoColtura,
  type BilancioColturaOutput,
} from "../shared/bilancio";

/** Bilancio idrico dell'orticoltura: Kc per fase della specie "pomodoro" (FAO-56). */
export function bilancioOrticoltura(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): BilancioColturaOutput {
  return bilancioIdricoColtura({
    specie: "pomodoro",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
