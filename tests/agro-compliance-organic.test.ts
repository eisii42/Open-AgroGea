import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COPPER_LIMIT_KG_HA,
  NITROGEN_LIMIT_KG_HA,
  ORGANIC_INPUT_REFERENCE,
  addMonths,
  assessConversion,
  assessCopper,
  assessNitrogen,
  assessOrganic,
  assessSubstances,
  lookupSubstance,
  nitrogenFromNpkRatio,
  organicInputsCheck,
  resolveParameters,
  runCheck,
  type CheckInput,
  type DeclaredCampaign,
  type DeclaredIssue,
  type DeclaredOperation,
  type OrganicAssessmentInput,
} from "@agrogea/tools";

/**
 * Motore del biologico. Non guarda il cielo: guarda che cosa è stato
 * distribuito in campo.
 *
 * I test insistono su un punto solo, perché è quello che rende il modulo utile
 * invece che pericoloso: **ciò che non si sa non diventa un verdetto**. Una
 * sostanza fuori elenco non è vietata, un titolo di rame mancante non è uno
 * zero, un'operazione senza dati non è una conformità.
 */

const NOW = "2026-09-01T00:00:00.000Z";

function issue(overrides: Partial<DeclaredIssue> = {}): DeclaredIssue {
  return {
    productId: "product-1",
    productName: "Poltiglia Bordolese 20 WG",
    category: "phytosanitary",
    quantity: 10,
    unit: "kg",
    activeSubstance: "Solfato di rame",
    registrationNumber: "12345",
    copperContentPct: 20,
    nitrogenContentPct: null,
    fertilizerOrigin: null,
    ...overrides,
  };
}

function operation(overrides: Partial<DeclaredOperation> = {}): DeclaredOperation {
  return {
    id: "op-1",
    plotId: "plot-1",
    operationType: "phytosanitary",
    executedAt: "2026-05-10T08:00:00.000Z",
    productName: "Poltiglia Bordolese",
    registrationNumber: "12345",
    activeSubstance: "Solfato di rame",
    doseValue: 2,
    doseUnit: "kg/ha",
    totalQuantity: 10,
    fertilizerType: null,
    npkRatio: null,
    issues: [issue()],
    ...overrides,
  };
}

function campaign(overrides: Partial<DeclaredCampaign> = {}): DeclaredCampaign {
  return {
    plotId: "plot-1",
    campaignYear: 2026,
    declaredAreaHa: 5,
    cropName: "Vite",
    cropCategory: "viticoltura",
    cropExternalCode: null,
    productionRegime: "organic",
    regimeSince: "2022-01-01",
    closedAt: null,
    ...overrides,
  };
}

function organicInput(
  overrides: Partial<OrganicAssessmentInput> = {},
): OrganicAssessmentInput {
  return {
    plotId: "plot-1",
    campaignYear: 2026,
    areaHa: 5,
    operations: [operation()],
    campaign: campaign(),
    perennial: true,
    now: NOW,
    ...overrides,
  };
}

describe("biologico / elenco versionato delle sostanze", () => {
  it("l'elenco dichiara atto e versione: senza, l'esito non varrebbe nulla", () => {
    assert.equal(ORGANIC_INPUT_REFERENCE.act, "Reg. (UE) 2021/1165");
    assert.match(ORGANIC_INPUT_REFERENCE.version, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ORGANIC_INPUT_REFERENCE.partial, true);
  });

  it("riconosce la sostanza dentro un nome commerciale reale", () => {
    // Nessun quaderno scrive "composti del rame": scrive quello che c'è
    // sull'etichetta.
    const found = lookupSubstance("Ossicloruro di rame 20% WG");
    assert.equal(found.entry?.substance, "Composti del rame");
    assert.equal(found.entry?.status, "allowed");
  });

  it("una sostanza fuori elenco è SCONOSCIUTA, non vietata", () => {
    // È la regola che regge tutto: l'elenco è parziale, e l'incompletezza è
    // nostra. Trattarla come divieto significherebbe accusare l'agricoltore.
    const found = lookupSubstance("Estratto di equiseto");
    assert.equal(found.unknown, true);
    assert.equal(found.entry, null);
  });

  it("una sostanza di sintesi è vietata perché è in elenco, non per assenza", () => {
    const found = lookupSubstance("Glifosate 360 SL");
    assert.equal(found.entry?.status, "prohibited");
  });

  it("un alias corto non si aggancia a un frammento qualsiasi", () => {
    // "bt" (Bacillus thuringiensis) non deve trovarsi dentro un nome
    // commerciale che lo contiene per caso.
    assert.equal(lookupSubstance("Abtal Super").unknown, true);
    assert.equal(
      lookupSubstance("Bt kurstaki").entry?.substance,
      "Bacillus thuringiensis",
    );
  });
});

