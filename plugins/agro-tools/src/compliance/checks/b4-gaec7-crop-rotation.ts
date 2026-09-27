import type { CheckSpec, CheckVerdict, IndexSeriesPoint } from "../check-types";
import { multiYearWindow, pointsInWindow, usablePoints, valuesOf } from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B4 — BCAA 7: rotazione e diversificazione colturale sui seminativi.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 7**: rotazione delle colture sui
 * seminativi, con l'obiettivo di preservare il potenziale del suolo. In Italia
 * l'obbligo si declina come avvicendamento a livello di particella con
 * eccezioni e soglie di superficie; la scheda osserva il fatto — la coltura è
 * cambiata? — e lascia le esenzioni all'analisi dell'utente.
 *
 * ## Che cosa si osserva davvero
 *
 * Due fonti, incrociate:
 *   1. le **campagne dichiarate** delle annate precedenti (`plots_campaign`):
 *      se il codice coltura è lo stesso da tre anni, il dato è dichiarativo e
 *      inequivocabile — non serve il satellite per leggerlo;
 *   2. la **somiglianza dei profili** NDVI annuali. Due annate con lo stesso
 *      andamento temporale, stessi massimi negli stessi mesi, sono compatibili
 *      con la stessa coltura; profili diversi indicano un avvicendamento anche
 *      quando le dichiarazioni mancano.
 *
 * La somiglianza si misura come **distanza media fra i profili mensili**: è una
 * metrica grossolana ma leggibile, e la sua grossolanità è preferibile a una
 * correlazione che nessuno saprebbe interpretare guardando il grafico.
 *
 * ## Il limite da dire
 *
 * Servono almeno due annate di archivio, meglio tre. La cache locale ne tiene
 * 24 mesi: oltre, le scene vanno recuperate in rete, e il costo va detto prima
 * di lanciare l'analisi. Senza archivio la scheda dice "non decidibile" —
 * l'unica risposta onesta quando la storia non c'è ancora.
 */

/** Profilo mensile: media NDVI per mese (12 valori, NaN dove mancano scene). */
function monthlyProfile(points: readonly IndexSeriesPoint[]): number[] {
  const sums = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);
  for (const p of points) {
    const month = Number(p.date.slice(5, 7)) - 1;
    const value = p.values["ndvi"];
    if (month < 0 || month > 11 || typeof value !== "number") continue;
    sums[month] += value;
    counts[month] += 1;
  }
  return sums.map((sum, i) => (counts[i] === 0 ? Number.NaN : sum / counts[i]));
}

/**
 * Distanza media fra due profili mensili, sui soli mesi presenti in entrambi.
 * `NaN` se i mesi comuni sono troppo pochi per dire qualcosa (meno di quattro).
 */
export function profileDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 12; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return count < 4 ? Number.NaN : sum / count;
}

export const b4Gaec7CropRotation: CheckSpec = {
  id: "b4_gaec7_crop_rotation",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 7 (rotazione colturale)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b4CropRotation" },
  method: { id: "method.b4CropRotation" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    // Due annate sono il minimo per parlare di avvicendamento; tre rendono il
    // giudizio robusto, e il fattore `archive_depth` lo riflette.
    archiveYears: 2,
    minUsableScenes: 10,
    declared: ["campaign"],
  },
  parameters: [
    {
      id: "rotationSimilarityMax",
      defaultValue: 0.1,
      unit: "NDVI",
      min: 0.02,
      max: 0.4,
      reference: null,
      description: { id: "parameter.rotationSimilarityMax" },
    },
  ],
  window: (campaignYear) => multiYearWindow(campaignYear, 3),

  run(input): CheckVerdict {
    const window = multiYearWindow(input.campaignYear, 3);
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const similarityMax = parameterValue(
      input.parameters,
      "rotationSimilarityMax",
      0.1,
    );

    // 1. Il dato dichiarato, quando c'è, viene prima: è più affidabile di
    // qualunque inferenza spettrale.
    const declaredCodes = input.campaigns
      .filter(
        (c) =>
          c.campaignYear <= input.campaignYear &&
          c.campaignYear >= input.campaignYear - 2,
      )
      .map((c) => c.cropExternalCode ?? c.cropName)
      .filter((code): code is string => Boolean(code));
    const distinctDeclared = new Set(declaredCodes).size;

    // 2. Il confronto dei profili, come corroborazione o come sostituto.
    const current = usablePoints(
      pointsInWindow(
        input.series,
        `${input.campaignYear}-01-01`,
        `${input.campaignYear}-12-31`,
      ),
      "ndvi",
      maxCloud,
    );
    const previous = usablePoints(
      pointsInWindow(
        input.series,
        `${input.campaignYear - 1}-01-01`,
        `${input.campaignYear - 1}-12-31`,
      ),
      "ndvi",
      maxCloud,
    );
    const distance = profileDistance(
      monthlyProfile(current),
      monthlyProfile(previous),
    );

    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points: [...previous, ...current],
    };
    const values = {
      declaredYears: declaredCodes.length,
      distinctCrops: distinctDeclared,
      distance: Number.isFinite(distance) ? Number(distance.toFixed(3)) : 0,
      similarityMax,
    };

    if (declaredCodes.length >= 2 && distinctDeclared >= 2) {
      return {
        outcome: "compliant",
        explanation: { id: "explain.b4Rotated", values },
        series,
      };
    }
    if (declaredCodes.length >= 2 && distinctDeclared === 1) {
      return {
        outcome: "non_compliant",
        explanation: { id: "explain.b4Monoculture", values },
        series,
      };
    }
    if (!Number.isFinite(distance)) {
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: {
              id: "missing.archiveTooShort",
              values: { available: 1, required: 2 },
            },
            where: "archive",
            howToFix: { id: "missing.archiveTooShortFix", values: { required: 2 } },
          },
        ],
        series,
      };
    }
    // Solo il satellite: profili quasi identici sono compatibili con la
    // monosuccessione, ma non la dimostrano — l'esito resta "attenzione".
    return distance <= similarityMax
      ? { outcome: "attention", explanation: { id: "explain.b4Monoculture", values }, series }
      : { outcome: "compliant", explanation: { id: "explain.b4Rotated", values }, series };
  },
};
