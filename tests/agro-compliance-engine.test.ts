import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORE_CHECKS,
  CheckRegistry,
  MIN_PURE_PIXELS,
  OBSERVABILITY_CEILING,
  REQUIRED_BANDS,
  a1AgriculturalActivity,
  b3Gaec6SoilCover,
  b5Gaec8NonProductive,
  b8Gaec3StubbleBurning,
  combineConfidence,
  coreCheckRegistry,
  d1MowingGrazing,
  d4Irrigation,
  daysAboveThresholdShare,
  detectDrops,
  dropsWithRecovery,
  purePixelEstimate,
  requiredBandsForIndices,
  resolveParameters,
  runCheck,
  usablePoints,
  type CheckInput,
  type CheckSpec,
  type ConfidenceFactor,
  type IndexSeriesPoint,
} from "@agrogea/tools";

/**
 * Impianto di trasparenza del modulo Compliance.
 *
 * Le schede sono venti e cresceranno; ciò che NON deve poter cambiare è come
 * ognuna dichiara che cosa ha guardato e quanto è sicura. Questi test guardano
 * quindi l'impianto prima delle schede: la busta di provenienza, la porta
 * dell'esito "non decidibile", il modello di incertezza e i parametri.
 */

const NOW = "2026-09-01T00:00:00.000Z";

function point(
  date: string,
  ndvi: number,
  overrides: Partial<IndexSeriesPoint> = {},
): IndexSeriesPoint {
  return {
    date,
    sceneId: `S2_${date}`,
    collection: "sentinel-2-l2a",
    gsdM: 10,
    cloudCoverPct: 5,
    validPixels: 400,
    values: { ndvi },
    ...overrides,
  };
}

/** Serie regolare ogni `stepDays` giorni, con i valori dati in sequenza. */
function series(
  from: string,
  values: number[],
  stepDays = 10,
): IndexSeriesPoint[] {
  const start = Date.parse(from);
  return values.map((value, i) =>
    point(new Date(start + i * stepDays * 86_400_000).toISOString(), value),
  );
}

function input(
  points: IndexSeriesPoint[],
  spec: CheckSpec,
  overrides: Partial<CheckInput> = {},
): CheckInput {
  return {
    plot: { id: "plot-1", name: "Campo 1", areaHa: 5 },
    campaignYear: 2026,
    country: "IT",
    series: { plotId: "plot-1", points },
    campaigns: [],
    operations: [],
    layers: { available: [], intersects: [], minDistanceToWaterM: null },
    terrain: null,
    parameters: resolveParameters(spec),
    now: NOW,
    ...overrides,
  };
}

describe("compliance / stima dei pixel puri", () => {
  it("un appezzamento piccolo non ha abbastanza pixel puri per Sentinel-2", () => {
    // 0,3 ha è un quadrato di ~55 m: tolta la corona di un pixel per lato ne
    // restano ~35 m, cioè una dozzina scarsa di pixel. È il conto che spiega
    // perché sotto questa taglia le schede dicono "non decidibile".
    assert.equal(purePixelEstimate(0.3, 10), 12);
    assert.equal(purePixelEstimate(0.05, 10), 0);
    assert.ok(purePixelEstimate(5, 10) > 400);
  });

  it("una superficie non valida non produce pixel immaginari", () => {
    assert.equal(purePixelEstimate(0, 10), 0);
    assert.equal(purePixelEstimate(-1, 10), 0);
    assert.equal(purePixelEstimate(Number.NaN, 10), 0);
  });
});

describe("compliance / composizione della confidenza", () => {
  function factor(
    id: ConfidenceFactor["id"],
    score: number,
    weight = 1,
  ): ConfidenceFactor {
    return {
      id,
      score,
      weight,
      observed: { id: "factor.sceneCount" },
      limiting: score < 0.6,
    };
  }

  it("è una media pesata, non il minimo", () => {
    const confidence = combineConfidence([
      factor("scene_count", 1),
      factor("cloud_cover", 0.2),
    ]);
    assert.equal(confidence.value, 0.6);
  });

  it("espone comunque l'anello debole, dal più penalizzante", () => {
    // È il punto del modello: la media non deve poter nascondere il fattore che
    // limita davvero la conclusione.
    const confidence = combineConfidence([
      factor("scene_count", 0.9),
      factor("cloud_cover", 0.5),
      factor("pure_pixels", 0.2),
    ]);
    assert.deepEqual(confidence.limitedBy, ["pure_pixels", "cloud_cover"]);
  });

  it("senza fattori non inventa fiducia", () => {
    assert.equal(combineConfidence([]).value, 0);
  });

  it("l'osservabilità dichiarata mette un tetto alla confidenza", () => {
    // Una scheda che osserva un oggetto più piccolo del pixel non può risultare
    // molto confidente solo perché quel giorno il cielo era sereno.
    assert.equal(OBSERVABILITY_CEILING.low < OBSERVABILITY_CEILING.high, true);
  });
});

