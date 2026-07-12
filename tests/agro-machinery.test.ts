import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";

/**
 * Parco macchine 0.3.0 (schema v18): migrazione ADDITIVA non distruttiva (le
 * otto nuove tabelle si creano, sono idempotenti e i dati pre-esistenti
 * sopravvivono), contatori ore materializzati con storno esatto su
 * modifica/cancellazione, scarico atomico del carburante dalla cisterna,
 * scadenziari manutenzione/documenti a soglia, consumo l/h + anomalie e flusso
 * end-to-end della Definition of Done §7. Questo file cresce coi milestone
 * successivi (DAL + engine); qui la sola migrazione.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

const NEW_TABLES = [
  "machines",
  "equipment",
  "activity_machines",
  "maintenance_schedules",
  "maintenance_logs",
  "machine_documents",
  "counter_adjustments",
  "fuel_refills",
];

describe("schema v18 / migrazione additiva Parco macchine", () => {
  it("crea le otto tabelle, è idempotente e preserva i dati pre-esistenti", async () => {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    // Record pre-esistente del Quaderno con il mezzo a TESTO LIBERO: il vincolo
    // di migrazione §3 impone che sopravviva intatto (fallback preservato).
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ('22222222-2222-2222-2222-222222222222', $1, 'Az')`,
      [TENANT],
    );
    await db.query(
      `insert into treatment_logs
         (id, tenant_id, company_id, operation_type, machinery_equipment, executed_at)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222',
               'tillage', 'Trattore vecchio a testo libero', now())`,
      [TENANT],
    );

    // Ri-applicazione (aggiornamento di un'istanza esistente): idempotente.
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`,
    );
    const nomi = tables.rows.map((r) => r.table_name);
    for (const t of NEW_TABLES) {
      assert.ok(nomi.includes(t), `manca la tabella ${t}`);
    }

    // Il fallback testo libero è INTATTO.
    const legacy = await db.query<{ machinery_equipment: string }>(
      `select machinery_equipment from treatment_logs`,
    );
    assert.equal(legacy.rows.length, 1);
    assert.equal(
      legacy.rows[0].machinery_equipment,
      "Trattore vecchio a testo libero",
    );
  });

  it("il CHECK giacenza del lot resta la guardia atomica per il refill", async () => {
    // Il refill scarica il lot carburante: il vincolo quantity_on_hand >= 0
    // (Magazzino 0.2.0) deve continuare a valere anche dopo la migrazione v18.
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    await db.query(
      `insert into companies (id, tenant_id, business_name)
       values ('22222222-2222-2222-2222-222222222222', $1, 'Az')`,
      [TENANT],
    );
    const product = await db.query<{ id: string }>(
      `insert into products (id, tenant_id, company_id, category, name, unit, uma_code)
       values (gen_random_uuid(), $1, '22222222-2222-2222-2222-222222222222',
               'fuel', 'Gasolio agricolo', 'l', 'UMA-1') returning id`,
      [TENANT],
    );
    const lot = await db.query<{ id: string }>(
      `insert into product_lots (id, tenant_id, product_id, initial_quantity, quantity_on_hand, unit_cost)
       values (gen_random_uuid(), $1, $2, 1000, 1000, 1.5) returning id`,
      [TENANT, product.rows[0].id],
    );
    await assert.rejects(
      db.query(
        `update product_lots set quantity_on_hand = quantity_on_hand - 2000 where id = $1`,
        [lot.rows[0].id],
      ),
    );
  });
});
