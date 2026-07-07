import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import {
  dichiarativiMancanti,
  sianCompleta,
  sianMancanti,
  sistemaDichiarativo,
} from "../packages/agro-core/src/compliance/sian-campaign";
import { colturaPerAppezzamento } from "../packages/agro-core/src/store/feature-collections";
import type { CampoCampagna, Crop } from "../packages/agro-core/src/types";

/**
 * Ciclo colturale v17: chiusura della campagna al raccolto (closed_at),
 * secondo raccolto nello stesso anno (indice unico parziale sulle campagne
 * aperte), metadata estensibile dei prodotti (identità colturale sementi) e
 * risoluzione coltura→appezzamento che ignora le campagne chiuse.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

/** Espone il costruttore protetto del DAL per i test su PGlite in-memory. */
class TestDal extends AgroDal {
  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    return new TestDal(db, TENANT, "device-test");
  }
}

async function seedPlot(dal: TestDal): Promise<{ companyId: string; plotId: string }> {
  const company = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name)
     values (gen_random_uuid(), $1, 'Azienda Test') returning id`,
    [TENANT],
  );
  const companyId = company.rows[0].id;
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 3.5)
     returning id`,
    [TENANT, companyId],
  );
  return { companyId, plotId: plot.rows[0].id };
}

describe("v17 / chiusura campagna e secondo raccolto", () => {
  it("chiudiCampagna imposta closed_at; una nuova semina crea una NUOVA riga", async () => {
    const dal = await TestDal.create();
    const { plotId } = await seedPlot(dal);
    const crop = await dal.upsertCrop({
      common_name: "Frumento tenero",
      scientific_name: "Triticum aestivum",
      variety_name: "Bologna",
      crop_metadata: { category: "seminativo", densita_semina: 200 },
    });

    const prima = await dal.upsertCampoCampagna({
      plot_id: plotId,
      crop_id: crop.id,
      campaign_year: 2026,
      declared_area_ha: 3.5,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
      crop_external_code: null,
      variety_external_code: null,
    });
    assert.equal(prima.closed_at, null);

    // Raccolto → chiusura del ciclo.
    const chiusa = await dal.chiudiCampagna(prima.id);
    assert.ok(chiusa?.closed_at, "closed_at non impostato");
    // Idempotenza: richiudere una campagna chiusa è un no-op.
    assert.equal(await dal.chiudiCampagna(prima.id), null);

    // Secondo raccolto: nuova semina nello stesso anno → riga NUOVA (la
    // campagna chiusa non viene riusata né riaperta).
    const seconda = await dal.upsertCampoCampagna({
      plot_id: plotId,
      crop_id: crop.id,
      campaign_year: 2026,
      declared_area_ha: 3.5,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
      crop_external_code: null,
      variety_external_code: null,
    });
    assert.notEqual(seconda.id, prima.id);
    assert.equal(seconda.closed_at, null);

    const tutte = await dal.listCampiCampagna({ appezzamentoId: plotId });
    assert.equal(tutte.length, 2);
  });

  it("l'indice unico parziale blocca DUE campagne APERTE su stesso campo+anno", async () => {
    const dal = await TestDal.create();
    const { plotId } = await seedPlot(dal);
    const crop = await dal.upsertCrop({
      common_name: "Mais",
      scientific_name: null,
      variety_name: null,
      crop_metadata: { category: "seminativo" },
    });
    await dal.rawQuery(
      `insert into plots_campaign (tenant_id, plot_id, crop_id, campaign_year, declared_area_ha)
       values ($1, $2, $3, 2026, 1)`,
      [TENANT, plotId, crop.id],
    );
    await assert.rejects(
      dal.rawQuery(
        `insert into plots_campaign (tenant_id, plot_id, crop_id, campaign_year, declared_area_ha)
         values ($1, $2, $3, 2026, 1)`,
        [TENANT, plotId, crop.id],
      ),
    );
  });
});

