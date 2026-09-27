import type { CheckSpec, CheckVerdict, MissingInput } from "../check-types";
import { calendarYearWindow } from "../series";
import { parameterValue } from "../runner";
import {
  COPPER_LIMIT_KG_HA,
  COPPER_WINDOW_YEARS,
  CONVERSION_MONTHS,
  NITROGEN_LIMIT_KG_HA,
  assessOrganic,
} from "../organic/organic-engine";

/**
 * Scheda "Mezzi tecnici in biologico". A differenza di tutte le altre **non
 * osserva il satellite**: legge il Quaderno di Campagna e i lotti realmente
 * scaricati dal magazzino.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2018/848 (produzione biologica) e Reg. (UE) 2021/1165 (elenchi dei
 * mezzi tecnici ammessi, Allegati I e II), più il massimale di azoto della
 * Direttiva 91/676/CEE. Le condizioni d'uso — su tutte il rame, 28 kg/ha in
 * 7 anni — stanno negli allegati e qui sono **parametri**, non costanti.
 *
 * ## Perché non è satellitare, e perché va detto
 *
 * Un campo biologico e uno convenzionale hanno lo stesso aspetto spettrale. La
 * quasi totalità delle non conformità biologiche non lascia firma osservabile a
 * 10 m di risoluzione: si verificano dai registri. Mettere questa scheda
 * accanto alle altre, con la stessa busta di provenienza e lo stesso
 * disclaimer, serve proprio a rendere evidente che la fonte è diversa — le
 * "scene usate" qui sono zero, e chi legge l'export lo vede.
 *
 * ## Che cosa NON dice
 *
 * Non sostituisce l'organismo di controllo, e non certifica nulla. Dice che
 * cosa risulta dai registri dell'azienda, letto contro una versione datata
 * degli allegati — e quando i registri non bastano, dice che non bastano.
 */
