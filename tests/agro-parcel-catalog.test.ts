import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARCEL_SOURCE_CATALOG,
  nutsCovers,
  sourceById,
  sourcesCovering,
  validateCatalog,
  validateSourceRecord,
  type ParcelSourceIssue,
  type ParcelSourceRecord,
} from "@agrogea/parcel";

/**
 * Catalogo delle fonti (@agrogea/parcel): validazione strutturale, unicità degli
 * id e risoluzione per nodo NUTS. Nessuna rete — che gli endpoint rispondano
 * davvero è compito dello script di verifica live, non della suite.
 */

/** Record valido di riferimento, da sporcare campo per campo nei test. */
function validRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "nl-example-source",
    nuts: ["NL"],
    name: "Fonte di esempio",
    accessType: "wfs",
    endpoint: "https://example.org/wfs",
    featureType: "lu:ExistingLandUseObject",
    crs: "EPSG:28992",
    referenceUnitType: "agricultural_parcel",
    license: { id: "CC0-1.0", attribution: "Ente pubblicatore" },
    attributeMap: { sourceId: "inspireId" },
    updateCadence: "annual",
    lastVerified: null,
    ...overrides,
  };
}

/** Percorsi dei problemi rilevati, per asserire su COSA è stato segnalato. */
function paths(issues: readonly ParcelSourceIssue[]): string[] {
  return issues.map((i) => i.path).sort();
}

