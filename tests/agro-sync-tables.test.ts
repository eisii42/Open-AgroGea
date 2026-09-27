import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SYNC_TABLES } from "../packages/agro-core/src/types";
import { PULL_TABLES } from "../packages/agro-core/src/sync/targets";

/**
 * Il contratto delle tabelle sincronizzabili vive in tre posti: `SYNC_TABLES`
 * (TypeScript), `TABELLE_SYNC` (Rust, whitelist di push e pull) e
 * `PULL_TABLES` (colonne lette al pull). Nessun compilatore li tiene allineati:
 * lo fa questo test.
 */
function rustSyncTables(): string[] {
  const source = readFileSync(
    new URL("../apps/agro-field-suite/src-tauri/src/agro.rs", import.meta.url),
    "utf8",
  );
  const match = /const TABELLE_SYNC: \[&str; (\d+)\] = \[([\s\S]*?)\];/.exec(source);
  assert.ok(match, "TABELLE_SYNC non trovata in agro.rs");
  const tables = [...match[2].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(tables.length, Number(match[1]), "lunghezza dichiarata dell'array Rust");
  return tables;
}

describe("sync table contract", () => {
  it("SYNC_TABLES has no duplicates", () => {
    assert.equal(new Set(SYNC_TABLES).size, SYNC_TABLES.length);
  });

  it("the Rust whitelist matches SYNC_TABLES, in the same order", () => {
    assert.deepEqual(rustSyncTables(), [...SYNC_TABLES]);
  });

  it("PULL_TABLES covers exactly SYNC_TABLES", () => {
    const pulled = PULL_TABLES.map((t) => t.tabella);
    assert.equal(new Set(pulled).size, pulled.length, "tabelle duplicate nel pull");
    assert.deepEqual([...pulled].sort(), [...SYNC_TABLES].sort());
  });

  it("every pulled table reads the columns the sync relies on", () => {
    for (const { tabella, columns } of PULL_TABLES) {
      const cols = columns.split(",");
      for (const required of ["id", "tenant_id", "updated_at", "deleted_at"]) {
        assert.ok(cols.includes(required), `${tabella} senza ${required}`);
      }
    }
  });
});
