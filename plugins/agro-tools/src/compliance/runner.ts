import type {
  CheckInput,
  CheckParameter,
  CheckResult,
  CheckSpec,
  ConfidenceFactor,
  DeclaredRequirement,
  MissingInput,
  ParameterOverrides,
} from "./check-types";
import {
  archiveDepthFactor,
  capByObservability,
  cloudCoverFactor,
  combineConfidence,
  declaredDataFactor,
  expectedScenes,
  maxGapDays,
  meanCloudCover,
  purePixelEstimate,
  purePixelFactor,
  sceneCountFactor,
  temporalGapFactor,
} from "./confidence";
import {
  archiveYears,
  pointsInWindow,
  provenanceOf,
  usablePoints,
} from "./series";

/**
 * Esecutore condiviso delle schede: costruisce la **busta di trasparenza**
 * attorno al verdetto di ciascuna scheda.
 *
 * Le venti schede non implementano provenienza, parametri, confidenza e
 * disclaimer: li implementa questo file, una volta. È la ragione per cui una
 * scheda nuova — anche fornita da un plugin — non può essere meno trasparente
 * delle altre: non ha il modo di esserlo.
 *
 * ## L'ordine dei controlli non è casuale
 *
 * 1. si risolvono i parametri (default + override dell'utente);
 * 2. si verificano i PRESUPPOSTI. Se mancano, l'esito è `undecidable` e la
 *    scheda **non viene eseguita**: un metodo che gira su dati insufficienti
 *    produce un numero, e un numero prodotto così è peggio del silenzio;
 * 3. solo allora si chiama `run`, e il suo verdetto viene incartato con le
 *    scene realmente usate e la confidenza.
 *
 * La confidenza si calcola SEMPRE, anche per gli `undecidable`: i suoi fattori
 * sono la spiegazione di perché non si è deciso.
 */

/** Pixel puri minimi sotto i quali una statistica zonale non ha senso. */
export const MIN_PURE_PIXELS = 10;

/** Nuvolosità massima di default per considerare utilizzabile una scena. */
export const DEFAULT_MAX_CLOUD_PCT = 40;

/** Buco temporale tollerato di default, in giorni (due rivisite mancate). */
export const DEFAULT_TOLERATED_GAP_DAYS = 15;

/** Parametro comune a ogni scheda: la soglia di nuvolosità delle scene usate. */
export const CLOUD_COVER_PARAMETER = {
  id: "cloudCoverMax",
  defaultValue: DEFAULT_MAX_CLOUD_PCT,
  unit: "%",
  min: 0,
  max: 100,
  reference: null,
  description: { id: "parameter.cloudCoverMax" },
} as const;

/**
 * Risolve i parametri di una scheda: default dichiarati dalla scheda più gli
 * override dell'utente, tenendo memoria di QUALE dei due ha vinto. L'override
 * fuori dagli estremi ammessi viene ignorato (e resta il default): un valore
 * impossibile non deve poter produrre un esito plausibile.
 */
export function resolveParameters(
  spec: CheckSpec,
  overrides: ParameterOverrides = {},
): Record<string, CheckParameter> {
  const forCheck = overrides[spec.id] ?? {};
  const out: Record<string, CheckParameter> = {};
  const specs = [CLOUD_COVER_PARAMETER, ...spec.parameters];
  for (const parameter of specs) {
    const override = forCheck[parameter.id];
    const valid =
      typeof override === "number" &&
      Number.isFinite(override) &&
      override >= parameter.min &&
      override <= parameter.max;
    out[parameter.id] = {
      ...parameter,
      value: valid ? override : parameter.defaultValue,
      source: valid ? "override" : "default",
    };
  }
  return out;
}

/** Valore di un parametro risolto, con ripiego esplicito se non dichiarato. */
export function parameterValue(
  parameters: Readonly<Record<string, CheckParameter>>,
  id: string,
  fallback: number,
): number {
  const parameter = parameters[id];
  return parameter ? parameter.value : fallback;
}

/** Dato dichiarato mancante → voce di {@link MissingInput}. */
function missingDeclared(requirement: DeclaredRequirement): MissingInput {
  switch (requirement) {
    case "campaign":
      return {
        what: { id: "missing.campaign" },
        where: "campaign",
        howToFix: { id: "missing.campaignFix" },
      };
    case "crop":
      return {
        what: { id: "missing.crop" },
        where: "campaign",
        howToFix: { id: "missing.cropFix" },
      };
    case "declaredArea":
      return {
        what: { id: "missing.declaredArea" },
        where: "campaign",
        howToFix: { id: "missing.declaredAreaFix" },
      };
    case "operations":
      return {
        what: { id: "missing.operations" },
        where: "logbook",
        howToFix: { id: "missing.operationsFix" },
      };
    case "productionRegime":
      return {
        what: { id: "missing.productionRegime" },
        where: "campaign",
        howToFix: { id: "missing.productionRegimeFix" },
      };
    case "issues":
      return {
        what: { id: "missing.issues" },
        where: "logbook",
        howToFix: { id: "missing.issuesFix" },
      };
    case "terrain":
      return {
        what: { id: "missing.terrain" },
        where: "layers",
        howToFix: { id: "missing.terrainFix" },
      };
    default:
      return {
        what: { id: "missing.layer", values: { layer: requirement } },
        where: "layers",
        howToFix: { id: "missing.layerFix", values: { layer: requirement } },
      };
  }
}

