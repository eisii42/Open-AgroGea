import type { DatiMeteoGiorno, FaseFenologica, ParametriSuolo } from "@agrogea/tools";
import {
  bilancioIdricoColtura,
  type BilancioColturaOutput,
} from "../shared/bilancio";

/** Bilancio idrico della vite: Kc per fase della specie "vite" (FAO-56). */
export function bilancioVite(
  fase: FaseFenologica,
  meteo: DatiMeteoGiorno[],
  pioggiaSerie: number[],
  suolo: ParametriSuolo,
  deplezioneIniziale = 0,
): BilancioColturaOutput {
  return bilancioIdricoColtura({
    specie: "vite",
    fase,
    meteo,
    pioggiaSerie,
    suolo,
    deplezioneIniziale,
  });
}
