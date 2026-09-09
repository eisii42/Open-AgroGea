import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";

/**
 * Schema locale v12 (clean rewrite EN + normalizzazione crops). Verifica che
 * lo schema inglese si applichi pulito e idempotente su un'installazione nuova,
 * che le entità di dominio abbiano la nomenclatura EU-agnostica, che la crop
 * sia normalizzata in `crops` (FK da `plots_campaign`) e che la area sia
 * un'unica colonna `area_ha` (niente più duplicati).
 */

async function tableNames(db: PGlite): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema='public' order by 1",
  );
  return r.rows.map((x) => x.table_name);
}

async function columnNames(db: PGlite, table: string): Promise<string[]> {
  const r = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name=$1 order by 1",
    [table],
  );
  return r.rows.map((x) => x.column_name);
}

describe("schema v12 / installazione nuova", () => {
  it("crea le tabelle EN ed è idempotente", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL); // due volte: idempotente
    const tables = await tableNames(db);
    for (const t of [
      "companies",
      "crops",
      "plots_registry",
      "plots_campaign",
      "treatment_logs",
      "weather_readings",
      "soil_samples",
      "infrastructure_assets",
      "harvest_logs",
      "sync_outbox",
      "weather_config",
      "dss_results",
      "data_transfer_logs",
      "product_catalogs",
    ]) {
      assert.ok(tables.includes(t), `manca la tabella ${t}`);
    }
    // Nessun residuo italo-centrico.
    for (const t of [
      "aziende",
      "appezzamenti",
      "campi_campagna",
      "registro_trattamenti",
      "raccolte",
      "letture_meteo",
      "campionamenti_suolo",
      "assets_infrastruttura",
      "outbox_mutazioni",
    ]) {
      assert.ok(!tables.includes(t), `la tabella italiana ${t} non dovrebbe esistere`);
    }
  });

  it("plots_registry: area unica area_ha, niente columns colturali", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const cols = await columnNames(db, "plots_registry");
    assert.ok(cols.includes("area_ha"), "manca area_ha");
    assert.ok(cols.includes("user_plot_name"));
    assert.ok(cols.includes("cadastral_sheet"));
    for (const c of [
      "superficie_ha",
      "area_ettari",
      "coltura",
      "varieta",
      "vite_cultivar",
      "vite_clone",
      "vite_sesto_impianto",
    ]) {
      assert.ok(!cols.includes(c), `plots_registry non dovrebbe avere ${c}`);
    }
  });

  it("crops normalizzata e referenziata da plots_campaign.crop_id", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const cropCols = await columnNames(db, "crops");
    for (const c of ["common_name", "scientific_name", "variety_name", "crop_metadata"]) {
      assert.ok(cropCols.includes(c), `crops manca ${c}`);
    }
    const campCols = await columnNames(db, "plots_campaign");
    assert.ok(campCols.includes("crop_id"), "plots_campaign manca crop_id");

    // Inserimento end-to-end: company → crop → plot → campaign con FK valide.
    const tenant = "11111111-1111-1111-1111-111111111111";
    const company = await db.query<{ id: string }>(
      "insert into companies (id, tenant_id, business_name) values (gen_random_uuid(),$1,'Az') returning id",
      [tenant],
    );
    const cid = company.rows[0].id;
    const crop = await db.query<{ id: string }>(
      "insert into crops (id, tenant_id, common_name) values (gen_random_uuid(),$1,'Vite') returning id",
      [tenant],
    );
    const plot = await db.query<{ id: string }>(
      "insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha) values (gen_random_uuid(),$1,$2,'P1','{\"type\":\"Polygon\",\"coordinates\":[]}'::jsonb, 1.2345) returning id",
      [tenant, cid],
    );
    await db.query(
      "insert into plots_campaign (tenant_id, plot_id, crop_id, campaign_year, declared_area_ha) values ($1,$2,$3,2026,1.2)",
      [tenant, plot.rows[0].id, crop.rows[0].id],
    );
    const n = await db.query<{ n: number }>(
      "select count(*)::int n from plots_campaign",
    );
    assert.equal(n.rows[0].n, 1);
  });
});

/**
 * v23 — magazzini multipli. La migrazione è ADDITIVA: `warehouses` nasce nuova
 * e `product_lots.warehouse_id` si aggiunge nullable, così i lotti già caricati
 * sui dispositivi restano validi senza migrazione di dati.
 */