describe("compliance / serie temporale", () => {
  it("la copertura si conta in GIORNI, non in scene", () => {
    // Due scene sopra soglia ravvicinate e una sotto lontana: contando le scene
    // verrebbe 2/3, contando i giorni molto meno. Le nuvole tolgono proprio i
    // giorni piovosi, e contare le scene sarebbe sistematicamente ottimista.
    const points = [
      point("2026-01-01T00:00:00.000Z", 0.5),
      point("2026-01-06T00:00:00.000Z", 0.5),
      point("2026-03-01T00:00:00.000Z", 0.5),
    ];
    const share = daysAboveThresholdShare(points, "ndvi", 0.3);
    assert.equal(share, 1);

    const mixed = [
      point("2026-01-01T00:00:00.000Z", 0.5),
      point("2026-01-06T00:00:00.000Z", 0.5),
      point("2026-03-01T00:00:00.000Z", 0.1),
    ];
    const partial = daysAboveThresholdShare(mixed, "ndvi", 0.3);
    assert.ok(partial < 0.6, `atteso < 0.6, ottenuto ${partial}`);
  });

  it("trova i cali bruschi e dice in che intervallo sono avvenuti", () => {
    const points = series("2026-05-01T00:00:00.000Z", [0.8, 0.78, 0.35, 0.5]);
    const drops = detectDrops(points, "ndvi", 0.2);
    assert.equal(drops.length, 1);
    assert.equal(drops[0].spanDays, 10);
    assert.equal(drops[0].sceneIds.length, 2);
  });

  it("distingue lo sfalcio (ricresce) dal cambio d'uso (non ricresce)", () => {
    const mown = series("2026-05-01T00:00:00.000Z", [0.8, 0.35, 0.55, 0.75]);
    const converted = series("2026-05-01T00:00:00.000Z", [0.8, 0.35, 0.3, 0.28]);
    assert.equal(dropsWithRecovery(mown, "ndvi", 0.2, 45).length, 1);
    assert.equal(dropsWithRecovery(converted, "ndvi", 0.2, 45).length, 0);
  });

  it("una scena troppo nuvolosa non entra nel calcolo", () => {
    const points = [
      point("2026-05-01T00:00:00.000Z", 0.8),
      point("2026-05-11T00:00:00.000Z", 0.2, { cloudCoverPct: 90 }),
    ];
    assert.equal(usablePoints(points, "ndvi", 40).length, 1);
  });
});

describe("compliance / parametri", () => {
  it("il default vince, e dice di essere un default", () => {
    const parameters = resolveParameters(b3Gaec6SoilCover);
    assert.equal(parameters["coverNdviThreshold"].value, 0.3);
    assert.equal(parameters["coverNdviThreshold"].source, "default");
  });

  it("l'override dell'utente vince, e resta tracciato come tale", () => {
    const parameters = resolveParameters(b3Gaec6SoilCover, {
      b3_gaec6_soil_cover: { coverNdviThreshold: 0.45 },
    });
    assert.equal(parameters["coverNdviThreshold"].value, 0.45);
    assert.equal(parameters["coverNdviThreshold"].source, "override");
  });

  it("un override impossibile viene ignorato, non applicato", () => {
    // Un valore fuori scala produrrebbe un esito plausibile da un ingresso
    // assurdo: è il modo più silenzioso di sbagliare, e va chiuso.
    const parameters = resolveParameters(b3Gaec6SoilCover, {
      b3_gaec6_soil_cover: { coverNdviThreshold: 42 },
    });
    assert.equal(parameters["coverNdviThreshold"].value, 0.3);
    assert.equal(parameters["coverNdviThreshold"].source, "default");
  });

  it("ogni scheda porta la soglia di nuvolosità, senza doverla dichiarare", () => {
    for (const spec of [a1AgriculturalActivity, b3Gaec6SoilCover, d1MowingGrazing]) {
      assert.ok(resolveParameters(spec)["cloudCoverMax"], spec.id);
    }
  });

  it("le soglie non sono costanti sepolte: ognuna è un parametro esposto", () => {
    const result = runCheck(
      a1AgriculturalActivity,
      input(series("2026-03-01T00:00:00.000Z", [0.8, 0.78, 0.3, 0.6, 0.7, 0.72]), a1AgriculturalActivity),
    );
    const ids = result.parameters.map((p) => p.id);
    assert.ok(ids.includes("activityNdviThreshold"));
    assert.ok(ids.includes("cloudCoverMax"));
  });
});