/** Layer richiesto dalla scheda (i requisiti non-layer tornano `null`). */
function requiredLayer(requirement: DeclaredRequirement): string | null {
  switch (requirement) {
    case "waterNetworkLayer":
      return "water_network";
    case "protectedAreaLayer":
      return "protected_area";
    case "wetlandLayer":
      return "wetland";
    case "deforestationLayer":
      return "deforestation";
    default:
      return null;
  }
}

/**
 * Verifica un singolo requisito dichiarato. Restituisce `true` se il dato c'è.
 * Volutamente severo: "c'è la campagna" significa che esiste la riga
 * dell'annata osservata, non che ne esista una qualsiasi.
 */
function hasDeclared(input: CheckInput, requirement: DeclaredRequirement): boolean {
  const campaign = input.campaigns.find(
    (c) => c.campaignYear === input.campaignYear,
  );
  switch (requirement) {
    case "campaign":
      return campaign != null;
    case "crop":
      return Boolean(campaign?.cropName ?? campaign?.cropExternalCode);
    case "declaredArea":
      return typeof campaign?.declaredAreaHa === "number" && campaign.declaredAreaHa > 0;
    case "operations":
      return input.operations.length > 0;
    case "productionRegime":
      return campaign?.productionRegime != null;
    case "issues":
      return input.operations.some((o) => o.issues.length > 0);
    case "terrain":
      return input.terrain != null;
    default: {
      const layer = requiredLayer(requirement);
      return layer == null || input.layers.available.includes(layer);
    }
  }
}

/** Esito della verifica dei presupposti, prima che il metodo giri. */
export interface PreconditionReport {
  missing: MissingInput[];
  /** Punti utilizzabili nella finestra, per l'indice principale della scheda. */
  usable: ReturnType<typeof usablePoints>;
  /** Fattori comuni, calcolati anche quando i presupposti mancano. */
  factors: ConfidenceFactor[];
}

/**
 * Presupposti di una scheda. Blocca su quattro fronti, e ognuno corrisponde a
 * un modo diverso di non poter sapere:
 *   * **scene** — non si è guardato abbastanza volte;
 *   * **pixel puri** — l'appezzamento è troppo piccolo per il sensore;
 *   * **archivio** — la storia richiesta dal metodo non c'è ancora;
 *   * **dati dichiarati** — il Quaderno o la campagna non bastano.
 */
export function evaluatePreconditions(
  spec: CheckSpec,
  input: CheckInput,
): PreconditionReport {
  const missing: MissingInput[] = [];
  const window = spec.window(input.campaignYear, input.parameters);
  const maxCloud = parameterValue(
    input.parameters,
    "cloudCoverMax",
    DEFAULT_MAX_CLOUD_PCT,
  );
  const primaryIndex = spec.requires.indices[0];
  const inWindow = pointsInWindow(input.series, window.from, window.to);
  const usable = primaryIndex
    ? usablePoints(inWindow, primaryIndex, maxCloud)
    : inWindow;

  /**
   * Non tutte le schede guardano il cielo. Il biologico si verifica da ciò che
   * è stato distribuito in campo, non da satellite: pretendere scene e pixel
   * puri lo renderebbe "non decidibile" per una ragione che non lo riguarda.
   * Una scheda senza indici dichiarati salta i presupposti satellitari — e i
   * relativi fattori di incertezza, che sarebbero rumore nella sua confidenza.
   */
  const remoteSensing = spec.requires.indices.length > 0;
  if (!remoteSensing) {
    let present = 0;
    for (const requirement of spec.requires.declared) {
      if (hasDeclared(input, requirement)) present += 1;
      else missing.push(missingDeclared(requirement));
    }
    return {
      missing,
      usable: [],
      factors: [declaredDataFactor(present, spec.requires.declared.length)],
    };
  }

  // 1. Scene. Un indice che la pipeline non scarica affatto è un caso a parte:
  // non è "poche scene", è una banda che non viene proprio richiesta, e va
  // detto in quei termini perché la soluzione è diversa (estendere la
  // pipeline, non aspettare cielo sereno).
  const indexAbsent =
    primaryIndex != null &&
    inWindow.length > 0 &&
    inWindow.every((p) => p.values[primaryIndex] == null);
  if (indexAbsent) {
    missing.push({
      what: { id: "missing.indexNotInPipeline", values: { index: primaryIndex } },
      where: "pipeline",
      howToFix: {
        id: "missing.indexNotInPipelineFix",
        values: { index: primaryIndex },
      },
    });
  } else if (usable.length < spec.requires.minUsableScenes) {
    missing.push({
      what: {
        id: "missing.noUsableScenes",
        values: { usable: usable.length, required: spec.requires.minUsableScenes },
      },
      where: "archive",
      howToFix: { id: "missing.noUsableScenesFix" },
    });
  }

  // 2. Pixel puri. Non dipende dal meteo né dall'attesa: è la geometria contro
  // la risoluzione, e su una parcella piccola resterà vero per sempre.
  const gsd = usable[0]?.gsdM ?? inWindow[0]?.gsdM ?? 10;
  const pure = purePixelEstimate(input.plot.areaHa, gsd);
  if (pure < MIN_PURE_PIXELS) {
    missing.push({
      what: {
        id: "missing.tooFewPurePixels",
        values: { purePixels: pure, minPurePixels: MIN_PURE_PIXELS },
      },
      where: "archive",
      howToFix: { id: "missing.tooFewPurePixelsFix" },
    });
  }

  // 3. Archivio, per le schede pluriennali.
  const available = archiveYears(input.series);
  if (spec.requires.archiveYears > 1 && available < spec.requires.archiveYears) {
    missing.push({
      what: {
        id: "missing.archiveTooShort",
        values: { available, required: spec.requires.archiveYears },
      },
      where: "archive",
      howToFix: {
        id: "missing.archiveTooShortFix",
        values: { required: spec.requires.archiveYears },
      },
    });
  }

  // 4. Dati dichiarati.
  let presentDeclared = 0;
  for (const requirement of spec.requires.declared) {
    if (hasDeclared(input, requirement)) presentDeclared += 1;
    else missing.push(missingDeclared(requirement));
  }

  const expected = expectedScenes(window.from, window.to);
  const factors: ConfidenceFactor[] = [
    sceneCountFactor(usable.length, expected),
    temporalGapFactor(maxGapDays(usable), DEFAULT_TOLERATED_GAP_DAYS),
    cloudCoverFactor(meanCloudCover(usable)),
    purePixelFactor(input.plot.areaHa, MIN_PURE_PIXELS, gsd),
    declaredDataFactor(presentDeclared, spec.requires.declared.length),
  ];
  if (spec.requires.archiveYears > 1) {
    factors.push(archiveDepthFactor(available, spec.requires.archiveYears));
  }

  return { missing, usable, factors };
}