describe("schema v23 / magazzini multipli", () => {
  it("crea warehouses e la colonna nullable product_lots.warehouse_id", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL); // idempotente anche con la ALTER

    assert.ok((await tableNames(db)).includes("warehouses"));
    assert.deepEqual(await columnNames(db, "warehouses"), [
      "address",
      "company_id",
      "created_at",
      "deleted_at",
      "geometry",
      "id",
      "metadata",
      "name",
      "notes",
      "tenant_id",
      "updated_at",
      "warehouse_type",
    ]);
    assert.ok((await columnNames(db, "product_lots")).includes("warehouse_id"));

    const nullable = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'product_lots' and column_name = 'warehouse_id'`,
    );
    assert.equal(nullable.rows[0].is_nullable, "YES");
  });

  it("un lotto può stare in un magazzino o restare senza collocazione", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tenant = "11111111-1111-1111-1111-111111111111";
    const company = await db.query<{ id: string }>(
      "insert into companies (id, tenant_id, business_name) values (gen_random_uuid(),$1,'Az') returning id",
      [tenant],
    );
    const cid = company.rows[0].id;
    const warehouse = await db.query<{ id: string }>(
      "insert into warehouses (id, tenant_id, company_id, name) values (gen_random_uuid(),$1,$2,'Capannone') returning id",
      [tenant, cid],
    );
    const product = await db.query<{ id: string }>(
      "insert into products (id, tenant_id, company_id, category, name) values (gen_random_uuid(),$1,$2,'other','Materiale') returning id",
      [tenant, cid],
    );
    await db.query(
      "insert into product_lots (id, tenant_id, product_id, warehouse_id, initial_quantity, quantity_on_hand) values (gen_random_uuid(),$1,$2,$3,10,10)",
      [tenant, product.rows[0].id, warehouse.rows[0].id],
    );
    await db.query(
      "insert into product_lots (id, tenant_id, product_id, initial_quantity, quantity_on_hand) values (gen_random_uuid(),$1,$2,5,5)",
      [tenant, product.rows[0].id],
    );

    const rows = await db.query<{ n: number }>(
      "select count(*)::int n from product_lots where warehouse_id is null",
    );
    assert.equal(rows.rows[0].n, 1);
  });
});

/**
 * v24 — certificazione dell'OPERATORE e regime di produzione dell'ANNATA. La
 * migrazione è ADDITIVA: `companies.certifications` (deprecata) non si tocca,
 * `operator_certifications` nasce con default `[]` e le tre colonne di
 * `plots_campaign` nascono nullable, così le campagne già sui dispositivi
 * restano valide senza migrazione di dati e senza un regime inventato.
 */
describe("schema v24 / certificazione operatore e regime di produzione", () => {
  it("aggiunge le colonne, è idempotente e non tocca certifications", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL); // due volte: idempotente con le ALTER

    const companyCols = await columnNames(db, "companies");
    assert.ok(companyCols.includes("operator_certifications"));
    // La colonna deprecata resta: sui device ci sono dati reali.
    assert.ok(companyCols.includes("certifications"));

    const campaignCols = await columnNames(db, "plots_campaign");
    for (const c of ["production_regime", "regime_since", "regime_notes"]) {
      assert.ok(campaignCols.includes(c), `plots_campaign manca ${c}`);
    }
    const nullable = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'plots_campaign'
         and column_name in ('production_regime','regime_since','regime_notes')`,
    );
    for (const row of nullable.rows) {
      assert.equal(row.is_nullable, "YES", `${row.column_name} dovrebbe essere nullable`);
    }
  });

  it("un'azienda già esistente parte da nessuna certificazione dichiarata", async () => {
    // Applicare lo schema a un'istanza che ha già dati non deve produrre né un
    // errore né un valore inventato: `[]` significa "non dichiarato".
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tenant = "11111111-1111-1111-1111-111111111111";
    await db.query(
      "insert into companies (id, tenant_id, business_name) values (gen_random_uuid(),$1,'Az')",
      [tenant],
    );
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const row = await db.query<{
      operator_certifications: unknown;
      certifications: string[];
    }>("select operator_certifications, certifications from companies");
    assert.deepEqual(row.rows[0].operator_certifications, []);
    assert.deepEqual(row.rows[0].certifications, []);
  });

  it("il regime è una colonna della CAMPAGNA: due annate, due regimi", async () => {
    // È la ragione per cui non sta su plots_registry: lì "bio dal 2024" non si
    // potrebbe scrivere senza sovrascrivere il 2023.
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tenant = "11111111-1111-1111-1111-111111111111";
    const company = await db.query<{ id: string }>(
      "insert into companies (id, tenant_id, business_name) values (gen_random_uuid(),$1,'Az') returning id",
      [tenant],
    );
    const crop = await db.query<{ id: string }>(
      "insert into crops (id, tenant_id, common_name) values (gen_random_uuid(),$1,'Vite') returning id",
      [tenant],
    );
    const plot = await db.query<{ id: string }>(
      "insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha) values (gen_random_uuid(),$1,$2,'P1','{\"type\":\"Polygon\",\"coordinates\":[]}'::jsonb, 1) returning id",
      [tenant, company.rows[0].id],
    );
    await db.query(
      `insert into plots_campaign
         (tenant_id, plot_id, crop_id, campaign_year, declared_area_ha,
          production_regime, regime_since, closed_at)
       values ($1,$2,$3,2023,1,'conventional',null,'2023-11-01T00:00:00Z'),
              ($1,$2,$3,2026,1,'in_conversion','2025-04-01',null)`,
      [tenant, plot.rows[0].id, crop.rows[0].id],
    );

    const rows = await db.query<{
      campaign_year: number;
      production_regime: string;
    }>(
      "select campaign_year, production_regime from plots_campaign order by campaign_year",
    );
    assert.deepEqual(
      rows.rows.map((r) => [r.campaign_year, r.production_regime]),
      [
        [2023, "conventional"],
        [2026, "in_conversion"],
      ],
    );
  });
});

