import type {
  ComplianceMessage,
  DeclaredCampaign,
  DeclaredIssue,
  DeclaredOperation,
} from "../check-types";
import {
  ORGANIC_INPUT_REFERENCE,
  lookupSubstance,
  type SubstanceReference,
} from "./substances";

/**
 * Motore del BIOLOGICO. Non guarda il cielo: guarda che cosa è stato
 * distribuito in campo.
 *
 * ## Perché il biologico non si verifica da satellite
 *
 * Un appezzamento biologico e uno convenzionale hanno lo stesso aspetto
 * spettrale. Un diserbo chimico si vede (la vegetazione muore), ma è
 * l'eccezione: la stragrande maggioranza delle non conformità biologiche —
 * un principio attivo non ammesso, il rame oltre il massimale, l'azoto oltre i
 * 170 kg/ha — non lascia alcuna firma osservabile da 10 metri di risoluzione.
 * Si verificano dai REGISTRI, ed è quello che questo motore fa.
 *
 * ## Da dove vengono i numeri
 *
 * Dalle quantità REALMENTE scaricate dal magazzino
 * (`activity_products` → {@link DeclaredIssue}), non da quelle pianificate: è
 * la differenza fra ciò che si è deciso di fare e ciò che è stato fatto.
 * Quando l'operazione non ha lotti collegati si ricade sul testo libero del
 * Quaderno, e lo si dichiara — perché una dose scritta a mano non è una
 * quantità tracciata.
 *
 * ## Le tre regole di onestà
 *
 * 1. **Una sostanza sconosciuta non è una sostanza vietata.** L'elenco di
 *    riferimento è dichiaratamente parziale: ciò che non vi compare produce
 *    "non decidibile", non "non conforme".
 * 2. **Un dato mancante non produce un verdetto.** Senza il titolo di rame del
 *    prodotto non si converte la dose in rame metallo: si dice quale dato
 *    aggiungere e dove.
 * 3. **Le operazioni incomplete si elencano come tali**, e non contano né come
 *    conformi né come non conformi.
 */

/** Limite di rame metallo: 28 kg/ha in 7 anni (Reg. (UE) 2021/1165, All. II). */
export const COPPER_LIMIT_KG_HA = 28;

/** Finestra mobile del massimale di rame, in anni. */
export const COPPER_WINDOW_YEARS = 7;

/**
 * Massimale di azoto da effluenti/fertilizzanti organici: 170 kg N/ha/anno
 * (Direttiva 91/676/CEE, Direttiva Nitrati). Unica definizione del repository:
 * `geo-compliance.ts` la ri-esporta come `NITROGEN_MAX_ZVN_KG_HA`.
 */
export const NITROGEN_LIMIT_KG_HA = 170;

/**
 * Durata della conversione al biologico (Reg. (UE) 2018/848, All. II parte I
 * punto 1.7): 24 mesi prima della semina per le annuali, 36 mesi prima del
 * raccolto per le perenni.
 *
 * Nel motore questi due numeri sono **parametri** della scheda, non costanti:
 * qui vivono solo come default. `@agrogea/core` espone gli stessi valori come
 * `ORGANIC_CONVERSION_MONTHS` per gli usi di dominio (etichette, promemoria):
 * i due punti sono allineati di proposito e documentati come tali.
 */
export const CONVERSION_MONTHS = { annual: 24, perennial: 36 } as const;

/** Che cosa il motore ha potuto dire di una singola operazione. */
export type OperationVerdict =
  | "allowed"
  | "not_allowed"
  | "unknown_substance"
  | "incomplete";

export interface OperationFinding {
  operationId: string;
  executedAt: string;
  /** Nome con cui la sostanza compare nel Quaderno o nel lotto. */
  declaredName: string;
  verdict: OperationVerdict;
  /** Voce dell'elenco che l'ha ammessa, quando trovata. */
  matchedSubstance: string | null;
  /** Condizione d'uso dichiarata dall'atto, da mostrare accanto all'esito. */
  restriction: string | null;
  message: ComplianceMessage;
}

/** Esito di un massimale quantitativo (rame, azoto). */
export interface LimitFinding {
  /** Quantità imputata, nell'unità del massimale. */
  value: number | null;
  limit: number;
  unit: string;
  /** `null` = non calcolabile: manca il dato, e si dice quale. */
  status: "within" | "near" | "over" | "undecidable";
  message: ComplianceMessage;
  /** Operazioni che non è stato possibile conteggiare, con il motivo. */
  uncountable: readonly OperationFinding[];
}