describe("biologico / sostanze distribuite", () => {
  it("una sostanza ammessa risulta ammessa, con l'allegato accanto", () => {
    const findings = assessSubstances([operation()]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].verdict, "allowed");
    assert.equal(findings[0].matchedSubstance, "Composti del rame");
    assert.equal(findings[0].message.values?.annex, "II");
  });

  it("riporta la condizione d'uso dell'atto, non solo il sì o il no", () => {
    const findings = assessSubstances([operation()]);
    assert.match(findings[0].restriction ?? "", /28 kg/);
  });

  it("una sostanza di sintesi risulta non ammessa", () => {
    const findings = assessSubstances([
      operation({
        activeSubstance: "Glifosate",
        issues: [issue({ activeSubstance: "Glifosate", copperContentPct: null })],
      }),
    ]);
    assert.equal(findings[0].verdict, "not_allowed");
  });

  it("un'operazione senza sostanza identificabile è INCOMPLETA", () => {
    // Non conforme e non non-conforme: non si può dire nulla di ciò che non è
    // stato scritto.
    const findings = assessSubstances([
      operation({
        productName: null,
        activeSubstance: null,
        fertilizerType: null,
        issues: [],
      }),
    ]);
    assert.equal(findings[0].verdict, "incomplete");
  });

  it("un'operazione con due lotti produce due esiti, non uno", () => {
    const findings = assessSubstances([
      operation({
        issues: [issue(), issue({ activeSubstance: "Zolfo", copperContentPct: null })],
      }),
    ]);
    assert.deepEqual(
      findings.map((f) => f.matchedSubstance),
      ["Composti del rame", "Zolfo"],
    );
  });

  it("le operazioni che non distribuiscono nulla non entrano nel conto", () => {
    assert.equal(
      assessSubstances([operation({ operationType: "tillage" })]).length,
      0,
    );
  });
});

describe("biologico / rame, 28 kg/ha in 7 anni", () => {
  it("converte la dose in rame METALLO con il titolo del prodotto", () => {
    // 10 kg di formulato al 20% = 2 kg di rame su 5 ha = 0,4 kg/ha.
    const finding = assessCopper(organicInput());
    assert.equal(finding.value, 0.4);
    assert.equal(finding.limit, COPPER_LIMIT_KG_HA);
    assert.equal(finding.status, "within");
  });

  it("somma su tutta la finestra mobile di sette anni", () => {
    const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
    const operations = years.map((year) =>
      operation({
        id: `op-${year}`,
        executedAt: `${year}-05-10T08:00:00.000Z`,
        issues: [issue({ quantity: 100 })],
      }),
    );
    // 7 × 100 kg al 20% = 140 kg di rame su 5 ha = 28 kg/ha: al limite esatto.
    // Il limite è INCLUSIVO (non si è oltre), ma essere esattamente al tetto è
    // un'informazione operativa: l'esito è "vicino al limite", non "a posto".
    const finding = assessCopper(organicInput({ operations }));
    assert.equal(finding.value, 28);
    assert.equal(finding.status, "near");
  });

  it("ciò che è uscito dalla finestra non pesa più", () => {
    const finding = assessCopper(
      organicInput({
        operations: [
          operation({ executedAt: "2019-05-10T08:00:00.000Z", issues: [issue({ quantity: 500 })] }),
        ],
      }),
    );
    assert.equal(finding.value, 0);
  });

  it("oltre il massimale lo dice, con il numero e il limite", () => {
    const finding = assessCopper(
      organicInput({
        operations: [operation({ issues: [issue({ quantity: 800 })] })],
      }),
    );
    assert.equal(finding.status, "over");
    assert.equal(finding.message.id, "organic.copperOverLimit");
    assert.equal(finding.message.values?.limit, 28);
  });

  it("senza il titolo di rame NON somma: dice quale dato aggiungere", () => {
    // 5 kg di un prodotto al 20% e 5 kg di uno al 50% sono 1 kg e 2,5 kg di
    // rame. Senza il titolo la quantità di formulato non dice nulla, e una
    // somma parziale spacciata per totale sarebbe il difetto peggiore.
    const finding = assessCopper(
      organicInput({
        operations: [operation({ issues: [issue({ copperContentPct: null })] })],
      }),
    );
    assert.equal(finding.status, "undecidable");
    assert.equal(finding.value, null);
    assert.equal(finding.uncountable.length, 1);
    assert.equal(finding.uncountable[0].message.id, "missing.copperContent");
  });

  it("nessun trattamento rameico non è un dato mancante: è zero", () => {
    const finding = assessCopper(
      organicInput({
        operations: [
          operation({
            activeSubstance: "Zolfo",
            issues: [issue({ activeSubstance: "Zolfo", copperContentPct: null })],
          }),
        ],
      }),
    );
    assert.equal(finding.status, "within");
    assert.equal(finding.value, 0);
  });
});