/**
 * Esegue una scheda e ne costruisce il risultato completo. È l'unico punto in
 * cui nasce un {@link CheckResult}: nessuna scheda può produrne uno per conto
 * proprio, e quindi nessuna può dimenticarsi la provenienza o il disclaimer.
 */
export function runCheck(spec: CheckSpec, input: CheckInput): CheckResult {
  const window = spec.window(input.campaignYear, input.parameters);
  const report = evaluatePreconditions(spec, input);

  const base = {
    checkId: spec.id,
    plotId: input.plot.id,
    campaignYear: input.campaignYear,
    reference: spec.reference,
    subject: spec.subject,
    method: spec.method,
    window,
    observability: spec.observability,
    parameters: Object.values(input.parameters),
    computedAt: input.now,
    assessment: "self_assessment" as const,
  };

  if (report.missing.length > 0) {
    // Presupposti insufficienti: il metodo NON gira. La confidenza si calcola
    // ugualmente, perché i suoi fattori sono la spiegazione del "non so".
    return {
      ...base,
      scenes: provenanceOf(report.usable),
      outcome: "undecidable",
      confidence: capByObservability(
        combineConfidence(report.factors),
        spec.observability,
      ),
      explanation: { id: "explain.undecidable" },
      missing: report.missing,
      series: null,
    };
  }

  const verdict = spec.run(input);
  const usedScenes = verdict.usedSceneIds
    ? report.usable.filter((p) => verdict.usedSceneIds?.includes(p.sceneId))
    : report.usable;
  const factors = [...report.factors, ...(verdict.factors ?? [])];
  const missing = verdict.missing ?? [];

  /**
   * Invariante: **una scheda non può dichiarare "conforme" mentre elenca dati
   * mancanti.** Elencare un dato mancante accanto a un esito deciso è
   * legittimo e utile (sapere che tre operazioni non erano conteggiabili
   * cambia il modo di leggere il numero); dichiarare la conformità mentre
   * manca qualcosa, no — sarebbe una conformità per omissione. In quel caso
   * l'esito scende ad `attention`, che è ciò che è davvero.
   *
   * Le schede che non possono decidere restituiscono `undecidable` da sé: il
   * runner non lo impone, perché sono loro a sapere quali dei propri dati sono
   * indispensabili e quali soltanto utili.
   */
  const outcome =
    verdict.outcome === "compliant" && missing.length > 0
      ? "attention"
      : verdict.outcome;

  return {
    ...base,
    scenes: provenanceOf(usedScenes),
    outcome,
    confidence: capByObservability(combineConfidence(factors), spec.observability),
    explanation: verdict.explanation,
    missing,
    series: verdict.series ?? null,
  };
}

/** Esegue più schede sullo stesso appezzamento, nell'ordine del catalogo. */
export function runChecks(
  specs: readonly CheckSpec[],
  input: Omit<CheckInput, "parameters">,
  overrides: ParameterOverrides = {},
): CheckResult[] {
  return specs.map((spec) =>
    runCheck(spec, { ...input, parameters: resolveParameters(spec, overrides) }),
  );
}
