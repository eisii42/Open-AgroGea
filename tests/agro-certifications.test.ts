import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  conversionEndsOn,
  findOperatorCertification,
  isCertificationValid,
  isOrganicRegime,
  isProductionRegime,
  readOperatorCertifications,
  withOperatorCertification,
  type Company,
  type OperatorCertification,
} from "../packages/agro-core/src";

/**
 * Certificazione dell'OPERATORE (azienda) e regime di produzione dell'ANNATA
 * (campagna): i due dati con cui la v24 sostituisce il morto
 * `companies.certifications text[]`.
 *
 * Due cose vanno dimostrate, e nessuna delle due si vede leggendo lo schema:
 *   * il motore puro non si fida del jsonb, che può contenere qualunque cosa;
 *   * `upsertCampoCampagna` CONSERVA il regime quando chi scrive non lo
 *     conosce — l'import del Fascicolo, il ripristino di un backup più vecchio,
 *     la chiusura di una sessione di campo. Senza questa distinzione fra "non
 *     passato" e "passato a null" ogni riscrittura lo cancellerebbe in
 *     silenzio, ed è esattamente il tipo di perdita che questa versione chiude.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

class TestDal extends AgroDal {
  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    return new TestDal(db, TENANT, "device-test");
  }
}

function certification(
  overrides: Partial<OperatorCertification> = {},
): OperatorCertification {
  return {
    scheme: "organic",
    operator_code: "IT-BIO-009-12345",
    control_body: "Bioagricert",
    certificate_number: "CERT-2026-77",
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
    ...overrides,
  };
}

/** Azienda con un plot e una crop già pronti per le campagne. */
async function seedPlot(dal: TestDal): Promise<{ plotId: string; cropId: string }> {
  const company = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name, country)
     values (gen_random_uuid(), $1, 'Azienda Test', 'IT') returning id`,
    [TENANT],
  );
  const crop = await dal.rawQuery<{ id: string }>(
    `insert into crops (id, tenant_id, common_name)
     values (gen_random_uuid(), $1, 'Vite') returning id`,
    [TENANT],
  );
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1',
             '{"type":"Polygon","coordinates":[[[11,43],[11.01,43],[11.01,43.01],[11,43]]]}'::jsonb,
             2.5)
     returning id`,
    [TENANT, company.rows[0].id],
  );
  return { plotId: plot.rows[0].id, cropId: crop.rows[0].id };
}

describe("certificazione dell'operatore / lettura difensiva del jsonb", () => {
  it("scarta ciò che non è una certificazione riconoscibile", () => {
    const company = {
      operator_certifications: [
        certification(),
        // Un file manomesso, o una versione futura del formato: si scartano,
        // non si propagano come dati mezzo validi.
        null,
        "organic",
        { control_body: "Senza schema" },
        { scheme: "   " },
      ],
    } as unknown as Company;
    const read = readOperatorCertifications(company);
    assert.equal(read.length, 1);
    assert.equal(read[0].control_body, "Bioagricert");
  });

  it("i campi vuoti diventano null, non stringhe vuote", () => {
    const company = {
      operator_certifications: [{ scheme: "organic", control_body: "  " }],
    } as unknown as Company;
    assert.deepEqual(readOperatorCertifications(company), [
      {
        scheme: "organic",
        operator_code: null,
        control_body: null,
        certificate_number: null,
        valid_from: null,
        valid_to: null,
      },
    ]);
  });

  it("un valore che non è un array vale come nessuna certificazione", () => {
    for (const raw of [null, undefined, {}, "organic", 3]) {
      const company = { operator_certifications: raw } as unknown as Company;
      assert.deepEqual(readOperatorCertifications(company), []);
    }
  });

  it("modificare uno schema non tocca gli altri", () => {
    const globalgap = certification({
      scheme: "globalgap",
      certificate_number: "GG-1",
    });
    const updated = withOperatorCertification(
      [certification(), globalgap],
      "organic",
      certification({ control_body: "ICEA" }),
    );
    assert.equal(updated.length, 2);
    assert.deepEqual(
      updated.find((c) => c.scheme === "globalgap"),
      globalgap,
    );
    assert.equal(
      updated.find((c) => c.scheme === "organic")?.control_body,
      "ICEA",
    );
  });

  it("svuotare tutti i campi rimuove la certificazione", () => {
    const emptied = certification({
      operator_code: null,
      control_body: null,
      certificate_number: null,
      valid_from: null,
      valid_to: null,
    });
    assert.deepEqual(
      withOperatorCertification([certification()], "organic", emptied),
      [],
    );
    assert.deepEqual(
      withOperatorCertification([certification()], "organic", null),
      [],
    );
  });

  it("la validità include gli estremi e un estremo mancante non scade", () => {
    const cert = certification();
    assert.equal(isCertificationValid(cert, "2026-01-01"), true);
    assert.equal(isCertificationValid(cert, "2026-12-31"), true);
    assert.equal(isCertificationValid(cert, "2025-12-31"), false);
    assert.equal(isCertificationValid(cert, "2027-01-01"), false);
    // Un certificato senza scadenza dichiarata non è scaduto.
    assert.equal(
      isCertificationValid(certification({ valid_to: null }), "2099-01-01"),
      true,
    );
  });

  it("findOperatorCertification trova lo schema chiesto e non altri", () => {
    const company = {
      operator_certifications: [certification()],
    } as unknown as Company;
    assert.equal(findOperatorCertification(company, "organic")?.scheme, "organic");
    assert.equal(findOperatorCertification(company, "globalgap"), null);
    assert.equal(findOperatorCertification(undefined, "organic"), null);
  });
});