/** Stato della conversione al biologico alla data osservata. */
export interface ConversionFinding {
  status: "complete" | "ongoing" | "unknown";
  /** Fine del periodo di conversione (`YYYY-MM-DD`), se calcolabile. */
  endsOn: string | null;
  message: ComplianceMessage;
}

export interface OrganicAssessment {
  plotId: string;
  campaignYear: number;
  /** Atto e versione dell'elenco usato: l'esito non vale senza. */
  reference: { act: string; version: string; partial: boolean };
  operations: readonly OperationFinding[];
  copper: LimitFinding;
  nitrogen: LimitFinding;
  conversion: ConversionFinding;
  /** Operazioni prive dei dati necessari: né conformi né non conformi. */
  incomplete: readonly OperationFinding[];
}

export interface OrganicAssessmentInput {
  plotId: string;
  campaignYear: number;
  /** Superficie su cui si rapportano i massimali (ettari). */
  areaHa: number;
  operations: readonly DeclaredOperation[];
  campaign: DeclaredCampaign | null;
  /** La coltura è perenne? Governa 24 vs 36 mesi di conversione. */
  perennial: boolean;
  /** Data di riferimento (iniettata: il motore non legge l'orologio). */
  now: string;
  reference?: SubstanceReference;
  limits?: {
    copperKgHa?: number;
    copperWindowYears?: number;
    nitrogenKgHa?: number;
    conversionMonthsAnnual?: number;
    conversionMonthsPerennial?: number;
  };
}

