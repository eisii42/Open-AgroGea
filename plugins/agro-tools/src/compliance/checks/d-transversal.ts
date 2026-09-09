import type { CheckSpec, CheckVerdict } from "../check-types";
import { daysBetween, resolutionFitFactor } from "../confidence";
import {
  calendarYearWindow,
  detectDrops,
  multiYearWindow,
  pointsInWindow,
  usablePoints,
  valuesOf,
  maxOf,
  minOf,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * D2 — Date di semina e raccolta a confronto con il Quaderno.
 *
 * ## Perché esiste
 *
 * Non c'è un obbligo normativo diretto sulle date: c'è l'obbligo di tenere il
 * Quaderno di Campagna aggiornato e veritiero (D.lgs. 150/2012 e PAN per i
 * fitosanitari; le regole di condizionalità per il resto). Questa scheda serve
 * a scovare le **registrazioni incoerenti o tardive** — la semina annotata a
 * ottobre quando il campo era già verde a settembre, il raccolto registrato con
 * tre settimane di ritardo — prima che lo faccia un controllo.
 *
 * ## Che cosa si osserva davvero
 *
 * La firma fenologica: la semina è il punto in cui l'NDVI comincia a salire
 * stabilmente da valori di suolo nudo; il raccolto è il crollo finale che non
 * risale. Si confrontano con le date registrate nel Quaderno e si misura lo
 * scarto.
 *
 * ## Il limite da dire
 *
 * Fra la semina e l'emergenza passano giorni o settimane a seconda di specie,
 * temperatura e umidità: il satellite vede l'emergenza, non la semina. Lo
 * scarto tollerato di default tiene conto di questo, ed è per questo che si
 * parte da tre settimane e non da tre giorni.
 */
export const d2SowingHarvestDates: CheckSpec = {
  id: "d2_sowing_harvest_dates",
  group: "transversal",
  reference: {
    act: "D.lgs. 150/2012 — PAN",
    provision: "tenuta e veridicità del registro dei trattamenti",
    countries: ["IT"],
    url: null,
  },
  subject: { id: "subject.d2SowingHarvestDates" },
  method: { id: "method.d2SowingHarvestDates" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 10,
    declared: ["operations"],
  },
  parameters: [
    {
      id: "phenologyToleranceDays",
      defaultValue: 21,
      unit: "giorni",
      min: 5,
      max: 90,
      reference: null,
      description: { id: "parameter.phenologyToleranceDays" },
    },
    {
      id: "harvestDropDelta",
      defaultValue: 0.25,
      unit: "NDVI",
      min: 0.1,
      max: 0.6,
      reference: null,
      description: { id: "parameter.harvestDropDelta" },
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
    const tolerance = parameterValue(input.parameters, "phenologyToleranceDays", 21);
    const dropDelta = parameterValue(input.parameters, "harvestDropDelta", 0.25);

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

    const declaredHarvest = input.operations
      .filter(
        (o) =>
          o.operationType === "harvest" &&
          o.executedAt.slice(0, 4) === String(input.campaignYear),
      )
      .map((o) => o.executedAt)
      .sort();
    const observedHarvest = detectDrops(points, "ndvi", dropDelta).at(-1);

    if (declaredHarvest.length === 0 || !observedHarvest) {
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: { id: "missing.operations" },
            where: "logbook",
            howToFix: { id: "missing.operationsFix" },
          },
        ],
        series,
      };
    }

    const gapDays = Math.abs(
      daysBetween(declaredHarvest[declaredHarvest.length - 1], observedHarvest.toDate),
    );
    const values = {
      declared: declaredHarvest[declaredHarvest.length - 1].slice(0, 10),
      observed: observedHarvest.toDate.slice(0, 10),
      gapDays: Math.round(gapDays),
      tolerance,
    };

    return gapDays <= tolerance
      ? { outcome: "compliant", explanation: { id: "explain.d2Consistent", values }, series }
      : { outcome: "attention", explanation: { id: "explain.d2Divergent", values }, series };
  },
};