export const organicInputsCheck: CheckSpec = {
  id: "organic_inputs",
  group: "organic",
  reference: {
    act: "Reg. (UE) 2018/848 — Reg. (UE) 2021/1165",
    provision: "Allegati I e II (mezzi tecnici ammessi)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.organicInputs" },
  method: { id: "method.organicInputs" },
  observability: "high",
  requires: {
    // Nessun indice: la scheda non guarda il cielo, e il runner salta di
    // conseguenza i presupposti satellitari (scene, nuvole, pixel puri).
    indices: [],
    archiveYears: 1,
    minUsableScenes: 0,
    declared: ["campaign", "productionRegime", "operations"],
  },
  parameters: [
    {
      id: "copperLimitKgHa",
      defaultValue: COPPER_LIMIT_KG_HA,
      unit: "kg/ha",
      min: 1,
      max: 60,
      reference: {
        act: "Reg. (UE) 2021/1165",
        provision: "All. II — composti del rame, 28 kg/ha in 7 anni",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.copperLimitKgHa" },
    },
    {
      id: "copperWindowYears",
      defaultValue: COPPER_WINDOW_YEARS,
      unit: "anni",
      min: 1,
      max: 10,
      reference: {
        act: "Reg. (UE) 2021/1165",
        provision: "All. II — finestra mobile del massimale di rame",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.copperWindowYears" },
    },
    {
      id: "nitrogenLimitKgHa",
      defaultValue: NITROGEN_LIMIT_KG_HA,
      unit: "kg N/ha",
      min: 50,
      max: 400,
      reference: {
        act: "Direttiva 91/676/CEE",
        provision: "Direttiva Nitrati — 170 kg N/ha/anno da effluenti",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.nitrogenLimitKgHa" },
    },
    {
      id: "conversionMonthsAnnual",
      defaultValue: CONVERSION_MONTHS.annual,
      unit: "mesi",
      min: 6,
      max: 60,
      reference: {
        act: "Reg. (UE) 2018/848",
        provision: "All. II parte I punto 1.7 — colture annuali",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.conversionMonthsAnnual" },
    },
    {
      id: "conversionMonthsPerennial",
      defaultValue: CONVERSION_MONTHS.perennial,
      unit: "mesi",
      min: 6,
      max: 72,
      reference: {
        act: "Reg. (UE) 2018/848",
        provision: "All. II parte I punto 1.7 — colture perenni",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.conversionMonthsPerennial" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const campaign =
      input.campaigns.find((c) => c.campaignYear === input.campaignYear) ?? null;

    // La scheda si applica solo a ciò che è dichiarato biologico o in
    // conversione: su un convenzionale non avrebbe senso, e dare un "conforme"
    // sarebbe un'informazione falsa per omissione.
    const regime = campaign?.productionRegime ?? null;
    if (regime !== "organic" && regime !== "in_conversion") {
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: { id: "missing.productionRegime" },
            where: "campaign",
            howToFix: { id: "missing.productionRegimeFix" },
          },
        ],
      };
    }

    const perennialCategories = new Set([
      "viticoltura",
      "olivicoltura",
      "frutticoltura",
    ]);
    const assessment = assessOrganic({
      plotId: input.plot.id,
      campaignYear: input.campaignYear,
      areaHa: campaign?.declaredAreaHa || input.plot.areaHa,
      operations: input.operations,
      campaign,
      perennial: perennialCategories.has(campaign?.cropCategory ?? ""),
      now: input.now,
      limits: {
        copperKgHa: parameterValue(input.parameters, "copperLimitKgHa", COPPER_LIMIT_KG_HA),
        copperWindowYears: parameterValue(
          input.parameters,
          "copperWindowYears",
          COPPER_WINDOW_YEARS,
        ),
        nitrogenKgHa: parameterValue(
          input.parameters,
          "nitrogenLimitKgHa",
          NITROGEN_LIMIT_KG_HA,
        ),
        conversionMonthsAnnual: parameterValue(
          input.parameters,
          "conversionMonthsAnnual",
          CONVERSION_MONTHS.annual,
        ),
        conversionMonthsPerennial: parameterValue(
          input.parameters,
          "conversionMonthsPerennial",
          CONVERSION_MONTHS.perennial,
        ),
      },
    });

    const notAllowed = assessment.operations.filter((o) => o.verdict === "not_allowed");
    const unknown = assessment.operations.filter((o) => o.verdict === "unknown_substance");
    const overLimit =
      assessment.copper.status === "over" || assessment.nitrogen.status === "over";
    const nearLimit =
      assessment.copper.status === "near" || assessment.nitrogen.status === "near";
    const undecidableLimit =
      assessment.copper.status === "undecidable" ||
      assessment.nitrogen.status === "undecidable";

    // I dati mancanti si dichiarano SEMPRE, anche quando l'esito è già deciso
    // da un superamento: sapere che tre operazioni non erano conteggiabili
    // cambia il modo in cui si legge il numero.
    const missing: MissingInput[] = [];
    for (const finding of [
      ...assessment.copper.uncountable,
      ...assessment.nitrogen.uncountable,
    ]) {
      missing.push({
        what: finding.message,
        where: "products",
        howToFix: {
          id:
            finding.message.id === "missing.nitrogenContent"
              ? "missing.nitrogenContentFix"
              : "missing.copperContentFix",
        },
      });
    }
    if (assessment.conversion.status === "unknown") {
      missing.push({
        what: { id: "missing.regimeSince" },
        where: "campaign",
        howToFix: { id: "missing.regimeSinceFix" },
      });
    }
    for (const operation of assessment.incomplete) {
      missing.push({
        what: { id: "organic.incompleteOperations", values: { id: operation.operationId } },
        where: "logbook",
        howToFix: { id: "missing.operationsFix" },
      });
    }

    const values = {
      operations: assessment.operations.length,
      notAllowed: notAllowed.length,
      unknown: unknown.length,
      copper: assessment.copper.value ?? 0,
      copperLimit: assessment.copper.limit,
      nitrogen: assessment.nitrogen.value ?? 0,
      nitrogenLimit: assessment.nitrogen.limit,
      act: assessment.reference.act,
      version: assessment.reference.version,
    };

    if (notAllowed.length > 0 || overLimit) {
      return {
        outcome: "non_compliant",
        explanation: { id: "explain.organicNonCompliant", values },
        missing,
      };
    }
    // Una sostanza sconosciuta o un massimale non calcolabile NON producono un
    // "conforme": l'elenco è parziale e il dato manca, e nessuna delle due cose
    // è una prova di conformità.
    if (unknown.length > 0 || undecidableLimit || nearLimit || missing.length > 0) {
      return {
        outcome: "attention",
        explanation: { id: "explain.organicAttention", values },
        missing,
      };
    }
    return {
      outcome: "compliant",
      explanation: { id: "explain.organicCompliant", values },
      missing,
    };
  },
};
