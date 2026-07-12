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
