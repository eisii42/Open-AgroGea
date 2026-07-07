import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  bilancioIdricoColtura,
  type BilancioColturaOutput,
} from "../shared/balance";

/** Bilancio idrico dell'olivo: Kc per fase della specie "olivo" (FAO-56). */
export function bilancioOlivo(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): BilancioColturaOutput {
  return bilancioIdricoColtura({
    specie: "olivo",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
