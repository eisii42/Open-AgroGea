import type { CheckParameter, CheckSpec, CheckVerdict } from "../check-types";
import {
  daysAboveThresholdShare,
  pointsInWindow,
  usablePoints,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B3 — BCAA 6: copertura minima del suolo nei periodi più sensibili.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 6**: obbligo di copertura minima del
 * suolo per evitare il suolo nudo nei periodi più sensibili. L'obiettivo
 * dichiarato è proteggere il suolo dall'erosione nei mesi in cui piove di più e
 * la vegetazione manca. **Il periodo sensibile lo fissa lo Stato membro** (in
 * Italia il Piano Strategico nazionale e i decreti attuativi; altrove
 * diversamente): per questo le due date NON sono costanti del codice ma
 * parametri, con il valore italiano come default.
 *
 * ## Che cosa si osserva davvero
 *
 * La quota di **giorni** — non di scene — in cui l'NDVI resta sopra una soglia
 * di copertura, dentro la finestra sensibile. Contare le scene falserebbe il
 * conto proprio qui: le nuvole tolgono i giorni piovosi, che sono anche quelli
 * in cui il suolo scoperto fa più danno, e una copertura stimata sulle sole
 * giornate serene sarebbe sistematicamente ottimista. L'interpolazione lineare
 * fra osservazioni consecutive è l'ipotesi minima, ed è dichiarata.
 *
 * ## Il limite da dire, non da nascondere
 *
 * **L'NDVI non distingue una cover crop seminata da un'infestante spontanea.**
 * Entrambe coprono il suolo, ed è vero che ai fini erosivi entrambe proteggono;
 * ma l'obbligo, in molte declinazioni nazionali, richiede una copertura
 * *voluta*. Questa scheda misura la copertura, non l'intenzione: l'esito
 * `compliant` va letto come "il suolo era coperto", non come "la cover crop era
 * quella dichiarata". La verifica dell'intenzione richiede il Quaderno (semina
 * registrata), ed è la scheda C3.
 */

/** Estrae dal parametro MMDD il mese e il giorno (1115 → 15 novembre). */
function monthDay(encoded: number): { month: number; day: number } {
  const value = Math.round(encoded);
  const month = Math.floor(value / 100);
  const day = value % 100;
  return {
    month: Math.min(12, Math.max(1, month)),
    day: Math.min(31, Math.max(1, day)),
  };
}

function isoDay(year: number, encoded: number): string {
  const { month, day } = monthDay(encoded);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Finestra sensibile. Attraversa il capodanno (in Italia 15/11 → 15/02): se la
 * data di fine è "minore" di quella di inizio, la fine cade nell'anno dopo.
 */
function sensitiveWindow(
  campaignYear: number,
  parameters: Readonly<Record<string, CheckParameter>>,
): { from: string; to: string } {
  const start = parameterValue(parameters, "coverWindowStart", 1115);
  const end = parameterValue(parameters, "coverWindowEnd", 215);
  const endYear = end < start ? campaignYear + 1 : campaignYear;
  return { from: isoDay(campaignYear, start), to: isoDay(endYear, end) };
}

export const b3Gaec6SoilCover: CheckSpec = {
  id: "b3_gaec6_soil_cover",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 6 (copertura minima del suolo)",
    // I periodi sensibili sono fissati dagli Stati membri: i default qui sono
    // quelli italiani, e per gli altri paesi la scheda va ridichiarata con le
    // proprie date (o l'utente le corregge dai parametri).
    countries: ["IT"],
    url: null,
  },
  subject: { id: "subject.b3SoilCover" },
  method: { id: "method.b3SoilCover" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    // La finestra sensibile italiana è di tre mesi: con la rivisita di cinque
    // giorni sono ~18 passaggi attesi, e sotto quattro scene utili l'inverno
    // non è raccontabile.
    minUsableScenes: 4,
    declared: [],
  },
  parameters: [
    {
      id: "coverNdviThreshold",
      defaultValue: 0.3,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.coverNdviThreshold" },
    },
    {
      id: "coverMinDaysShare",
      defaultValue: 0.8,
      unit: "quota",
      min: 0.1,
      max: 1,
      reference: null,
      description: { id: "parameter.coverMinDaysShare" },
    },
    {
      id: "coverWindowStart",
      defaultValue: 1115,
      unit: "MMDD",
      min: 101,
      max: 1231,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 6, periodo sensibile fissato dallo Stato membro",
        countries: ["IT"],
        url: null,
      },
      description: { id: "parameter.coverWindowStart" },
    },
    {
      id: "coverWindowEnd",
      defaultValue: 215,
      unit: "MMDD",
      min: 101,
      max: 1231,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 6, periodo sensibile fissato dallo Stato membro",
        countries: ["IT"],
        url: null,
      },
      description: { id: "parameter.coverWindowEnd" },
    },
  ],
  window: (campaignYear, parameters) => sensitiveWindow(campaignYear, parameters),

  run(input): CheckVerdict {
    const window = sensitiveWindow(input.campaignYear, input.parameters);
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const threshold = parameterValue(input.parameters, "coverNdviThreshold", 0.3);
    const minShare = parameterValue(input.parameters, "coverMinDaysShare", 0.8);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const share = daysAboveThresholdShare(points, "ndvi", threshold);
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };

    const sharePct = Number.isFinite(share) ? Math.round(share * 100) : 0;
    const values = {
      sharePct,
      requiredPct: Math.round(minShare * 100),
      threshold,
    };

    if (share >= minShare) {
      return { outcome: "compliant", explanation: { id: "explain.b3Covered", values }, series };
    }
    // Una banda di tolleranza sotto la soglia: fra "coperto quasi sempre" e
    // "suolo nudo" c'è una differenza che l'esito deve conservare, perché la
    // seconda è una contestazione e la prima è un promemoria.
    if (share >= minShare * 0.75) {
      return {
        outcome: "attention",
        explanation: { id: "explain.b3PartiallyCovered", values },
        series,
      };
    }
    return {
      outcome: "non_compliant",
      explanation: { id: "explain.b3Bare", values },
      series,
    };
  },
};
