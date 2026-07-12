import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";

/**
 * Cataloghi di stato multiregionali (Modulo 3): la tabella `cataloghi_prodotti`
 * deve esistere nello schema v11 e il filtro per `country_code` deve isolare i
 * cataloghi del paese del tenant (es. fitofarmaci ES vs IT). Test a livello SQL,
 * la stessa query che esegue `AgroDal.listCatalogo`.
 */
describe("Modulo 3 / cataloghi filtered per country_code", () => {
  it("isola le voci per paese e tipo (fitosanitari MAPA vs SIAN)", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    await db.exec(`
      insert into product_catalogs (country_code, type, code, name, active_substance, registration_number) values
        ('IT','phytosanitary','IT-001','Poltiglia Bordolese','Rame','12345'),
        ('IT','crop','060','Vite da vino',null,null),
        ('ES','phytosanitary','ES-777','Caldo Bordelés','Cobre','ES-REG-9'),
        ('ES','phytosanitary','ES-778','Azufre Mojable','Azufre','ES-REG-10'),
        ('ES','crop','VINO','Viñedo',null,null);
    `);

    const it = await db.query(
      `select * from product_catalogs where country_code = $1 and type = $2 order by name`,
      ["IT", "phytosanitary"],
    );
    assert.equal(it.rows.length, 1);
    assert.equal((it.rows[0] as { name: string }).name, "Poltiglia Bordolese");

    const es = await db.query(
      `select * from product_catalogs where country_code = $1 and type = $2 order by name`,
      ["ES", "phytosanitary"],
    );
    assert.equal(es.rows.length, 2);
    assert.deepEqual(
      es.rows.map((r) => (r as { code: string }).code),
      ["ES-778", "ES-777"], // sorted per name: Azufre… poi Caldo…
    );
  });

  it("la chiave naturale (country_code,tipo,codice) rende l'upsert idempotente", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    const ins = `insert into product_catalogs (country_code,type,code,name) values ('ES','crop','VINO',$1)
      on conflict (country_code,type,code) do update set name = excluded.name`;
    await db.query(ins, ["Viñedo"]);
    await db.query(ins, ["Viñedo (actualizado)"]);
    const r = await db.query(`select count(*)::int n, max(name) name from product_catalogs`);
    assert.equal((r.rows[0] as { n: number }).n, 1);
    assert.equal((r.rows[0] as { name: string }).name, "Viñedo (actualizado)");
  });
});