describe("compliance / la busta di trasparenza è obbligatoria", () => {
  const points = series("2026-03-01T00:00:00.000Z", [0.8, 0.78, 0.3, 0.6, 0.7, 0.72]);

  it("ogni esito dichiara di essere autovalutazione, non un controllo", () => {
    const result = runCheck(a1AgriculturalActivity, input(points, a1AgriculturalActivity));
    assert.equal(result.assessment, "self_assessment");
  });

  it("ogni esito elenca le scene realmente usate", () => {
    const result = runCheck(a1AgriculturalActivity, input(points, a1AgriculturalActivity));
    assert.ok(result.scenes.length > 0);
    for (const scene of result.scenes) {
      assert.ok(scene.sceneId);
      assert.ok(scene.sensedAt);
      assert.equal(typeof scene.validPixels, "number");
    }
  });

  it("ogni esito porta con sé la serie grezza da ispezionare", () => {
    const result = runCheck(a1AgriculturalActivity, input(points, a1AgriculturalActivity));
    assert.ok(result.series);
    assert.equal(result.series?.points.length, points.length);
  });

  it("ogni esito dichiara la norma e la finestra osservata", () => {
    const result = runCheck(b3Gaec6SoilCover, input(points, b3Gaec6SoilCover));
    assert.ok(result.reference.act.includes("2021/2115"));
    assert.equal(result.window.from, "2026-11-15");
    assert.equal(result.window.to, "2027-02-15");
  });
});

describe("compliance / 'non decidibile' è una porta, non un punteggio basso", () => {
  it("senza scene utili non si decide, e si dice che cosa manca", () => {
    const result = runCheck(
      a1AgriculturalActivity,
      input(series("2026-03-01T00:00:00.000Z", [0.5, 0.5]), a1AgriculturalActivity),
    );
    assert.equal(result.outcome, "undecidable");
    assert.ok(result.missing.some((m) => m.what.id === "missing.noUsableScenes"));
    assert.equal(result.missing[0].where, "archive");
  });

  it("un appezzamento troppo piccolo non produce un verdetto a bassa confidenza", () => {
    // È la distinzione centrale del modello: qui il metodo NON gira. Un numero
    // calcolato su quattro pixel misti sarebbe peggio del silenzio.
    const result = runCheck(
      a1AgriculturalActivity,
      input(
        series("2026-03-01T00:00:00.000Z", [0.8, 0.78, 0.3, 0.6, 0.7, 0.72]),
        a1AgriculturalActivity,
        { plot: { id: "plot-1", name: "Fazzoletto", areaHa: 0.1 } },
      ),
    );
    assert.equal(result.outcome, "undecidable");
    assert.ok(
      result.missing.some((m) => m.what.id === "missing.tooFewPurePixels"),
      "deve dire che i pixel puri non bastano",
    );
    assert.equal(
      result.missing.find((m) => m.what.id === "missing.tooFewPurePixels")?.what
        .values?.minPurePixels,
      MIN_PURE_PIXELS,
    );
  });

  it("anche quando non decide, spiega perché: la confidenza si calcola comunque", () => {
    const result = runCheck(
      a1AgriculturalActivity,
      input(series("2026-03-01T00:00:00.000Z", [0.5, 0.5]), a1AgriculturalActivity),
    );
    assert.ok(result.confidence.factors.length > 0);
    assert.ok(result.confidence.limitedBy.includes("scene_count"));
  });

  it("ogni dato mancante dice dove si completa e come", () => {
    const result = runCheck(
      a1AgriculturalActivity,
      input(series("2026-03-01T00:00:00.000Z", [0.5]), a1AgriculturalActivity),
    );
    for (const missing of result.missing) {
      assert.ok(missing.what.id);
      assert.ok(missing.howToFix.id);
      assert.ok(missing.where);
    }
  });
});

