import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  bilancioIdricoColtura,
  type BilancioColturaOutput,
} from "../shared/bilancio";

/** Bilancio idrico della frutta: Kc per fase della specie "melo" (FAO-56). */
export function bilancioFrutta(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): BilancioColturaOutput {
  return bilancioIdricoColtura({
    specie: "melo",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
