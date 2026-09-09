import type { CheckSpec, CheckVerdict } from "../check-types";
import {
  detectDrops,
  pointsInWindow,
  usablePoints,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B2 — BCAA 5: gestione delle lavorazioni sui terreni in pendenza (erosione).
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 5**: gestione della lavorazione del
 * suolo per ridurre il rischio di degrado ed erosione, tenendo conto della
 * pendenza. La declinazione italiana vieta o condiziona le lavorazioni a
 * rittochino oltre una soglia di pendenza, che varia per regione.
 *
 * ## Che cosa si osserva davvero
 *
 * Due segnali che devono ricorrere INSIEME, perché nessuno dei due da solo dice
 * abbastanza:
 *   * la **pendenza**, da modello digitale del terreno — un dato morfologico
 *     stabile, che non viene dal satellite ottico;
 *   * un **evento di lavorazione**, cioè un crollo di NDVI verso valori di suolo
 *     nudo che *non* rimbalza: la firma di un'aratura o di una fresatura.
 *
 * La direzione della lavorazione (rittochino contro girapoggio) — che è ciò che
 * la norma disciplina davvero — a 10 m **non si vede**. La scheda quindi non la
 * giudica: segnala la coesistenza di pendenza e lavorazione, che è il contesto
 * in cui l'obbligo si applica, e lascia all'agricoltore la verifica della
 * modalità. Chiamare "non conforme" una lavorazione su pendenza senza saperne la
 * direzione sarebbe un'accusa costruita su un dato che non abbiamo.
 *
 * ## Perché l'esito massimo è "attenzione"
 *
 * Proprio per questo: il segnale osservabile non copre l'elemento costitutivo
 * della violazione. `non_compliant` qui non è mai raggiungibile, ed è una
 * limitazione dichiarata, non un difetto.
 */
export const b2Gaec5SlopeTillage: CheckSpec = {
  id: "b2_gaec5_slope_tillage",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 5 (lavorazioni e rischio di erosione)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b2SlopeTillage" },
  method: { id: "method.b2SlopeTillage" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 6,
    declared: ["terrain"],
  },
  parameters: [
    {
      id: "slopeThresholdDeg",
      defaultValue: 10,
      unit: "°",
      min: 2,
      max: 45,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 5, soglia di pendenza fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.slopeThresholdDeg" },
    },
    {
      id: "tillageNdviDrop",
      defaultValue: 0.25,
      unit: "NDVI",
      min: 0.1,
      max: 0.6,
      reference: null,
      description: { id: "parameter.tillageNdviDrop" },
    },
  ],
  window: (campaignYear) => ({
    from: `${campaignYear}-01-01`,
    to: `${campaignYear}-12-31`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-01-01`,
      to: `${input.campaignYear}-12-31`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const slopeThreshold = parameterValue(input.parameters, "slopeThresholdDeg", 10);
    const dropThreshold = parameterValue(input.parameters, "tillageNdviDrop", 0.25);
    const slope = input.terrain?.meanSlopeDeg ?? 0;

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    // Una lavorazione lascia il suolo nudo: il calo porta SOTTO la soglia di
    // suolo nudo, e non risale nelle settimane immediatamente successive. Un
    // taglio con ricrescita è uno sfalcio, e appartiene alla D1.
    const tillage = detectDrops(points, "ndvi", dropThreshold).filter(
      (drop) => drop.toValue < 0.25,
    );
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };
    const values = {
      slope: Number(slope.toFixed(1)),
      slopeThreshold,
      events: tillage.length,
      maxSlope: Number((input.terrain?.maxSlopeDeg ?? slope).toFixed(1)),
      source: input.terrain?.source ?? "",
    };

    if (slope < slopeThreshold || tillage.length === 0) {
      return {
        outcome: "compliant",
        explanation: { id: "explain.b2NoTillageOnSlope", values },
        series,
      };
    }
    return {
      // Mai "non conforme": la direzione della lavorazione, che è l'elemento
      // che la norma disciplina, a 10 m non è osservabile.
      outcome: "attention",
      explanation: { id: "explain.b2TillageOnSlope", values },
      series,
    };
  },
};