describe("biologico / azoto organico, 170 kg N/ha/anno", () => {
  function fertilization(overrides: Partial<DeclaredIssue> = {}) {
    return operation({
      operationType: "fertilization",
      activeSubstance: null,
      productName: "Letame bovino",
      fertilizerType: "Letame",
      issues: [
        issue({
          category: "fertilizer",
          productName: "Letame bovino",
          activeSubstance: null,
          copperContentPct: null,
          nitrogenContentPct: 5,
          quantity: 1000,
          fertilizerOrigin: "organic",
          ...overrides,
        }),
      ],
    });
  }

  it("il massimale è quello della Direttiva Nitrati, non un numero nostro", () => {
    assert.equal(NITROGEN_LIMIT_KG_HA, 170);
  });

  it("calcola i kg di azoto per ettaro dell'annata", () => {
    // 1000 kg al 5% = 50 kg di N su 5 ha = 10 kg N/ha.
    const finding = assessNitrogen(organicInput({ operations: [fertilization()] }));
    assert.equal(finding.value, 10);
    assert.equal(finding.status, "within");
  });

  it("oltre 170 kg N/ha lo dichiara non conforme", () => {
    const finding = assessNitrogen(
      organicInput({ operations: [fertilization({ quantity: 20000 })] }),
    );
    assert.equal(finding.status, "over");
    assert.equal(finding.message.id, "organic.nitrogenOverLimit");
  });

  it("il concime minerale non entra nel conto dell'azoto ORGANICO", () => {
    const finding = assessNitrogen(
      organicInput({
        operations: [fertilization({ fertilizerOrigin: "mineral", quantity: 20000 })],
      }),
    );
    assert.equal(finding.value, 0);
  });

  it("senza titolo di azoto ripiega sul titolo N-P-K scritto a mano", () => {
    assert.equal(nitrogenFromNpkRatio("12-6-18"), 12);
    assert.equal(nitrogenFromNpkRatio("N 8 - P 4 - K 12"), 8);
    assert.equal(nitrogenFromNpkRatio(null), null);
    assert.equal(nitrogenFromNpkRatio("boh"), null);
  });

  it("senza alcun titolo non decide, e dice che manca", () => {
    const finding = assessNitrogen(
      organicInput({
        operations: [
          {
            ...fertilization({ nitrogenContentPct: null }),
            npkRatio: null,
          },
        ],
      }),
    );
    assert.equal(finding.status, "undecidable");
    assert.equal(finding.uncountable[0].message.id, "missing.nitrogenContent");
  });
});

describe("biologico / periodo di conversione", () => {
  it("somma i mesi restando sul giorno, senza inventarsi fusi orari", () => {
    assert.equal(addMonths("2025-04-01", 24), "2027-04-01");
    assert.equal(addMonths("2025-01-31", 36), "2028-01-31");
    assert.equal(addMonths("non-una-data", 24), null);
  });

  it("36 mesi per le perenni, 24 per le annuali", () => {
    // Reg. (UE) 2018/848, All. II parte I punto 1.7.
    const perennial = assessConversion(
      organicInput({
        campaign: campaign({ productionRegime: "in_conversion", regimeSince: "2025-04-01" }),
        perennial: true,
      }),
    );
    assert.equal(perennial.endsOn, "2028-04-01");

    const annual = assessConversion(
      organicInput({
        campaign: campaign({ productionRegime: "in_conversion", regimeSince: "2025-04-01" }),
        perennial: false,
      }),
    );
    assert.equal(annual.endsOn, "2027-04-01");
  });

  it("dice se la conversione è finita o è ancora in corso alla data osservata", () => {
    const ongoing = assessConversion(
      organicInput({
        campaign: campaign({ productionRegime: "in_conversion", regimeSince: "2025-04-01" }),
      }),
    );
    assert.equal(ongoing.status, "ongoing");

    const complete = assessConversion(
      organicInput({
        campaign: campaign({ productionRegime: "organic", regimeSince: "2020-01-01" }),
      }),
    );
    assert.equal(complete.status, "complete");
  });

  it("senza `regime_since` non inventa una fine conversione", () => {
    // È il motivo per cui la fase 1 ha reso quella data un campo della
    // campagna invece di lasciarla implicita.
    const finding = assessConversion(
      organicInput({
        campaign: campaign({ productionRegime: "organic", regimeSince: null }),
      }),
    );
    assert.equal(finding.status, "unknown");
    assert.equal(finding.endsOn, null);
  });
});