/** Somma i mesi a un giorno ISO, in UTC (i giorni ISO non hanno fuso). */
export function addMonths(isoDay: string, months: number): string | null {
  const [year, month, day] = isoDay.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

/** Le operazioni che distribuiscono qualcosa sul campo. */
const INPUT_OPERATIONS = new Set(["phytosanitary", "fertilization"]);

/** Nome con cui la sostanza è identificabile: prima il lotto, poi il Quaderno. */
function substanceNameOf(
  operation: DeclaredOperation,
  issue: DeclaredIssue | null,
): string {
  return (
    issue?.activeSubstance ??
    operation.activeSubstance ??
    issue?.productName ??
    operation.productName ??
    operation.fertilizerType ??
    ""
  );
}

/**
 * Verifica una per una le sostanze distribuite. Un'operazione senza alcuna
 * sostanza identificabile è INCOMPLETA: non si può dire nulla di ciò che non è
 * stato scritto, e fingere di poterlo dire sarebbe il difetto peggiore.
 */
export function assessSubstances(
  operations: readonly DeclaredOperation[],
  reference: SubstanceReference = ORGANIC_INPUT_REFERENCE,
): OperationFinding[] {
  const findings: OperationFinding[] = [];
  for (const operation of operations) {
    if (!INPUT_OPERATIONS.has(operation.operationType)) continue;
    // Un'operazione può aver scaricato più lotti: ognuno è una sostanza.
    const targets: (DeclaredIssue | null)[] =
      operation.issues.length > 0 ? [...operation.issues] : [null];
    for (const issue of targets) {
      const declaredName = substanceNameOf(operation, issue).trim();
      if (!declaredName) {
        findings.push({
          operationId: operation.id,
          executedAt: operation.executedAt,
          declaredName: "",
          verdict: "incomplete",
          matchedSubstance: null,
          restriction: null,
          message: { id: "organic.incompleteOperations" },
        });
        continue;
      }
      const { entry, unknown } = lookupSubstance(declaredName, reference);
      if (unknown) {
        // L'elenco è parziale: l'assenza è nostra, non dell'agricoltore.
        findings.push({
          operationId: operation.id,
          executedAt: operation.executedAt,
          declaredName,
          verdict: "unknown_substance",
          matchedSubstance: null,
          restriction: null,
          message: {
            id: "organic.substanceUnknown",
            values: { substance: declaredName, act: reference.act },
          },
        });
        continue;
      }
      const prohibited = entry?.status === "prohibited";
      findings.push({
        operationId: operation.id,
        executedAt: operation.executedAt,
        declaredName,
        verdict: prohibited ? "not_allowed" : "allowed",
        matchedSubstance: entry?.substance ?? null,
        restriction: entry?.restriction ?? null,
        message: {
          id: prohibited ? "organic.substanceNotAllowed" : "organic.substanceAllowed",
          values: {
            substance: entry?.substance ?? declaredName,
            annex: entry?.annex ?? "",
          },
        },
      });
    }
  }
  return findings;
}

/**
 * Rame metallo distribuito nella finestra mobile, in kg/ha.
 *
 * La conversione dose → rame metallo richiede il **titolo di rame** del
 * prodotto (`products.metadata.copper_content_pct`). Senza, la quantità di
 * formulato non dice nulla: 5 kg di un prodotto al 20% e 5 kg di uno al 50%
 * sono 1 kg e 2,5 kg di rame. Quando il titolo manca, l'operazione finisce fra
 * le non conteggiabili e l'esito è "non decidibile" — mai una somma parziale
 * spacciata per totale.
 */
export function assessCopper(
  input: OrganicAssessmentInput,
): LimitFinding {
  const limit = input.limits?.copperKgHa ?? COPPER_LIMIT_KG_HA;
  const years = input.limits?.copperWindowYears ?? COPPER_WINDOW_YEARS;
  const unit = "kg/ha";
  const from = `${input.campaignYear - years + 1}-01-01`;
  const to = `${input.campaignYear}-12-31`;

  let copperKg = 0;
  let counted = 0;
  const uncountable: OperationFinding[] = [];

  for (const operation of input.operations) {
    if (operation.operationType !== "phytosanitary") continue;
    const day = operation.executedAt.slice(0, 10);
    if (day < from || day > to) continue;

    const targets: (DeclaredIssue | null)[] =
      operation.issues.length > 0 ? [...operation.issues] : [null];
    for (const issue of targets) {
      const name = substanceNameOf(operation, issue);
      const { entry } = lookupSubstance(name, input.reference);
      const isCopper = entry?.substance === "Composti del rame";
      if (!isCopper) continue;

      const titre = issue?.copperContentPct ?? null;
      const quantity = issue?.quantity ?? operation.totalQuantity ?? null;
      if (titre == null || quantity == null || !Number.isFinite(quantity)) {
        uncountable.push({
          operationId: operation.id,
          executedAt: operation.executedAt,
          declaredName: name,
          verdict: "incomplete",
          matchedSubstance: "Composti del rame",
          restriction: entry?.restriction ?? null,
          message: {
            id: titre == null ? "missing.copperContent" : "organic.incompleteOperations",
            values: { product: issue?.productName ?? operation.productName ?? "" },
          },
        });
        continue;
      }
      copperKg += (quantity * titre) / 100;
      counted += 1;
    }
  }

  if (uncountable.length > 0) {
    return {
      value: null,
      limit,
      unit,
      status: "undecidable",
      message: {
        id: "organic.copperUndecidable",
        values: { uncountable: uncountable.length, years },
      },
      uncountable,
    };
  }
  if (counted === 0) {
    return {
      value: 0,
      limit,
      unit,
      status: "within",
      message: { id: "organic.copperWithinLimit", values: { value: 0, limit, years } },
      uncountable: [],
    };
  }

  const perHa =
    input.areaHa > 0 ? copperKg / input.areaHa : Number.POSITIVE_INFINITY;
  const rounded = Number(perHa.toFixed(2));
  const status = perHa > limit ? "over" : perHa > limit * 0.8 ? "near" : "within";
  return {
    value: rounded,
    limit,
    unit,
    status,
    message: {
      id:
        status === "over"
          ? "organic.copperOverLimit"
          : status === "near"
            ? "organic.copperNearLimit"
            : "organic.copperWithinLimit",
      values: { value: rounded, limit, years },
    },
    uncountable: [],
  };
}

/**
 * Azoto da fertilizzanti organici nell'annata, in kg N/ha (massimale 170,
 * Direttiva Nitrati). Il titolo di azoto viene dal lotto (titoli N-P-K del
 * prodotto) o, in mancanza, dal `npk_ratio` scritto a mano nel Quaderno.
 */
export function assessNitrogen(input: OrganicAssessmentInput): LimitFinding {
  const limit = input.limits?.nitrogenKgHa ?? NITROGEN_LIMIT_KG_HA;
  const unit = "kg N/ha";
  const from = `${input.campaignYear}-01-01`;
  const to = `${input.campaignYear}-12-31`;

  let nitrogenKg = 0;
  let counted = 0;
  const uncountable: OperationFinding[] = [];

  for (const operation of input.operations) {
    if (operation.operationType !== "fertilization") continue;
    const day = operation.executedAt.slice(0, 10);
    if (day < from || day > to) continue;

    const targets: (DeclaredIssue | null)[] =
      operation.issues.length > 0 ? [...operation.issues] : [null];
    for (const issue of targets) {
      // Il massimale dei 170 kg riguarda l'azoto ORGANICO: un concime di
      // sintesi non è comunque ammesso in biologico ed è la scheda delle
      // sostanze a dirlo, non questa.
      if (issue?.fertilizerOrigin === "mineral") continue;
      const titre = issue?.nitrogenContentPct ?? nitrogenFromNpkRatio(operation.npkRatio);
      const quantity = issue?.quantity ?? operation.totalQuantity ?? null;
      if (titre == null || quantity == null || !Number.isFinite(quantity)) {
        uncountable.push({
          operationId: operation.id,
          executedAt: operation.executedAt,
          declaredName: substanceNameOf(operation, issue),
          verdict: "incomplete",
          matchedSubstance: null,
          restriction: null,
          message: {
            id: titre == null ? "missing.nitrogenContent" : "organic.incompleteOperations",
            values: { product: issue?.productName ?? operation.productName ?? "" },
          },
        });
        continue;
      }
      nitrogenKg += (quantity * titre) / 100;
      counted += 1;
    }
  }

  if (uncountable.length > 0) {
    return {
      value: null,
      limit,
      unit,
      status: "undecidable",
      message: {
        id: "organic.nitrogenUndecidable",
        values: { uncountable: uncountable.length },
      },
      uncountable,
    };
  }

  const perHa = input.areaHa > 0 ? nitrogenKg / input.areaHa : 0;
  const rounded = Number(perHa.toFixed(1));
  const status = perHa > limit ? "over" : perHa > limit * 0.8 ? "near" : "within";
  return {
    value: rounded,
    limit,
    unit,
    status,
    message: {
      id:
        status === "over"
          ? "organic.nitrogenOverLimit"
          : "organic.nitrogenWithinLimit",
      values: { value: rounded, limit, counted },
    },
    uncountable: [],
  };
}

/** Titolo di azoto dal testo libero `npk_ratio` ("12-6-18" → 12). */
export function nitrogenFromNpkRatio(ratio: string | null): number | null {
  if (!ratio) return null;
  const first = ratio.split(/[^0-9.,]+/).filter(Boolean)[0];
  if (!first) return null;
  const value = Number(first.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * Periodo di conversione. Si conta da `regime_since`: senza quella data non si
 * inventa una fine conversione, si dichiara il dato mancante — ed è il motivo
 * per cui la fase 1 l'ha resa un campo della campagna invece di lasciarla
 * implicita.
 */
export function assessConversion(input: OrganicAssessmentInput): ConversionFinding {
  const regime = input.campaign?.productionRegime ?? null;
  const since = input.campaign?.regimeSince ?? null;
  if (regime !== "in_conversion" && regime !== "organic") {
    return {
      status: "unknown",
      endsOn: null,
      message: { id: "organic.conversionUnknown" },
    };
  }
  if (!since) {
    return {
      status: "unknown",
      endsOn: null,
      message: { id: "organic.conversionUnknown" },
    };
  }
  const months = input.perennial
    ? input.limits?.conversionMonthsPerennial ?? CONVERSION_MONTHS.perennial
    : input.limits?.conversionMonthsAnnual ?? CONVERSION_MONTHS.annual;
  const endsOn = addMonths(since, months);
  if (!endsOn) {
    return {
      status: "unknown",
      endsOn: null,
      message: { id: "organic.conversionUnknown" },
    };
  }
  const today = input.now.slice(0, 10);
  return today >= endsOn
    ? {
        status: "complete",
        endsOn,
        message: { id: "organic.conversionComplete", values: { endsOn, months } },
      }
    : {
        status: "ongoing",
        endsOn,
        message: { id: "organic.conversionOngoing", values: { endsOn, months } },
      };
}

/** Valutazione completa del biologico per un appezzamento e un'annata. */
export function assessOrganic(input: OrganicAssessmentInput): OrganicAssessment {
  const reference = input.reference ?? ORGANIC_INPUT_REFERENCE;
  const operations = assessSubstances(input.operations, reference);
  return {
    plotId: input.plotId,
    campaignYear: input.campaignYear,
    reference: {
      act: reference.act,
      version: reference.version,
      partial: reference.partial,
    },
    operations,
    copper: assessCopper({ ...input, reference }),
    nitrogen: assessNitrogen({ ...input, reference }),
    conversion: assessConversion(input),
    incomplete: operations.filter((o) => o.verdict === "incomplete"),
  };
}