describe("compliance / A1 attività agricola", () => {
  it("un evento di gestione basta a dire che la superficie è lavorata", () => {
    const result = runCheck(
      a1AgriculturalActivity,
      input(
        series("2026-03-01T00:00:00.000Z", [0.75, 0.8, 0.82, 0.3, 0.45, 0.6, 0.65]),
        a1AgriculturalActivity,
      ),
    );
    assert.equal(result.outcome, "compliant");
    assert.equal(result.explanation.id, "explain.a1Active");
  });

  it("verde tutto l'anno SENZA eventi è la firma dell'abbandono", () => {
    // Il punto del metodo: un incolto invaso ha NDVI alto e stabile, più alto
    // di un seminativo appena arato. Guardare il livello e non la dinamica
    // darebbe qui la risposta esattamente rovesciata.
    const result = runCheck(
      a1AgriculturalActivity,
      input(
        series("2026-03-01T00:00:00.000Z", [0.72, 0.74, 0.73, 0.75, 0.74, 0.73, 0.74, 0.72]),
        a1AgriculturalActivity,
      ),
    );
    assert.equal(result.outcome, "non_compliant");
    assert.equal(result.explanation.id, "explain.a1Abandoned");
  });

  it("un profilo che oscilla senza eventi netti resta 'attenzione'", () => {
    // Un evento può essere caduto in un buco di nuvole: non è una
    // contestazione, è un invito a guardare.
    const result = runCheck(
      a1AgriculturalActivity,
      input(
        series("2026-03-01T00:00:00.000Z", [0.2, 0.3, 0.42, 0.5, 0.45, 0.35, 0.25]),
        a1AgriculturalActivity,
      ),
    );
    assert.equal(result.outcome, "attention");
  });
});

describe("compliance / B3 copertura minima del suolo (BCAA 6)", () => {
  /** Finestra sensibile italiana: 15/11 → 15/02. */
  function winterSeries(values: number[]): IndexSeriesPoint[] {
    return series("2026-11-16T00:00:00.000Z", values, 10);
  }

  it("suolo coperto per quasi tutta la finestra: conforme", () => {
    const result = runCheck(
      b3Gaec6SoilCover,
      input(winterSeries([0.5, 0.55, 0.6, 0.58, 0.52, 0.5, 0.48]), b3Gaec6SoilCover),
    );
    assert.equal(result.outcome, "compliant");
    assert.equal(result.explanation.id, "explain.b3Covered");
  });

  it("suolo nudo per tutta la finestra: non conforme", () => {
    const result = runCheck(
      b3Gaec6SoilCover,
      input(winterSeries([0.12, 0.1, 0.11, 0.13, 0.1, 0.12, 0.11]), b3Gaec6SoilCover),
    );
    assert.equal(result.outcome, "non_compliant");
    assert.equal(result.explanation.id, "explain.b3Bare");
  });

  it("il periodo sensibile è un parametro, non una costante del codice", () => {
    // Lo fissa lo Stato membro: un'installazione in un altro paese deve poterlo
    // spostare senza toccare il codice.
    const parameters = resolveParameters(b3Gaec6SoilCover, {
      b3_gaec6_soil_cover: { coverWindowStart: 1001, coverWindowEnd: 301 },
    });
    const window = b3Gaec6SoilCover.window(2026, parameters);
    assert.equal(window.from, "2026-10-01");
    assert.equal(window.to, "2027-03-01");
  });
});

describe("compliance / D1 sfalci su prato permanente", () => {
  it("conta gli sfalci come cali con ricrescita", () => {
    const result = runCheck(
      d1MowingGrazing,
      input(
        series("2026-04-01T00:00:00.000Z", [
          0.8, 0.82, 0.4, 0.6, 0.78, 0.8, 0.42, 0.62, 0.75,
        ]),
        d1MowingGrazing,
      ),
    );
    assert.equal(result.outcome, "compliant");
    assert.equal(result.explanation.values?.events, 2);
  });

  it("nessun evento vale 'attenzione', non 'non conforme'", () => {
    // Il pascolamento estensivo abbassa la biomassa gradualmente e può non
    // produrre alcun gradino: accusare sarebbe sbagliato.
    const result = runCheck(
      d1MowingGrazing,
      input(
        series("2026-04-01T00:00:00.000Z", [
          0.7, 0.72, 0.71, 0.73, 0.72, 0.7, 0.69, 0.71, 0.7,
        ]),
        d1MowingGrazing,
      ),
    );
    assert.equal(result.outcome, "attention");
  });

  it("pesa il buco temporale più delle altre schede, e lo dichiara", () => {
    const result = runCheck(
      d1MowingGrazing,
      input(
        series("2026-04-01T00:00:00.000Z", [
          0.8, 0.82, 0.4, 0.6, 0.78, 0.8, 0.42, 0.62, 0.75,
        ]),
        d1MowingGrazing,
      ),
    );
    const gaps = result.confidence.factors.filter((f) => f.id === "temporal_gap");
    assert.equal(gaps.length, 2, "il fattore comune più quello pesato dalla scheda");
    assert.equal(Math.max(...gaps.map((g) => g.weight)), 2);
  });
});

