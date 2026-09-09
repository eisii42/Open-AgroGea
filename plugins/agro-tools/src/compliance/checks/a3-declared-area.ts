import type { CheckSpec, CheckVerdict } from "../check-types";
import { purePixelEstimate, resolutionFitFactor } from "../confidence";
import {
  calendarYearWindow,
  daysAboveThresholdShare,
  pointsInWindow,
  usablePoints,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * A3 — Superficie coltivata rispetto a quella dichiarata.
 *
 * ## Che cosa dice la norma
 *
 * La superficie dichiarata nella domanda unica deve corrispondere a quella
 * effettivamente ammissibile (Reg. (UE) 2021/2116, artt. 66 e 59): la
 * sovradichiarazione è la fattispecie che genera le riduzioni e le sanzioni più
 * frequenti.
 *
 * ## Che cosa si osserva davvero
 *
 * Due confronti distinti, con affidabilità molto diverse, e la scheda li tiene
 * separati invece di fonderli in un numero solo:
 *
 * 1. **geometrico** — `declared_area_ha` contro l'area geodetica del poligono
 *    (`area_ha`, calcolata dal DAL con `@turf/area`). È un confronto esatto,
 *    non un'osservazione: se le due superfici divergono oltre la tolleranza, il
 *    problema è nella dichiarazione o nel disegno, e si vede subito;
 * 2. **vegetato** — quanta parte della superficie mostra vegetazione nella
 *    stagione. Qui l'affidabilità cala: i pixel di bordo mescolano il campo con
 *    ciò che gli sta intorno, e su un appezzamento stretto e lungo il bordo è
 *    quasi tutto. Il confronto vegetato entra quindi come segnale di
 *    ATTENZIONE, mai come contestazione.
 *
 * ## Il limite da dire
 *
 * La quota vegetata è stimata dai pixel puri, che su una parcella piccola sono
 * pochi e su una allungata pochissimi: la stima resta indicativa, e la scheda
 * lo dichiara con il fattore `resolution_fit` invece di nasconderlo dietro un
 * decimale in più.
 */
export const a3DeclaredArea: CheckSpec = {
  id: "a3_declared_area",
  group: "eligibility",
  reference: {
    act: "Reg. (UE) 2021/2116",
    provision: "artt. 59 e 66 — superficie ammissibile dichiarata",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.a3DeclaredArea" },
  method: { id: "method.a3DeclaredArea" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 5,
    declared: ["campaign", "declaredArea"],
  },
  parameters: [
    {
      id: "areaTolerancePct",
      defaultValue: 3,
      unit: "%",
      min: 0.5,
      max: 20,
      reference: {
        act: "Reg. (UE) 2021/2116",
        provision: "tolleranza tecnica di misurazione fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.areaTolerancePct" },
    },
    {
      id: "vegetatedNdviThreshold",
      defaultValue: 0.3,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.vegetatedNdviThreshold" },
    },
  ],
  window: (campaignYear) => ({
    from: `${campaignYear}-04-01`,
    to: `${campaignYear}-09-30`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-04-01`,
      to: `${input.campaignYear}-09-30`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const tolerancePct = parameterValue(input.parameters, "areaTolerancePct", 3);
    const vegetatedThreshold = parameterValue(
      input.parameters,
      "vegetatedNdviThreshold",
      0.3,
    );
    const campaign = input.campaigns.find(
      (c) => c.campaignYear === input.campaignYear,
    );
    const declared = campaign?.declaredAreaHa ?? 0;
    const geometric = input.plot.areaHa;

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const vegetatedShare = daysAboveThresholdShare(points, "ndvi", vegetatedThreshold);
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };

    const deltaPct =
      geometric > 0 ? ((declared - geometric) / geometric) * 100 : 0;
    const values = {
      declared: Number(declared.toFixed(4)),
      geometric: Number(geometric.toFixed(4)),
      deltaPct: Number(deltaPct.toFixed(1)),
      tolerancePct,
      vegetatedSharePct: Number.isFinite(vegetatedShare)
        ? Math.round(vegetatedShare * 100)
        : 0,
      purePixels: purePixelEstimate(geometric),
    };
    // Su una parcella piccola il bordo è quasi tutto: il fattore lo dice invece
    // di lasciarlo intuire dal decimale.
    const factors = [resolutionFitFactor(Math.sqrt(geometric * 10_000))];

    // 1. Confronto geometrico: è esatto, e viene per primo.
    if (deltaPct > tolerancePct) {
      return {
        outcome: "non_compliant",
        explanation: { id: "explain.a3Overdeclared", values },
        factors,
        series,
      };
    }
    // 2. Confronto vegetato: indicativo, quindi al massimo "attenzione".
    if (Number.isFinite(vegetatedShare) && vegetatedShare < 0.5) {
      return {
        outcome: "attention",
        explanation: { id: "explain.a3VegetatedShortfall", values },
        factors,
        series,
      };
    }
    return {
      outcome: "compliant",
      explanation: { id: "explain.a3Consistent", values },
      factors,
      series,
    };
  },
};
