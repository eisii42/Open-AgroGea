import type { CheckSpec, CheckVerdict } from "../check-types";
import { resolutionFitFactor } from "../confidence";
import {
  calendarYearWindow,
  daysAboveThresholdShare,
  pointsInWindow,
  usablePoints,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * Eco-schemi. Gli esempi qui sono quelli **italiani** (Piano Strategico PAC
 * 2023–2027): il catalogo è per paese, e in un'altra installazione queste
 * schede vanno sostituite con gli eco-schemi di quello Stato membro invece che
 * riusate a forza. È il motivo per cui `reference.countries` dichiara `["IT"]`
 * e il registro le filtra.
 */

/**
 * C1 — Eco-schema 3: inerbimento delle colture arboree.
 *
 * ## Che cosa dice la norma
 *
 * Eco-schema 3 del PSP italiano: mantenimento di una copertura vegetale
 * nell'interfila di oliveti, vigneti e frutteti per una parte definita
 * dell'anno, a fini di protezione del suolo e di biodiversità.
 *
 * ## Che cosa si osserva davvero, e il limite grosso
 *
 * La copertura verde nella finestra richiesta, misurata come quota di giorni
 * sopra soglia. **Il problema è l'interfila.** In un vigneto a 2,5 m di sesto,
 * un pixel da 10 m contiene due o tre filari più altrettante interfile: il
 * valore che si legge è una media di chioma e cotica, e non si può separare
 * l'una dall'altra. Un vigneto vigoroso con interfila nudo può leggere come un
 * vigneto inerbito.
 *
 * La scheda lo dichiara con il fattore `resolution_fit` calcolato sul sesto
 * d'impianto, e il suo esito massimo resta prudente. Su un oliveto a sesto
 * largo (6–8 m) il segnale è più pulito e la scheda vale di più: la differenza
 * si vede nella confidenza, non in una nota a piè di pagina.
 */
export const c1OrchardGroundCover: CheckSpec = {
  id: "c1_orchard_ground_cover",
  group: "ecoSchemes",
  reference: {
    act: "PSP Italia 2023–2027",
    provision: "Eco-schema 3 — inerbimento delle colture arboree",
    countries: ["IT"],
    url: null,
  },
  subject: { id: "subject.c1OrchardGroundCover" },
  method: { id: "method.c1OrchardGroundCover" },
  observability: "low",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 6,
    declared: ["campaign", "crop"],
  },
  parameters: [
    {
      id: "coverNdviThreshold",
      defaultValue: 0.35,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.coverNdviThreshold" },
    },
    {
      id: "coverMinDaysShare",
      defaultValue: 0.7,
      unit: "quota",
      min: 0.1,
      max: 1,
      reference: {
        act: "PSP Italia 2023–2027",
        provision: "Eco-schema 3 — periodo minimo di inerbimento",
        countries: ["IT"],
        url: null,
      },
      description: { id: "parameter.coverMinDaysShare" },
    },
    {
      id: "rowSpacingM",
      defaultValue: 3,
      unit: "m",
      min: 1,
      max: 12,
      reference: null,
      description: { id: "parameter.rowSpacingM" },
    },
  ],
  // Finestra dell'eco-schema italiano: inerbimento richiesto fra la ripresa
  // vegetativa e la fine dell'estate.
  window: (campaignYear) => ({
    from: `${campaignYear}-03-01`,
    to: `${campaignYear}-09-30`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-03-01`,
      to: `${input.campaignYear}-09-30`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const threshold = parameterValue(input.parameters, "coverNdviThreshold", 0.35);
    const minShare = parameterValue(input.parameters, "coverMinDaysShare", 0.7);
    const rowSpacing = parameterValue(input.parameters, "rowSpacingM", 3);

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
    const values = {
      sharePct: Number.isFinite(share) ? Math.round(share * 100) : 0,
      requiredPct: Math.round(minShare * 100),
      rowSpacing,
    };
    // L'interfila è l'oggetto osservato: se è più stretto del pixel, il segnale
    // è una media di chioma e cotica e la confidenza deve dirlo.
    const factors = [resolutionFitFactor(rowSpacing)];

    return share >= minShare
      ? { outcome: "compliant", explanation: { id: "explain.c1Covered", values }, factors, series }
      : { outcome: "attention", explanation: { id: "explain.c1Bare", values }, factors, series };
  },
};

/**
 * C2 — Eco-schema 4: sistemi foraggeri estensivi con avvicendamento di
 * leguminose.
 *
 * ## Che cosa dice la norma
 *
 * Eco-schema 4 del PSP italiano: premio per i sistemi foraggeri estensivi che
 * inseriscono leguminose nell'avvicendamento, senza uso di prodotti
 * fitosanitari nell'anno di impegno.
 *
 * ## Che cosa si osserva davvero
 *
 * La **sequenza colturale dichiarata** (le campagne delle annate precedenti) e,
 * come corroborazione, un profilo NDVI compatibile con un foraggero: copertura
 * prolungata, più sfalci, nessun periodo lungo di suolo nudo.
 *
 * L'assenza di trattamenti fitosanitari si legge dal **Quaderno**, non dal
 * satellite: un trattamento non lascia firma spettrale. È un dato dichiarativo,
 * e come tale viene usato — con l'avvertenza che vale quanto la completezza del
 * registro, che il fattore `declared_data` misura.
 */
export const c2ExtensiveForage: CheckSpec = {
  id: "c2_extensive_forage",
  group: "ecoSchemes",
  reference: {
    act: "PSP Italia 2023–2027",
    provision: "Eco-schema 4 — sistemi foraggeri estensivi con leguminose",
    countries: ["IT"],
    url: null,
  },
  subject: { id: "subject.c2ExtensiveForage" },
  method: { id: "method.c2ExtensiveForage" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 8,
    declared: ["campaign", "crop", "operations"],
  },
  parameters: [
    {
      id: "forageCoverThreshold",
      defaultValue: 0.35,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.forageCoverThreshold" },
    },
    {
      id: "forageMinCoverShare",
      defaultValue: 0.7,
      unit: "quota",
      min: 0.1,
      max: 1,
      reference: null,
      description: { id: "parameter.forageMinCoverShare" },
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
    const threshold = parameterValue(input.parameters, "forageCoverThreshold", 0.35);
    const minShare = parameterValue(input.parameters, "forageMinCoverShare", 0.7);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const share = daysAboveThresholdShare(points, "ndvi", threshold);
    // L'impegno esclude i fitosanitari nell'anno: è un dato del Quaderno.
    const treatments = input.operations.filter(
      (o) =>
        o.operationType === "phytosanitary" &&
        o.executedAt.slice(0, 4) === String(input.campaignYear),
    );
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };
    const values = {
      sharePct: Number.isFinite(share) ? Math.round(share * 100) : 0,
      requiredPct: Math.round(minShare * 100),
      treatments: treatments.length,
    };

    return share >= minShare && treatments.length === 0
      ? { outcome: "compliant", explanation: { id: "explain.c2Compatible", values }, series }
      : { outcome: "attention", explanation: { id: "explain.c2Incompatible", values }, series };
  },
};

/**
 * C3 — Colture intercalari / cover crop fra due colture principali.
 *
 * ## Che cosa dice la norma
 *
 * Eco-schema e impegni agro-climatico-ambientali che premiano la copertura del
 * suolo fra due colture principali, con una permanenza minima in campo. È anche
 * il modo con cui molte aziende assolvono alla BCAA 6 (scheda B3) — ma qui
 * l'obbligo è diverso: non basta che il suolo sia coperto, deve esserci una
 * coltura **seminata** e mantenuta per un periodo minimo.
 *
 * ## Che cosa si osserva davvero
 *
 * Una finestra di NDVI in crescita fra la raccolta della coltura principale e
 * la semina della successiva, con permanenza sopra soglia per un numero minimo
 * di giorni. La differenza con l'infestante spontanea — che la B3 dichiara di
 * non saper fare — qui si recupera in parte dal **Quaderno**: se esiste
 * un'operazione di semina nella finestra, la copertura è voluta. Senza quella
 * registrazione, il satellite da solo non distingue, e la scheda si ferma a
 * "attenzione".
 */
export const c3CatchCrops: CheckSpec = {
  id: "c3_catch_crops",
  group: "ecoSchemes",
  reference: {
    act: "PSP Italia 2023–2027",
    provision: "Colture intercalari / cover crop",
    countries: ["IT"],
    url: null,
  },
  subject: { id: "subject.c3CatchCrops" },
  method: { id: "method.c3CatchCrops" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 5,
    declared: [],
  },
  parameters: [
    {
      id: "catchCropNdviThreshold",
      defaultValue: 0.3,
      unit: "NDVI",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.catchCropNdviThreshold" },
    },
    {
      id: "catchCropMinDays",
      defaultValue: 60,
      unit: "giorni",
      min: 15,
      max: 180,
      reference: {
        act: "PSP Italia 2023–2027",
        provision: "permanenza minima della coltura intercalare",
        countries: ["IT"],
        url: null,
      },
      description: { id: "parameter.catchCropMinDays" },
    },
  ],
  // Fra la raccolta estiva e la semina primaverile successiva.
  window: (campaignYear) => ({
    from: `${campaignYear}-08-01`,
    to: `${campaignYear + 1}-03-31`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-08-01`,
      to: `${input.campaignYear + 1}-03-31`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const threshold = parameterValue(
      input.parameters,
      "catchCropNdviThreshold",
      0.3,
    );
    const minDays = parameterValue(input.parameters, "catchCropMinDays", 60);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const share = daysAboveThresholdShare(points, "ndvi", threshold);
    // Giorni della finestra: agosto → marzo sono circa 243.
    const windowDays =
      (Date.parse(window.to) - Date.parse(window.from)) / 86_400_000;
    const coveredDays = Number.isFinite(share) ? share * windowDays : 0;
    // Il Quaderno recupera in parte ciò che l'NDVI non distingue: una semina
    // registrata nella finestra dice che la copertura era voluta.
    const sowing = input.operations.filter(
      (o) =>
        o.operationType === "sowing" &&
        o.executedAt.slice(0, 10) >= window.from &&
        o.executedAt.slice(0, 10) <= window.to,
    );
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };
    const values = {
      coveredDays: Math.round(coveredDays),
      minDays,
      sowing: sowing.length,
    };

    if (coveredDays < minDays) {
      return { outcome: "attention", explanation: { id: "explain.c3Absent", values }, series };
    }
    return sowing.length > 0
      ? { outcome: "compliant", explanation: { id: "explain.c3Present", values }, series }
      : {
          // Copertura c'è, semina non registrata: l'NDVI non distingue la cover
          // crop dall'infestante, e senza il Quaderno non si conclude.
          outcome: "attention",
          explanation: { id: "explain.c3Present", values },
          series,
        };
  },
};