/**
 * v25 — modulo Compliance. La migrazione è ADDITIVA e, soprattutto, aggiunge
 * UNA sola tabella: gli esiti delle schede non si persistono, perché sono
 * ricalcolabili dalle scene e dal Quaderno. Ciò che si persiste sono gli
 * override dei parametri, che sono una SCELTA dell'utente.
 */
describe("schema v25 / override dei parametri di compliance", () => {
  it("crea la tabella degli override ed è idempotente", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    assert.ok((await tableNames(db)).includes("compliance_parameter_overrides"));
    assert.deepEqual(await columnNames(db, "compliance_parameter_overrides"), [
      "check_id",
      "company_id",
      "created_at",
      "deleted_at",
      "id",
      "parameter_id",
      "tenant_id",
      "updated_at",
      "value",
    ]);
  });

  it("NON crea una tabella per gli esiti: si ricalcolano, non si conservano", async () => {
    // È la decisione motivata della fase 2: una cache ricalcolabile non
    // appartiene né all'outbox né al backup.
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tables = await tableNames(db);
    for (const t of ["compliance_results", "compliance_checks", "check_results"]) {
      assert.ok(!tables.includes(t), `la tabella ${t} non dovrebbe esistere`);
    }
  });

  it("un solo override vivo per azienda, scheda e parametro", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tenant = "11111111-1111-1111-1111-111111111111";
    const company = await db.query<{ id: string }>(
      "insert into companies (id, tenant_id, business_name) values (gen_random_uuid(),$1,'Az') returning id",
      [tenant],
    );
    const cid = company.rows[0].id;
    const insert = `insert into compliance_parameter_overrides
        (id, tenant_id, company_id, check_id, parameter_id, value)
      values (gen_random_uuid(), $1, $2, 'b3_gaec6_soil_cover', 'coverNdviThreshold', $3)`;
    await db.query(insert, [tenant, cid, 0.45]);
    await assert.rejects(() => db.query(insert, [tenant, cid, 0.5]));

    // L'indice è PARZIALE sulle righe vive: dopo un tombstone lo stesso
    // parametro può essere ri-personalizzato.
    await db.query(
      "update compliance_parameter_overrides set deleted_at = now() where company_id = $1",
      [cid],
    );
    await db.query(insert, [tenant, cid, 0.5]);
    const alive = await db.query<{ n: number }>(
      "select count(*)::int n from compliance_parameter_overrides where deleted_at is null",
    );
    assert.equal(alive.rows[0].n, 1);
  });

  it("il formato json è ammesso nel giornale dei trasferimenti", async () => {
    // Il report di autovalutazione è un JSON: il CHECK va allargato, e lo si fa
    // con lo stesso pattern idempotente della v13 e della v14.
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const tenant = "11111111-1111-1111-1111-111111111111";
    await db.query(
      `insert into data_transfer_logs
         (id, tenant_id, operation_type, file_format, file_name, executed_at)
       values (gen_random_uuid(), $1, 'export', 'json', 'report.json', now())`,
      [tenant],
    );
    const rows = await db.query<{ n: number }>(
      "select count(*)::int n from data_transfer_logs where file_format = 'json'",
    );
    assert.equal(rows.rows[0].n, 1);
  });
});
