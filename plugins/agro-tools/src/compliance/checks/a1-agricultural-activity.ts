import type { CheckSpec, CheckVerdict } from "../check-types";
import { archiveDepthFactor } from "../confidence";
import {
  calendarYearWindow,
  daysAboveThresholdShare,
  detectDrops,
  maxOf,
  minOf,
  pointsInWindow,
  usablePoints,
  valuesOf,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * A1 — Attività agricola / superficie mantenuta (nessun abbandono).
 *
 * ## Che cosa dice la norma
 *
 * Il Reg. (UE) 2021/2115 (art. 4) ammette al sostegno la superficie AGRICOLA, e
 * la definizione presuppone che sia coltivata o comunque **mantenuta** in uno
 * stato che la renda idonea al pascolo o alla coltivazione. Una superficie
 * abbandonata non è ammissibile, e l'abbandono è una delle anomalie che l'AMS
 * dell'Organismo Pagatore cerca per prima.
 *
 * ## Che cosa si osserva davvero
 *
 * **Non la verdezza: gli EVENTI DI GESTIONE.** È il punto centrale del metodo, e
 * il motivo per cui una soglia di NDVI da sola non basterebbe: un incolto
 * invaso da rovi ha un NDVI alto e stabile, più alto di un seminativo appena
 * arato. Ciò che distingue una superficie gestita è la DISCONTINUITÀ — il
 * gradino verso il basso di uno sfalcio, di una raccolta, di una lavorazione —
 * non il livello assoluto del verde.
 *
 * Si guardano quindi tre cose, in quest'ordine:
 *   1. quanti cali bruschi (eventi di gestione) compaiono nell'annata;
 *   2. quanto la superficie è stata "attiva", cioè sopra la soglia di
 *      vegetazione, come contesto;
 *   3. l'AMPIEZZA del profilo (max − min): una superficie gestita oscilla, un
 *      incolto stabilizzato no.
 *
 * ## Perché il metodo è difendibile
 *
 * È lo stesso principio dei *markers* dell'AMS: si cerca la firma temporale di
 * un'operazione, non un valore soglia. Il limite dichiarato è che un evento
 * caduto dentro un buco di nuvole non si vede — ed è esattamente ciò che il
 * fattore `temporal_gap` della confidenza serve a raccontare.
 *
 * ## Che cosa NON dice
 *
 * Non dice che l'attività sia stata quella dichiarata, né che sia stata
 * conforme: dice che qualcuno ha lavorato quella superficie. La coerenza con la
 * coltura dichiarata è la scheda A2.
 */
export const a1AgriculturalActivity: CheckSpec = {
  id: "a1_agricultural_activity",
  group: "eligibility",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "art. 4 — superficie agricola ammissibile",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.a1AgriculturalActivity" },
  method: { id: "method.a1AgriculturalActivity" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    // Basta l'annata osservata: pretendere l'archivio pluriennale renderebbe
    // "non decidibile" la scheda più utile proprio a chi installa oggi. Le
    // annate precedenti, se ci sono, entrano come corroborazione (vedi sotto).
    archiveYears: 1,
    minUsableScenes: 6,
    declared: [],
  },
  parameters: [
    {
      id: "activityNdviThreshold",
      defaultValue: 0.3,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.activityNdviThreshold" },
    },
    {
      id: "managementDropDelta",
      defaultValue: 0.15,
      unit: "NDVI",
      min: 0.05,
      max: 0.5,
      reference: null,
      description: { id: "parameter.mowingDropDelta" },
    },
    {
      id: "activityMinEvents",
      defaultValue: 1,
      unit: null,
      min: 1,
      max: 6,
      reference: null,
      description: { id: "parameter.activityMinEvents" },
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
    const threshold = parameterValue(input.parameters, "activityNdviThreshold", 0.3);
    const dropDelta = parameterValue(input.parameters, "managementDropDelta", 0.15);
    const minEvents = parameterValue(input.parameters, "activityMinEvents", 1);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const values = valuesOf(points, "ndvi");
    const events = detectDrops(points, "ndvi", dropDelta);
    const activeShare = daysAboveThresholdShare(points, "ndvi", threshold);
    const amplitude = maxOf(values) - minOf(values);

    // Corroborazione pluriennale, quando l'archivio c'è: un'annata isolata può
    // ingannare (un anno di riposo non è un abbandono), più annate no.
    const previous = usablePoints(
      pointsInWindow(
        input.series,
        `${input.campaignYear - 1}-01-01`,
        `${input.campaignYear - 1}-12-31`,
      ),
      "ndvi",
      maxCloud,
    );
    const previousEvents =
      previous.length >= 4 ? detectDrops(previous, "ndvi", dropDelta).length : null;
    const factors =
      previousEvents == null ? [] : [archiveDepthFactor(2, 2)];

    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };

    if (events.length >= minEvents) {
      return {
        outcome: "compliant",
        explanation: {
          id: "explain.a1Active",
          values: {
            events: events.length,
            lastEvent: events[events.length - 1].toDate.slice(0, 10),
          },
        },
        factors,
        series,
      };
    }

    // Nessun evento nell'annata. Il profilo piatto e verde è la firma tipica
    // dell'incolto stabilizzato; un profilo che comunque oscilla può nascondere
    // un evento caduto in un buco di osservazione, e merita "attenzione" e non
    // una contestazione.
    const flatAndGreen =
      Number.isFinite(activeShare) &&
      activeShare > 0.8 &&
      Number.isFinite(amplitude) &&
      amplitude < dropDelta;

    if (flatAndGreen && (previousEvents == null || previousEvents === 0)) {
      return {
        outcome: "non_compliant",
        explanation: {
          id: "explain.a1Abandoned",
          values: {
            activeSharePct: Math.round(activeShare * 100),
            amplitude: Number(amplitude.toFixed(2)),
          },
        },
        factors,
        series,
      };
    }

    return {
      outcome: "attention",
      explanation: {
        id: "explain.a1Marginal",
        values: {
          events: events.length,
          minEvents,
          amplitude: Number.isFinite(amplitude) ? Number(amplitude.toFixed(2)) : 0,
        },
      },
      factors,
      series,
    };
  },
};