describe("compliance / catalogo data-driven ed estendibile", () => {
  it("filtra le schede per paese: la BCAA italiana non è quella francese", () => {
    const registry = new CheckRegistry([a1AgriculturalActivity, b3Gaec6SoilCover]);
    assert.equal(registry.list({ country: "IT" }).length, 2);
    // La B3 dichiara i periodi sensibili italiani: in Francia non si applica
    // così com'è, e sparisce dal catalogo invece di dare un esito sbagliato.
    assert.deepEqual(
      registry.list({ country: "FR" }).map((s) => s.id),
      ["a1_agricultural_activity"],
    );
  });

  it("accetta una scheda da plugin senza modifiche al core", () => {
    const registry = new CheckRegistry([a1AgriculturalActivity]);
    const fromPlugin: CheckSpec = {
      ...b3Gaec6SoilCover,
      id: "consortium_custom_rule",
    };
    registry.register(fromPlugin, "plugin");
    assert.equal(registry.sourceOf("consortium_custom_rule"), "plugin");
    assert.equal(registry.unregister("consortium_custom_rule"), true);
  });

  it("un plugin non può rimpiazzare in silenzio una scheda del core", () => {
    // Gli esiti finiscono in un export che l'utente mostra a terzi: cambiare il
    // significato di una scheda senza dirlo è il modo peggiore di sbagliare.
    const registry = new CheckRegistry([a1AgriculturalActivity]);
    assert.throws(
      () => registry.register({ ...a1AgriculturalActivity }, "plugin"),
      /duplicata/,
    );
    assert.throws(() => registry.unregister("a1_agricultural_activity"), /core/);
  });

  it("dichiara indici e anni di archivio richiesti, per dirlo PRIMA all'utente", () => {
    const registry = new CheckRegistry([
      a1AgriculturalActivity,
      b3Gaec6SoilCover,
      d1MowingGrazing,
    ]);
    assert.deepEqual(registry.requiredIndices(), ["ndvi"]);
    assert.equal(registry.requiredArchiveYears(), 1);
  });
});