/**
 * D3 — EUDR: deforestazione, cut-off 31 dicembre 2020.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2023/1115 (EUDR): le materie prime interessate e i prodotti da esse
 * derivati possono essere immessi sul mercato solo se **non hanno causato
 * deforestazione dopo il 31 dicembre 2020**, con obbligo di dichiarazione di
 * due diligence e di geolocalizzazione degli appezzamenti.
 *
 * ## Che cosa aggiunge questa scheda a ciò che già c'era
 *
 * Il modulo aveva già la parte **layer-based**: intersezione con le aree a
 * rischio e generazione del report georeferenziato di due diligence
 * (`due-diligence.ts`, riusato e non duplicato). Qui si aggiunge il confronto
 * con l'**archivio storico**: il livello di NDVI prima del cut-off contro
 * quello dopo. Una copertura arborea rimossa lascia un gradino permanente che
 * l'archivio conserva, e che nessun layer di rischio può raccontare per il
 * singolo appezzamento.
 *
 * ## Il limite, che qui è grosso
 *
 * L'archivio necessario parte dal 2020: sono cinque annate e più, contro i 24
 * mesi della cache locale. Il recupero è quindi **sempre** una richiesta di rete
 * pesante, e il costo va detto all'utente prima di lanciarla. Senza archivio
 * pre-2021 la scheda non conclude — e non deve, perché il cut-off è una data e
 * un confronto senza il "prima" non è un confronto.
 */
export const d3Deforestation: CheckSpec = {
  id: "d3_deforestation",
  group: "transversal",
  reference: {
    act: "Reg. (UE) 2023/1115 (EUDR)",
    provision: "art. 3 — cut-off 31 dicembre 2020",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.d3Deforestation" },
  method: { id: "method.d3Deforestation" },
  observability: "medium",
  requires: {
    indices: ["ndvi"],
    // Dal cut-off a oggi: è molto oltre i 24 mesi della cache locale, e il
    // recupero storico va annunciato prima di partire.
    archiveYears: 6,
    minUsableScenes: 12,
    declared: [],
  },
  parameters: [
    {
      id: "deforestationNdviDrop",
      defaultValue: 0.25,
      unit: "NDVI",
      min: 0.1,
      max: 0.7,
      reference: null,
      description: { id: "parameter.deforestationNdviDrop" },
    },
    {
      id: "cutOffYear",
      defaultValue: 2020,
      unit: null,
      min: 2000,
      max: 2100,
      reference: {
        act: "Reg. (UE) 2023/1115",
        provision: "art. 3 — data di cut-off",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.cutOffYear" },
    },
  ],
  window: (campaignYear) => multiYearWindow(campaignYear, 6),

  run(input): CheckVerdict {
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const dropThreshold = parameterValue(
      input.parameters,
      "deforestationNdviDrop",
      0.25,
    );
    const cutOffYear = parameterValue(input.parameters, "cutOffYear", 2020);

    const before = usablePoints(
      pointsInWindow(input.series, `${cutOffYear - 2}-01-01`, `${cutOffYear}-12-31`),
      "ndvi",
      maxCloud,
    );
    const after = usablePoints(
      pointsInWindow(
        input.series,
        `${cutOffYear + 1}-01-01`,
        `${input.campaignYear}-12-31`,
      ),
      "ndvi",
      maxCloud,
    );
    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: `${cutOffYear - 2}-01-01`,
      to: `${input.campaignYear}-12-31`,
      points: [...before, ...after],
    };

    if (before.length < 4 || after.length < 4) {
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: {
              id: "missing.archiveTooShort",
              values: { available: before.length, required: 4 },
            },
            where: "archive",
            howToFix: { id: "missing.archiveTooShortFix", values: { required: 4 } },
          },
        ],
        series,
      };
    }

    // Il confronto è fra i MASSIMI stagionali: una copertura arborea ha un
    // massimo alto e stabile, e la sua rimozione lo abbassa in modo permanente.
    // I minimi no: variano con la stagione anche su un bosco intatto.
    const maxBefore = maxOf(valuesOf(before, "ndvi"));
    const maxAfter = maxOf(valuesOf(after, "ndvi"));
    const delta = maxBefore - maxAfter;
    const values = {
      cutOffYear,
      maxBefore: Number(maxBefore.toFixed(2)),
      maxAfter: Number(maxAfter.toFixed(2)),
      delta: Number(delta.toFixed(2)),
      threshold: dropThreshold,
      inRiskLayer: input.layers.intersects.includes("deforestation") ? 1 : 0,
    };

    return delta >= dropThreshold
      ? {
          outcome: "attention",
          explanation: { id: "explain.d3ChangeAfterCutoff", values },
          series,
        }
      : { outcome: "compliant", explanation: { id: "explain.d3NoChange", values }, series };
  },
};