describe("catalogo particelle / il catalogo spedito è valido", () => {
  it("ogni record passa la validazione strutturale", () => {
    const issues = validateCatalog(PARCEL_SOURCE_CATALOG);
    // Il messaggio dell'assert riporta i problemi: chi rompe un record vede
    // subito quale campo di quale file, senza rileggere il test.
    assert.deepEqual(
      issues,
      [],
      `catalogo non valido:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
    );
  });

  it("contiene il pilota olandese, con licenza e attribuzione", () => {
    const nl = sourceById("nl-brp-gewaspercelen");
    assert.ok(nl, "atteso il record nl-brp-gewaspercelen");
    assert.equal(nl?.accessType, "wfs");
    // EPSG:4258 e non 28992: è il DefaultCRS che il servizio dichiara davvero
    // nel suo GetCapabilities (28992 è solo uno degli OtherCRS).
    assert.equal(nl?.crs, "EPSG:4258");
    assert.equal(nl?.referenceUnitType, "agricultural_parcel");
    assert.equal(nl?.license.id, "CC0-1.0");
    assert.equal(nl?.license.attribution, "RVO / PDOK");
    // Senza identificativo nativo non si potrebbe deduplicare un'adozione.
    assert.ok(nl?.attributeMap.sourceId);
  });

  it("nessuna fonte si dichiara già verificata senza esserlo stata", () => {
    // lastVerified lo scrive la verifica live: a mano resta null.
    for (const source of PARCEL_SOURCE_CATALOG) {
      if (source.lastVerified !== null) {
        assert.ok(
          !Number.isNaN(Date.parse(source.lastVerified)),
          `${source.id}: lastVerified non è un istante ISO`,
        );
      }
    }
  });

  it("sourceById ritorna null per un id sconosciuto", () => {
    assert.equal(sourceById("non-esiste"), null);
  });
});

describe("catalogo particelle / copertura per nodo NUTS", () => {
  it("la copertura si eredita verso il basso", () => {
    assert.equal(nutsCovers("NL", "NL32"), true);
    assert.equal(nutsCovers("NL", "NL"), true);
    assert.equal(nutsCovers("DE1", "DE11"), true);
  });

  it("non risale la gerarchia né sconfina fra rami", () => {
    // Una fonte su un solo Land non può rispondere per tutta la Germania…
    assert.equal(nutsCovers("DE1", "DE"), false);
    // …né per il Land accanto.
    assert.equal(nutsCovers("DE1", "DE2"), false);
    assert.equal(nutsCovers("NL", "BE"), false);
  });

  it("una fonte nazionale risponde per i suoi nodi figli", () => {
    // NL32 (Noord-Holland) deve trovare la fonte dichiarata su "NL".
    const found = sourcesCovering("NL32");
    assert.ok(
      found.some((s) => s.id === "nl-brp-gewaspercelen"),
      "attesa la fonte nazionale olandese per NL32",
    );
  });

  it("un nodo di un altro paese non trova nulla", () => {
    assert.deepEqual(sourcesCovering("FRK2"), []);
  });
});

describe("catalogo particelle / validazione di un record", () => {
  it("accetta un record ben formato", () => {
    assert.deepEqual(validateSourceRecord(validRecord()), []);
  });

  it("rifiuta ciò che non è un oggetto", () => {
    for (const bogus of [null, undefined, 42, "record", []]) {
      const issues = validateSourceRecord(bogus);
      assert.equal(issues.length, 1, String(bogus));
      assert.match(issues[0].message, /non è un oggetto/);
    }
  });

  it("segnala TUTTI i problemi in una volta, non solo il primo", () => {
    const issues = validateSourceRecord(
      validRecord({ id: "NL Brp", crs: "28992", updateCadence: "ogni tanto" }),
    );
    assert.deepEqual(paths(issues), ["crs", "id", "updateCadence"]);
  });

  it("intercetta i refusi nei nomi dei campi", () => {
    const issues = validateSourceRecord(validRecord({ endPoint: "https://x.org" }));
    assert.ok(issues.some((i) => i.path === "endPoint"));
  });

  it("intercetta i refusi dentro attributeMap", () => {
    const issues = validateSourceRecord(
      validRecord({ attributeMap: { sourceId: "id", cropCode: "gewas" } }),
    );
    assert.ok(issues.some((i) => i.path === "attributeMap.cropCode"));
  });

  it("pretende sourceId nella mappa degli attributi", () => {
    const issues = validateSourceRecord(
      validRecord({ attributeMap: { nationalCropCode: "gewas" } }),
    );
    assert.ok(issues.some((i) => i.path === "attributeMap.sourceId"));
  });

  it("pretende licenza e attribuzione", () => {
    const issues = validateSourceRecord(
      validRecord({ license: { id: "CC0-1.0" } }),
    );
    assert.ok(issues.some((i) => i.path === "license.attribution"));
  });

  it("lega featureType al modo di accesso", () => {
    // Un WFS senza tipo di feature non è interrogabile…
    const wfs = validateSourceRecord(validRecord({ featureType: null }));
    assert.ok(wfs.some((i) => i.path === "featureType"));
    // …e un download ATOM non ne ha uno.
    const atom = validateSourceRecord(
      validRecord({ accessType: "atom", featureType: "lu:Qualcosa" }),
    );
    assert.ok(atom.some((i) => i.path === "featureType"));
    assert.deepEqual(
      validateSourceRecord(validRecord({ accessType: "atom", featureType: null })),
      [],
    );
  });

  it("rifiuta una fonte che si dichiara \"manual\"", () => {
    // La digitalizzazione a mano non esce da un portale pubblico.
    const issues = validateSourceRecord(
      validRecord({ referenceUnitType: "manual" }),
    );
    assert.ok(issues.some((i) => i.path === "referenceUnitType"));
  });

  it("accetta i codici NUTS che non coincidono con l'ISO (EL, UK)", () => {
    // Eurostat usa EL per la Grecia e UK per il Regno Unito: senza l'eccezione
    // un record greco valido verrebbe respinto.
    assert.deepEqual(validateSourceRecord(validRecord({ nuts: ["EL"] })), []);
    assert.deepEqual(validateSourceRecord(validRecord({ nuts: ["UKI"] })), []);
  });

  it("respinge un paese inesistente in un codice NUTS", () => {
    const issues = validateSourceRecord(validRecord({ nuts: ["ZZ1"] }));
    assert.ok(issues.some((i) => i.path === "nuts[0]"));
  });

  it("respinge un endpoint che non è http(s)", () => {
    for (const endpoint of ["file:///etc/passwd", "ftp://x.org", "non-un-url"]) {
      const issues = validateSourceRecord(validRecord({ endpoint }));
      assert.ok(issues.some((i) => i.path === "endpoint"), endpoint);
    }
  });
});

describe("catalogo particelle / validazione dell'insieme", () => {
  it("prefissa i problemi con l'id, per dire quale file aprire", () => {
    const issues = validateCatalog([validRecord({ crs: "sbagliato" })]);
    assert.deepEqual(paths(issues), ["nl-example-source.crs"]);
  });

  it("usa la posizione quando manca pure l'id", () => {
    const record = validRecord();
    delete record.id;
    const issues = validateCatalog([record]);
    assert.ok(issues.every((i) => i.path.startsWith("[0]")));
  });

  it("intercetta gli id duplicati, che nessun record può vedere da solo", () => {
    const issues = validateCatalog([validRecord(), validRecord()]);
    assert.ok(issues.some((i) => /duplicato/.test(i.message)));
  });

  it("un catalogo vuoto non è un errore", () => {
    assert.deepEqual(validateCatalog([]), []);
  });
});

describe("catalogo particelle / il tipo del record", () => {
  it("il catalogo è tipato come ParcelSourceRecord", () => {
    // Verifica di TIPO: se PARCEL_SOURCE_CATALOG perdesse la sua forma, questo
    // file non compilerebbe più sotto `npm run typecheck`.
    const first: ParcelSourceRecord | undefined = PARCEL_SOURCE_CATALOG[0];
    assert.ok(first);
    assert.equal(typeof first.endpoint, "string");
  });
});
