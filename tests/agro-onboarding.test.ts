import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCompanySnapshot, type Company, type CompanySnapshot } from "@agrogea/core";
import {
  companyInputFromDraft,
  companyInputFromSnapshot,
  emptyCompanyDraft,
  validateCompanyDraft,
  type CompanyDraft,
} from "../apps/agro-field-suite/src/modules/onboarding/onboarding";

/**
 * Primo avvio: validazione dei dati aziendali minimi e ricostruzione
 * dell'anagrafica da un backup.
 */

function draft(overrides: Partial<CompanyDraft> = {}): CompanyDraft {
  return {
    businessName: "Maatschap De Boer",
    country: "NL",
    city: "Veghel",
    vatNumber: "NL123456789B01",
    ...overrides,
  };
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-1",
    tenant_id: "tenant-1",
    business_name: "Maatschap De Boer",
    national_company_id: null,
    vat_number: "NL123456789B01",
    legal_form: null,
    address: "Dorpsstraat 1",
    city: "Veghel",
    province: "Noord-Brabant",
    region: null,
    postal_code: "5461",
    country: "NL",
    email: null,
    pec: null,
    sdi_code: null,
    centroid: null,
    certifications: [],
    operator_certifications: [],
    farm_file_id: null,
    paying_agency: null,
    contact_name: null,
    contact_role: null,
    created_at: "2026-09-01T08:00:00.000Z",
    updated_at: "2026-09-01T08:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Company> = {}): CompanySnapshot {
  return emptyCompanySnapshot(company(overrides));
}

describe("primo avvio / validazione", () => {
  it("la bozza vuota non è valida, ma non esplode", () => {
    const issues = validateCompanyDraft(emptyCompanyDraft());
    assert.equal(issues.length, 2);
    assert.deepEqual(
      issues.map((i) => i.field).sort(),
      ["businessName", "country"],
    );
  });

  it("accetta i due soli campi che servono davvero", () => {
    // Nome e paese: il resto si compila poi, dall'anagrafica.
    assert.deepEqual(
      validateCompanyDraft({
        businessName: "Az. Rossi",
        country: "IT",
        city: "",
        vatNumber: "",
      }),
      [],
    );
  });

  it("pretende un nome non fatto di soli spazi", () => {
    const issues = validateCompanyDraft(draft({ businessName: "   " }));
    assert.equal(issues[0]?.field, "businessName");
  });

  it("pretende un paese ISO reale", () => {
    // "ZZ" è user-assigned, non un paese: accettarlo significherebbe proporre
    // un catalogo di fonti inesistente.
    for (const country of ["", "ZZ", "Olanda", "NLD"]) {
      const issues = validateCompanyDraft(draft({ country }));
      assert.ok(
        issues.some((i) => i.field === "country"),
        `"${country}" doveva essere respinto`,
      );
    }
  });

  it("accetta il paese anche scritto in minuscolo", () => {
    assert.deepEqual(validateCompanyDraft(draft({ country: "nl" })), []);
  });
});

describe("primo avvio / nuova azienda", () => {
  it("normalizza il paese in maiuscolo", () => {
    assert.equal(companyInputFromDraft(draft({ country: "nl" })).country, "NL");
  });

  it("ripulisce gli spazi e riduce i campi vuoti a null", () => {
    const input = companyInputFromDraft(
      draft({ businessName: "  Az. Rossi  ", city: "   ", vatNumber: "" }),
    );
    assert.equal(input.business_name, "Az. Rossi");
    assert.equal(input.city, null);
    assert.equal(input.vat_number, null);
  });

  it("il comune è un dato, non un vincolo", () => {
    // Finisce in `city` e in nessun altro posto: non filtra le fonti, non
    // limita dove possono stare i campi.
    const input = companyInputFromDraft(draft({ city: "Veghel" }));
    assert.equal(input.city, "Veghel");
    assert.deepEqual(Object.keys(input).sort(), [
      "business_name",
      "city",
      "country",
      "vat_number",
    ]);
  });
});

describe("primo avvio / ripristino da backup", () => {
  it("l'azienda rinasce con il nome e il paese che aveva", () => {
    const input = companyInputFromSnapshot(snapshot(), "Ripiego");
    assert.equal(input.business_name, "Maatschap De Boer");
    assert.equal(input.country, "NL");
    assert.equal(input.city, "Veghel");
    assert.equal(input.province, "Noord-Brabant");
  });

  it("un nome mancante non fa perdere il resto del backup", () => {
    // Rifiutare l'intero ripristino per un campo vuoto sarebbe sproporzionato:
    // i dati agronomici sono comunque recuperabili.
    const input = companyInputFromSnapshot(
      snapshot({ business_name: "   " }),
      "Ripiego",
    );
    assert.equal(input.business_name, "Ripiego");
  });

  it("un paese non valido nel file diventa null, non un valore inventato", () => {
    for (const country of ["ZZ", "", null]) {
      const input = companyInputFromSnapshot(
        snapshot({ country }),
        "Ripiego",
      );
      assert.equal(input.country, null, String(country));
    }
  });

  it("normalizza un paese scritto in minuscolo nel file", () => {
    assert.equal(
      companyInputFromSnapshot(snapshot({ country: "nl" }), "Ripiego").country,
      "NL",
    );
  });

  it("la certificazione dell'operatore torna sull'azienda ricostruita", () => {
    // Il ripristino CREA una nuova azienda: se la certificazione non passa da
    // qui, il file la contiene ma il device la perde — che è peggio di non
    // averla mai esportata.
    const certification = {
      scheme: "organic",
      operator_code: "IT-BIO-009-12345",
      control_body: "Bioagricert",
      certificate_number: "CERT-2026-77",
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
    };
    const input = companyInputFromSnapshot(
      snapshot({ operator_certifications: [certification] }),
      "Ripiego",
    );
    assert.deepEqual(input.operator_certifications, [certification]);
  });

  it("un backup più vecchio non porta certificazioni inventate", () => {
    const senzaCampo = snapshot();
    delete (senzaCampo.company as Partial<Company>).operator_certifications;
    assert.deepEqual(
      companyInputFromSnapshot(senzaCampo, "Ripiego").operator_certifications,
      [],
    );
  });
});