/**
 * D4 — Irrigazione.
 *
 * ## Perché la scheda esiste pur non potendo concludere quasi mai
 *
 * L'irrigazione entra in obblighi e impegni concreti: autorizzazioni al
 * prelievo, misurazione dei volumi (Reg. (UE) 1305/2013 art. 46 per gli
 * investimenti irrigui), impegni di riduzione. Un utente si aspetta quindi di
 * trovarla nell'elenco — e non trovarla lo lascerebbe con il dubbio che il
 * modulo se ne sia dimenticato.
 *
 * ## Che cosa servirebbe davvero, e perché l'ottico non basta
 *
 * L'acqua distribuita non si vede nell'ottico. Un campo irrigato è più verde di
 * uno non irrigato **solo se quello non irrigato è in stress**, e in
 * un'annata piovosa la differenza sparisce del tutto. Gli approcci che
 * funzionano usano altro:
 *   * **SAR** (Sentinel-1): la retrodiffusione in banda C risponde all'umidità
 *     dei primi centimetri di suolo, e un'irrigazione la fa saltare;
 *   * **termico** (Landsat 8/9 TIRS, ECOSTRESS): la temperatura superficiale
 *     cala dopo un adacquamento, ed è la base del bilancio energetico.
 *
 * Nessuno dei due è nella pipeline, che è ottica multispettrale. La scheda
 * dichiara quindi "non decidibile" e dice **che cosa** servirebbe. È una
 * dichiarazione di limite, ed è più utile di un'inferenza fragile presentata
 * come risultato: un falso "irriguo" su una domanda di premio è un danno vero.
 *
 * ## Che cosa fa comunque
 *
 * Riporta ciò che il **Quaderno** dichiara — quante irrigazioni sono state
 * registrate e per quanti millimetri — così il confronto con l'obbligo lo può
 * fare l'agricoltore con i suoi dati, che su questo sono migliori dei nostri.
 */
export const d4Irrigation: CheckSpec = {
  id: "d4_irrigation",
  group: "transversal",
  reference: {
    act: "Reg. (UE) 1305/2013",
    provision: "art. 46 — investimenti irrigui e misurazione dei volumi",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.d4Irrigation" },
  method: { id: "method.d4Irrigation" },
  observability: "low",
  requires: {
    indices: ["ndmi"],
    archiveYears: 1,
    minUsableScenes: 6,
    declared: [],
  },
  parameters: [],
  window: (campaignYear) => ({
    from: `${campaignYear}-05-01`,
    to: `${campaignYear}-09-30`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-05-01`,
      to: `${input.campaignYear}-09-30`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndmi",
      maxCloud,
    );
    const irrigations = input.operations.filter(
      (o) =>
        o.operationType === "irrigation" &&
        o.executedAt.slice(0, 4) === String(input.campaignYear),
    );
    const values = {
      declaredEvents: irrigations.length,
      ndmiRange: Number(
        (maxOf(valuesOf(points, "ndmi")) - minOf(valuesOf(points, "ndmi"))).toFixed(2),
      ),
    };

    return {
      outcome: "undecidable",
      explanation: { id: "explain.d4NotObservable", values },
      // La risoluzione non c'entra: qui manca proprio il sensore adatto, e il
      // fattore lo dice al posto di far credere a un problema di pixel.
      factors: [resolutionFitFactor(0, 10)],
      missing: [
        {
          what: { id: "missing.sensorNotAvailable" },
          where: "pipeline",
          howToFix: { id: "missing.sensorNotAvailableFix" },
        },
      ],
      series: {
        plotId: input.plot.id,
        index: "ndmi",
        from: window.from,
        to: window.to,
        points,
      },
    };
  },
};
