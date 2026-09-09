import type { CheckSpec, CheckVerdict } from "../check-types";
import { maxGapDays, temporalGapFactor } from "../confidence";
import { dropsWithRecovery, pointsInWindow, usablePoints } from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * D1 — Eventi di sfalcio o pascolamento su prato permanente.
 *
 * ## Che cosa dice la norma
 *
 * Il prato permanente resta ammissibile se vi si svolge l'**attività agricola
 * minima** (Reg. (UE) 2021/2115, art. 4): sfalcio o pascolamento almeno una
 * volta l'anno, secondo la declinazione nazionale. È la verifica che l'AMS fa
 * più spesso sui prati, perché è quella che si vede meglio da satellite.
 *
 * ## Che cosa si osserva davvero
 *
 * Un calo brusco di NDVI **seguito da ricrescita**. La ricrescita è la parte che
 * fa la differenza fra questa scheda e la B6: uno sfalcio toglie la biomassa e
 * la cotica torna, un cambio d'uso (aratura, conversione a seminativo) no. Un
 * calo senza ricrescita, su un prato dichiarato, non è uno sfalcio: è
 * potenzialmente una conversione, e appartiene alla B6.
 *
 * Il pascolamento è più insidioso: il carico animale abbassa la biomassa in modo
 * graduale e non produce sempre il gradino netto di una barra falciante. Un
 * pascolo estensivo può quindi risultare "nessun evento" pur essendo
 * perfettamente gestito — motivo per cui l'assenza di eventi qui vale
 * `attention` e non `non_compliant`.
 *
 * ## Il limite da dire
 *
 * Uno sfalcio dura pochi giorni nel segnale: con la rivisita di cinque giorni e
 * il cielo coperto, un evento può cadere per intero dentro un buco di
 * osservazione. Per questo la scheda pesa il fattore `temporal_gap` più delle
 * altre — un buco largo è, qui, la fonte di errore dominante.
 */
export const d1MowingGrazing: CheckSpec = {
  id: "d1_mowing_grazing",
  group: "transversal",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "art. 4 — attività agricola minima sui prati permanenti",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.d1MowingGrazing" },
  method: { id: "method.d1MowingGrazing" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    // Sotto otto passaggi utili in una stagione vegetativa un evento di pochi
    // giorni ha una probabilità concreta di non comparire affatto.
    minUsableScenes: 8,
    declared: [],
  },
  parameters: [
    {
      id: "mowingDropDelta",
      defaultValue: 0.15,
      unit: "NDVI",
      min: 0.05,
      max: 0.5,
      reference: null,
      description: { id: "parameter.mowingDropDelta" },
    },
    {
      id: "mowingMinEvents",
      defaultValue: 1,
      unit: null,
      min: 1,
      max: 6,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "art. 4 — frequenza minima fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.mowingMinEvents" },
    },
    {
      id: "mowingRecoveryDays",
      defaultValue: 45,
      unit: "giorni",
      min: 10,
      max: 120,
      reference: null,
      description: { id: "parameter.mowingRecoveryDays" },
    },
  ],
  // Stagione vegetativa: fuori da marzo–ottobre un calo di NDVI su un prato
  // racconta la stagione, non una lavorazione.
  window: (campaignYear) => ({
    from: `${campaignYear}-03-01`,
    to: `${campaignYear}-10-31`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-03-01`,
      to: `${input.campaignYear}-10-31`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const dropDelta = parameterValue(input.parameters, "mowingDropDelta", 0.15);
    const minEvents = parameterValue(input.parameters, "mowingMinEvents", 1);
    const recoveryDays = parameterValue(input.parameters, "mowingRecoveryDays", 45);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const events = dropsWithRecovery(points, "ndvi", dropDelta, recoveryDays);
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };
    // Peso doppio al buco temporale: qui è la fonte di errore dominante, e
    // annegarlo nella media lo renderebbe invisibile proprio dove conta.
    const factors = [temporalGapFactor(maxGapDays(points), 12, 2)];

    if (events.length >= minEvents) {
      return {
        outcome: "compliant",
        explanation: {
          id: "explain.d1Events",
          values: {
            events: events.length,
            dates: events.map((e) => e.toDate.slice(0, 10)).join(", "),
          },
        },
        factors,
        series,
      };
    }
    return {
      outcome: "attention",
      explanation: {
        id: "explain.d1NoEvents",
        values: { events: events.length, minEvents },
      },
      factors,
      series,
    };
  },
};