describe("biologico / scheda completa", () => {
  function checkInput(overrides: Partial<CheckInput> = {}): CheckInput {
    return {
      plot: { id: "plot-1", name: "Vigna", areaHa: 5 },
      campaignYear: 2026,
      country: "IT",
      series: { plotId: "plot-1", points: [] },
      campaigns: [campaign()],
      operations: [operation()],
      layers: { available: [], intersects: [], minDistanceToWaterM: null },
      terrain: null,
      orthophoto: null,
      parameters: resolveParameters(organicInputsCheck),
      now: NOW,
      ...overrides,
    };
  }

  it("non pretende scene satellitari: non è una scheda che guarda il cielo", () => {
    // Se il runner le applicasse i presupposti satellitari, questa scheda
    // sarebbe "non decidibile" per una ragione che non la riguarda.
    const result = runCheck(organicInputsCheck, checkInput());
    assert.notEqual(result.outcome, "undecidable");
    assert.equal(result.scenes.length, 0);
  });

  it("porta comunque la busta di trasparenza delle altre schede", () => {
    const result = runCheck(organicInputsCheck, checkInput());
    assert.equal(result.assessment, "self_assessment");
    assert.ok(result.reference.act.includes("2018/848"));
    assert.ok(result.parameters.some((p) => p.id === "copperLimitKgHa"));
  });

  it("su un appezzamento convenzionale non si pronuncia", () => {
    const result = runCheck(
      organicInputsCheck,
      checkInput({ campaigns: [campaign({ productionRegime: "conventional" })] }),
    );
    assert.equal(result.outcome, "undecidable");
  });

  it("una sostanza non ammessa rende la campagna non conforme", () => {
    const result = runCheck(
      organicInputsCheck,
      checkInput({
        operations: [
          operation({
            activeSubstance: "Glifosate",
            issues: [issue({ activeSubstance: "Glifosate", copperContentPct: null })],
          }),
        ],
      }),
    );
    assert.equal(result.outcome, "non_compliant");
  });

  it("una sostanza sconosciuta NON produce un 'conforme'", () => {
    const result = runCheck(
      organicInputsCheck,
      checkInput({
        operations: [
          operation({
            activeSubstance: "Estratto di equiseto",
            issues: [issue({ activeSubstance: "Estratto di equiseto", copperContentPct: null })],
          }),
        ],
      }),
    );
    assert.equal(result.outcome, "attention");
  });

  it("i dati mancanti impediscono la conformità, e restano elencati", () => {
    const result = runCheck(
      organicInputsCheck,
      checkInput({
        operations: [operation({ issues: [issue({ copperContentPct: null })] })],
      }),
    );
    assert.notEqual(result.outcome, "compliant");
    assert.ok(result.missing.length > 0);
    assert.equal(result.missing[0].where, "products");
  });

  it("l'esito cita la versione dell'elenco su cui è stato dato", () => {
    const result = runCheck(organicInputsCheck, checkInput());
    assert.equal(
      result.explanation.values?.version,
      ORGANIC_INPUT_REFERENCE.version,
    );
  });

  it("mette insieme sostanze, rame, azoto e conversione in un esito solo", () => {
    const assessment = assessOrganic(organicInput());
    assert.equal(assessment.operations.length, 1);
    assert.equal(assessment.copper.status, "within");
    assert.equal(assessment.nitrogen.status, "within");
    assert.equal(assessment.conversion.status, "complete");
    assert.equal(assessment.incomplete.length, 0);
    assert.equal(assessment.reference.partial, true);
  });
});
