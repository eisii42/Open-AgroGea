import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  bilancioIdricoColtura,
  type BilancioColturaOutput,
} from "../shared/balance";

/** Bilancio idrico dei cereali: Kc per fase della specie "frumento" (FAO-56). */
export function bilancioCereali(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): BilancioColturaOutput {
  return bilancioIdricoColtura({
    specie: "frumento",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
