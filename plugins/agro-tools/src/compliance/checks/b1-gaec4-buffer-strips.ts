import type { CheckSpec, CheckVerdict } from "../check-types";
import { calendarYearWindow } from "../series";
import { parameterValue } from "../runner";

/**
 * B1 — BCAA 4: fasce tampone lungo i corsi d'acqua.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 4**: obbligo di costituire fasce tampone
 * lungo i corsi d'acqua, entro le quali sono vietati l'uso di fertilizzanti e,
 * secondo la declinazione nazionale, di prodotti fitosanitari. In Italia la
 * larghezza minima è di 3 metri dal ciglio di sponda, con deroghe regionali.
 *
 * ## Che cosa si osserva davvero: NIENTE, ed è il punto
 *
 * Questa scheda **non è spettrale**. Una fascia di tre metri è un terzo di un
 * pixel Sentinel-2: cercarla nell'NDVI sarebbe una finzione. È un confronto
 * GEOMETRICO fra la geometria dell'appezzamento e il reticolo idrografico, e
 * riusa il percorso che `geo-compliance.ts` già usa per ZVN, SIC/ZPS ed EUDR —
 * lo stesso prefiltro per bounding box e lo stesso `booleanIntersects`, esteso
 * al layer del reticolo con la distanza minima.
 *
 * Il calcolo geometrico resta nel modulo dell'app (dove vivono turf e i layer);
 * qui arriva già fatto, in {@link CheckInput.layers}. È deliberato: una funzione
 * pura che dipendesse dai layer caricati non sarebbe più pura, e il pacchetto
 * `@agrogea/tools` non ha — e non deve avere — le dipendenze geometriche.
 *
 * ## Il limite da dire
 *
 * L'esito vale quanto il layer idrografico che l'utente ha caricato. Un reticolo
 * incompleto o generalizzato produce distanze sbagliate, e nessuna elaborazione
 * successiva può accorgersene: per questo, senza layer, l'esito è "non
 * decidibile" e non "conforme".
 */
export const b1Gaec4BufferStrips: CheckSpec = {
  id: "b1_gaec4_buffer_strips",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 4 (fasce tampone lungo i corsi d'acqua)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b1BufferStrips" },
  method: { id: "method.b1BufferStrips" },
  observability: "high",
  requires: {
    // Nessun indice: la verifica è geometrica, non spettrale.
    indices: [],
    archiveYears: 1,
    minUsableScenes: 0,
    declared: ["waterNetworkLayer"],
  },
  parameters: [
    {
      id: "bufferWidthM",
      defaultValue: 3,
      unit: "m",
      min: 1,
      max: 50,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 4, larghezza fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.bufferWidthM" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const width = parameterValue(input.parameters, "bufferWidthM", 3);
    const distance = input.layers.minDistanceToWaterM;

    if (distance == null) {
      // Il layer c'è (altrimenti il runner avrebbe già fermato la scheda) ma la
      // distanza non è calcolabile: nessun corso d'acqua nel raggio utile, o
      // geometria degenere. Non è una conformità, è un'assenza di dato.
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: { id: "missing.layer", values: { layer: "water_network" } },
            where: "layers",
            howToFix: { id: "missing.layerFix", values: { layer: "water_network" } },
          },
        ],
      };
    }

    const values = { distance: Number(distance.toFixed(1)), width };
    return distance >= width
      ? { outcome: "compliant", explanation: { id: "explain.b1Compliant", values } }
      : { outcome: "non_compliant", explanation: { id: "explain.b1TooClose", values } };
  },
};