describe("v17 / metadata prodotti (identità colturale sementi)", () => {
  it("upsertProdotto persiste e preserva il metadata jsonb", async () => {
    const dal = await TestDal.create();
    const { companyId } = await seedPlot(dal);
    const prodotto = await dal.upsertProdotto({
      company_id: companyId,
      category: "seed",
      name: "Frumento Bologna",
      unit: "kg",
      registration_number: null,
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      notes: null,
      metadata: {
        species: "Frumento tenero",
        scientific_name: "Triticum aestivum",
        variety_name: "Bologna",
        crop_category: "seminativo",
        min_stock: 50,
      },
    });
    const riletto = await dal.getProdotto(prodotto.id);
    assert.equal(riletto?.metadata?.["species"], "Frumento tenero");
    assert.equal(riletto?.metadata?.["crop_category"], "seminativo");
    assert.equal(riletto?.metadata?.["min_stock"], 50);

    // Update anagrafico SENZA metadata: il jsonb esistente sopravvive.
    await dal.upsertProdotto({
      id: prodotto.id,
      company_id: companyId,
      category: "seed",
      name: "Frumento Bologna (rinominato)",
      unit: "kg",
      registration_number: null,
      npk_n: null,
      npk_p: null,
      npk_k: null,
      uma_code: null,
      notes: null,
    });
    const dopo = await dal.getProdotto(prodotto.id);
    assert.equal(dopo?.metadata?.["variety_name"], "Bologna");
  });
});

describe("compliance SIAN / campi dichiarativi mancanti", () => {
  it("elenca i mancanti e riconosce la campagna completa", () => {
    const vuota = {
      crop_external_code: null,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
    };
    assert.deepEqual(sianMancanti(vuota), [
      "crop_external_code",
      "reference_parcel_external_id",
      "agricultural_parcel_external_id",
    ]);
    assert.equal(sianCompleta(vuota), false);

    // Stringhe di soli spazi = mancante (input sporco dai form).
    assert.ok(
      sianMancanti({ ...vuota, crop_external_code: "  " }).includes(
        "crop_external_code",
      ),
    );

    const completa = {
      crop_external_code: "060",
      reference_parcel_external_id: "ISL-1",
      agricultural_parcel_external_id: "APP-9",
    };
    assert.deepEqual(sianMancanti(completa), []);
    assert.equal(sianCompleta(completa), true);
  });

  it("country-aware: IT→SIAN, ES→SIEX, altri paesi senza gate", () => {
    assert.equal(sistemaDichiarativo("IT"), "SIAN");
    assert.equal(sistemaDichiarativo("ES"), "SIEX");
    assert.equal(sistemaDichiarativo("FR"), null);
    assert.equal(sistemaDichiarativo(null), null);

    const vuota = {
      crop_external_code: null,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
    };
    // Stessa terna richiesta per IT (SIAN) ed ES (SIEX/SIGPAC)...
    assert.equal(dichiarativiMancanti("IT", vuota).length, 3);
    assert.equal(dichiarativiMancanti("ES", vuota).length, 3);
    // ...nessun vincolo per i paesi senza sistema gateato.
    assert.deepEqual(dichiarativiMancanti("FR", vuota), []);
    assert.deepEqual(dichiarativiMancanti("EU", vuota), []);
  });
});

describe("v17 / colturaPerAppezzamento ignora le campagne chiuse", () => {
  it("campo con campagna chiusa = campo libero", () => {
    const crop: Crop = {
      id: "crop-1",
      tenant_id: TENANT,
      common_name: "Frumento",
      scientific_name: null,
      variety_name: null,
      crop_metadata: { category: "seminativo" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    };
    const base: CampoCampagna = {
      id: "camp-1",
      tenant_id: TENANT,
      plot_id: "plot-1",
      crop_id: "crop-1",
      campaign_year: 2026,
      reference_parcel_external_id: null,
      agricultural_parcel_external_id: null,
      crop_external_code: null,
      variety_external_code: null,
      declared_area_ha: 1,
      closed_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    };
    assert.equal(colturaPerAppezzamento("plot-1", [base], [crop]), "seminativo");
    assert.equal(
      colturaPerAppezzamento(
        "plot-1",
        [{ ...base, closed_at: "2026-07-01T00:00:00Z" }],
        [crop],
      ),
      null,
    );
  });
});