describe("regime di produzione / conversione al biologico", () => {
  it("riconosce solo i quattro regimi previsti", () => {
    for (const r of ["conventional", "organic", "in_conversion", "integrated"]) {
      assert.equal(isProductionRegime(r), true);
    }
    for (const r of ["bio", "", null, 1, "ORGANIC"]) {
      assert.equal(isProductionRegime(r), false);
    }
  });

  it("bio e in conversione contano entrambi come regime biologico", () => {
    assert.equal(isOrganicRegime("organic"), true);
    assert.equal(isOrganicRegime("in_conversion"), true);
    assert.equal(isOrganicRegime("conventional"), false);
    assert.equal(isOrganicRegime(null), false);
  });

  it("la conversione dura 24 mesi per le annuali e 36 per le perenni", () => {
    // Reg. UE 2018/848, All. II parte I punto 1.7.
    const campaign = { regime_since: "2025-04-01" };
    assert.equal(conversionEndsOn(campaign, "annual"), "2027-04-01");
    assert.equal(conversionEndsOn(campaign, "perennial"), "2028-04-01");
  });

  it("senza data d'inizio non si inventa una fine conversione", () => {
    // È il presupposto dell'esito "non decidibile": meglio dire che manca il
    // dato che restituire una data plausibile e falsa.
    assert.equal(conversionEndsOn({ regime_since: null }, "annual"), null);
  });
});

describe("DAL / il regime sopravvive alle riscritture della campagna", () => {
  it("chi non conosce il regime non lo cancella", async () => {
    // Scenario reale: la campagna nasce dalla scheda coltura con il regime, poi
    // il re-import del Fascicolo (che il regime non ce l'ha) la riscrive.
    const dal = await TestDal.create();
    const { plotId, cropId } = await seedPlot(dal);

    await dal.upsertCampoCampagna({
      plot_id: plotId,
      crop_id: cropId,
      campaign_year: 2026,
      declared_area_ha: 2.5,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
      crop_external_code: null,
      variety_external_code: null,
      production_regime: "in_conversion",
      regime_since: "2025-04-01",
      regime_notes: "Notifica del 1° aprile 2025.",
    });

    const reimported = await dal.upsertCampoCampagna({
      plot_id: plotId,
      crop_id: cropId,
      campaign_year: 2026,
      declared_area_ha: 2.7,
      reference_parcel_external_id: "IS-1",
      agricultural_parcel_external_id: "AP-9",
      crop_external_code: "060",
      variety_external_code: null,
    });
    assert.equal(reimported.production_regime, "in_conversion");
    assert.equal(reimported.regime_since, "2025-04-01");
    assert.equal(reimported.regime_notes, "Notifica del 1° aprile 2025.");

    // E ciò che conta è la riga riletta dal database, non l'oggetto in memoria.
    const stored = await dal.listCampiCampagna({ plotId });
    assert.equal(stored[0].production_regime, "in_conversion");
    assert.equal(stored[0].regime_since, "2025-04-01");
    assert.equal(Number(stored[0].declared_area_ha), 2.7);
  });

  it("passare null è una scelta e cancella davvero il regime", async () => {
    const dal = await TestDal.create();
    const { plotId, cropId } = await seedPlot(dal);
    const input = {
      plot_id: plotId,
      crop_id: cropId,
      campaign_year: 2026,
      declared_area_ha: 2.5,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
      crop_external_code: null,
      variety_external_code: null,
    };
    await dal.upsertCampoCampagna({ ...input, production_regime: "organic" });
    await dal.upsertCampoCampagna({ ...input, production_regime: null });

    const stored = await dal.listCampiCampagna({ plotId });
    assert.equal(stored[0].production_regime, null);
  });
});

describe("DAL / la colonna deprecata certifications non si scrive più", () => {
  it("un salvataggio dell'anagrafica non tocca i valori già sul device", async () => {
    const dal = await TestDal.create();
    const inserted = await dal.rawQuery<{ id: string }>(
      `insert into companies (id, tenant_id, business_name, certifications)
       values (gen_random_uuid(), $1, 'Azienda Test', '{"bio-storico"}') returning id`,
      [TENANT],
    );
    const id = inserted.rows[0].id;
    const existing = (await dal.listAziende()).find((c) => c.id === id);
    assert.ok(existing);

    // Percorso di `updateCompany`: si riscrive la riga intera più la patch.
    const { certifications: _deprecated, ...withoutDeprecated } = existing;
    await dal.upsertCompany({
      ...withoutDeprecated,
      operator_certifications: [certification()],
    });

    const stored = (await dal.listAziende()).find((c) => c.id === id);
    // La colonna deprecata resta com'era: non la scriviamo, non la azzeriamo.
    assert.deepEqual(stored?.certifications, ["bio-storico"]);
    assert.deepEqual(stored?.operator_certifications, [certification()]);
  });
});