describe("compliance / catalogo completo", () => {
  const registry = coreCheckRegistry();

  it("copre ammissibilità, condizionalità, eco-schemi, trasversali e biologico", () => {
    const ids = CORE_CHECKS.map((s) => s.id);
    for (const prefix of ["a1_", "a2_", "a3_", "b1_", "b2_", "b3_", "b4_", "b5_", "b6_", "b7_", "b8_", "c1_", "c2_", "c3_", "d1_", "d2_", "d3_", "d4_"]) {
      assert.ok(
        ids.some((id) => id.startsWith(prefix)),
        `manca la scheda ${prefix}`,
      );
    }
    assert.ok(ids.includes("organic_inputs"));
  });

  it("ogni scheda dichiara norma, oggetto, metodo e osservabilità", () => {
    // È la promessa del modulo: nessun numero senza provenienza, e nessuna
    // scheda che non dica in anticipo quanto ci si può fidare.
    for (const spec of CORE_CHECKS) {
      assert.ok(spec.reference.act, spec.id);
      assert.ok(spec.subject.id.startsWith("subject."), spec.id);
      assert.ok(spec.method.id.startsWith("method."), spec.id);
      assert.ok(["high", "medium", "low"].includes(spec.observability), spec.id);
    }
  });

  it("nessuna soglia è una costante sepolta: ogni parametro ha estremi e descrizione", () => {
    for (const spec of CORE_CHECKS) {
      for (const parameter of spec.parameters) {
        assert.ok(parameter.min < parameter.max, `${spec.id}/${parameter.id}`);
        assert.ok(
          parameter.defaultValue >= parameter.min &&
            parameter.defaultValue <= parameter.max,
          `${spec.id}/${parameter.id}: default fuori dagli estremi`,
        );
        assert.ok(
          parameter.description.id.startsWith("parameter."),
          `${spec.id}/${parameter.id}`,
        );
      }
    }
  });

  it("le schede italiane spariscono dal catalogo francese", () => {
    // Gli eco-schemi e i periodi sensibili sono nazionali: riusarli altrove
    // darebbe un esito sbagliato con l'aria di essere giusto.
    const italian = registry.list({ country: "IT" }).map((s) => s.id);
    const french = registry.list({ country: "FR" }).map((s) => s.id);
    assert.ok(italian.includes("c1_orchard_ground_cover"));
    assert.ok(!french.includes("c1_orchard_ground_cover"));
    assert.ok(!french.includes("b3_gaec6_soil_cover"));
    // Gli obblighi unionali restano ovunque.
    assert.ok(french.includes("a1_agricultural_activity"));
  });

  it("dichiara in anticipo le bande e gli anni di archivio che servono", () => {
    // È il numero da mostrare PRIMA di lanciare un'analisi che scarica scene
    // storiche: la cache locale ne tiene 24 mesi, il resto è rete.
    const indices = registry.requiredIndices();
    assert.ok(indices.includes("ndvi"));
    assert.ok(indices.includes("ndmi"));
    assert.ok(indices.includes("nbr"), "la B8 richiede NBR, e quindi B12");
    assert.equal(registry.requiredArchiveYears() >= 6, true, "la EUDR risale al 2020");
  });

  it("la B8 è l'unica a chiedere B12, e lo dichiara", () => {
    // L'estensione della pipeline è una decisione, non un effetto collaterale.
    const withNbr = CORE_CHECKS.filter((s) => s.requires.indices.includes("nbr"));
    assert.deepEqual(
      withNbr.map((s) => s.id),
      ["b8_gaec3_stubble_burning"],
    );
    assert.deepEqual(REQUIRED_BANDS.nbr, { a: "B08", b: "B12" });
    assert.ok(requiredBandsForIndices(["nbr"]).includes("B12"));
    // Nessun altro indice tira dentro B12: attivare la B8 è un costo esplicito.
    assert.ok(!requiredBandsForIndices(["ndvi", "ndre", "ndwi", "ndmi"]).includes("B12"));
  });
});

describe("compliance / le schede che dichiarano di non poter decidere", () => {
  const points = series("2026-03-01T00:00:00.000Z", [0.8, 0.78, 0.3, 0.6, 0.7, 0.72, 0.7, 0.68]);

  it("B5 — gli elementi non produttivi non si risolvono a 10 m, e lo dice", () => {
    // Non è un fallimento: sapere quale controllo NON si può anticipare vale
    // quanto sapere gli altri.
    const result = runCheck(b5Gaec8NonProductive, input(points, b5Gaec8NonProductive));
    assert.equal(result.outcome, "undecidable");
    assert.equal(result.observability, "low");
    assert.ok(result.missing.some((m) => m.what.id === "missing.resolutionTooCoarse"));
    assert.equal(result.missing[0].where, "pipeline");
  });

  it("D4 — l'irrigazione richiederebbe SAR o termico, non l'ottico", () => {
    const summer = series("2026-05-05T00:00:00.000Z", [0.4, 0.42, 0.38, 0.41, 0.39, 0.4, 0.42]).map(
      (p) => ({ ...p, values: { ndmi: p.values.ndvi ?? 0.4 } }),
    );
    const result = runCheck(
      d4Irrigation,
      input(summer, d4Irrigation, { series: { plotId: "plot-1", points: summer } }),
    );
    assert.equal(result.outcome, "undecidable");
    assert.ok(result.missing.some((m) => m.what.id === "missing.sensorNotAvailable"));
  });

  it("l'osservabilità bassa mette un tetto alla confidenza dichiarata", () => {
    const result = runCheck(b5Gaec8NonProductive, input(points, b5Gaec8NonProductive));
    assert.ok(result.confidence.value <= OBSERVABILITY_CEILING.low);
  });

  it("B8 senza NBR in cache non tace: dice che manca la banda", () => {
    // Le scene elaborate prima che la scheda fosse attivata non portano B12.
    const result = runCheck(b8Gaec3StubbleBurning, input(
      series("2026-07-01T00:00:00.000Z", [0.6, 0.55, 0.5, 0.45, 0.4]),
      b8Gaec3StubbleBurning,
    ));
    assert.equal(result.outcome, "undecidable");
    assert.ok(result.missing.some((m) => m.what.id === "missing.indexNotInPipeline"));
    assert.equal(result.missing[0].where, "pipeline");
  });
});
