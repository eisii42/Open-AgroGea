import { CROP_MATRICES, type CropType } from "../../phenology";
import type { CheckSpec, CheckVerdict } from "../check-types";
import { resolutionFitFactor } from "../confidence";
import {
  calendarYearWindow,
  maxOf,
  minOf,
  pointsInWindow,
  usablePoints,
  valuesOf,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * A2 — Coerenza fra la coltura DICHIARATA e il profilo osservato.
 *
 * ## Che cosa dice la norma
 *
 * La domanda unica dichiara, per ogni appezzamento, il gruppo colturale e la
 * superficie: Reg. (UE) 2021/2116 art. 66 impone all'Organismo Pagatore di
 * verificarne la coerenza con le osservazioni satellitari (AMS). Una coltura
 * dichiarata che il profilo temporale contraddice è la seconda anomalia più
 * cercata dopo l'abbandono.
 *
 * ## Che cosa si osserva davvero, e che cosa NON si fa
 *
 * **Non si classifica la coltura.** È la scelta metodologica centrale di questa
 * scheda, ed è deliberatamente prudente: una classificazione colturale seria
 * richiede un classificatore addestrato su verità a terra locale, con
 * accuratezze che crollano fuori dall'area di addestramento. Costruirne uno
 * approssimativo e presentarne l'output accanto a un obbligo normativo sarebbe
 * il modo più rapido di far perdere fiducia all'utente il giorno in cui sbaglia.
 *
 * Si verifica invece la **coerenza**: il profilo osservato è compatibile con la
 * banda NDVI attesa per la coltura dichiarata (matrici di calibrazione
 * fenologica di `phenology.ts`)? Se sì, non si aggiunge nulla; se no, si segnala
 * una divergenza da guardare — mai una coltura alternativa, che non sapremmo
 * nominare.
 *
 * ## Perché la confidenza è bassa di default
 *
 * Le bande attese sono valori di letteratura, non verità locali: annata, suolo,
 * varietà e gestione le spostano parecchio. La scheda dichiara osservabilità
 * `medium` e pesa il proprio giudizio come indizio, non come misura.
 */

/** Mappa dalla categoria colturale dichiarata alla matrice fenologica. */
const CATEGORY_TO_CROP: Record<string, CropType> = {
  viticoltura: "vite",
  olivicoltura: "olivo",
  frutticoltura: "melo",
  seminativo: "frumento",
  orticoltura: "pomodoro",
};

/** Banda NDVI attesa nell'annata: dal minimo iniziale al massimo di piena. */
function expectedBand(crop: CropType): { low: number; high: number } {
  const phases = CROP_MATRICES[crop].fasi;
  return {
    low: Math.min(...phases.map((p) => p.ndviAtteso[0])),
    high: Math.max(...phases.map((p) => p.ndviAtteso[1])),
  };
}

export const a2CropCoherence: CheckSpec = {
  id: "a2_crop_coherence",
  group: "eligibility",
  reference: {
    act: "Reg. (UE) 2021/2116",
    provision: "art. 66 — sistema di monitoraggio delle superfici (AMS)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.a2CropCoherence" },
  method: { id: "method.a2CropCoherence" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 8,
    declared: ["campaign", "crop"],
  },
  parameters: [
    {
      id: "coherenceTolerance",
      defaultValue: 0.15,
      unit: "NDVI",
      min: 0.05,
      max: 0.5,
      reference: null,
      description: { id: "parameter.coherenceTolerance" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const window = calendarYearWindow(input.campaignYear);
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const tolerance = parameterValue(input.parameters, "coherenceTolerance", 0.15);
    const campaign = input.campaigns.find(
      (c) => c.campaignYear === input.campaignYear,
    );
    const crop = CATEGORY_TO_CROP[campaign?.cropCategory ?? ""];

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };

    if (!crop) {
      // La categoria dichiarata non ha una matrice di riferimento: non c'è
      // nulla contro cui confrontare, e inventare una banda attesa sarebbe
      // peggio che tacere.
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: { id: "missing.crop" },
            where: "campaign",
            howToFix: { id: "missing.cropFix" },
          },
        ],
        series,
      };
    }

    const values = valuesOf(points, "ndvi");
    const observedMax = maxOf(values);
    const observedMin = minOf(values);
    const band = expectedBand(crop);
    // Il massimo stagionale è il descrittore più robusto: dipende meno dalla
    // data esatta delle riprese di quanto dipenda una media.
    const above = observedMax - band.high;
    const below = band.high - observedMax;
    const coherent = above <= tolerance && below <= tolerance * 2;

    const explanationValues = {
      crop: campaign?.cropName ?? crop,
      observedMax: Number(observedMax.toFixed(2)),
      observedMin: Number(observedMin.toFixed(2)),
      expectedLow: band.low,
      expectedHigh: band.high,
      tolerance,
    };
    // La risoluzione entra come fattore esplicito: su un vigneto l'interfila
    // mescola suolo e chioma dentro lo stesso pixel, e la banda attesa vale
    // meno di quanto varrebbe su un seminativo a copertura continua.
    const factors = [resolutionFitFactor(CROP_MATRICES[crop].arborea ? 10 : 30)];

    return coherent
      ? {
          outcome: "compliant",
          explanation: { id: "explain.a2Coherent", values: explanationValues },
          factors,
          series,
        }
      : {
          outcome: "attention",
          explanation: { id: "explain.a2Divergent", values: explanationValues },
          factors,
          series,
        };
  },
};
