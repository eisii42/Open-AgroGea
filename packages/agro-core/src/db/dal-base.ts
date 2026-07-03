import type { PGlite, Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  OperazioneMutazione,
  OutboxMutazione,
  TabellaSync,
} from "../types";
import { type Row, upsertSql } from "./write";

/**
 * Strato base del DAL: transazione dato+outbox, applicazione delle righe
 * remote (pull LWW), gestione della coda `sync_outbox` e watermark del pull
 * incrementale. I domini applicativi vivono nelle sottoclassi (vedi dal.ts).
 */
export class AgroDalBase {
  protected constructor(
    protected readonly db: PGlite,
    readonly tenantId: string,
    readonly deviceId: string,
  ) {}

  /**
   * Esegue una query SQL arbitraria sul DB PGlite del tenant.
   * Usata dai moduli app-side (es. FieldCollectionTool) per tabelle
   * LOCAL-ONLY non gestite dal DAL (CREATE IF NOT EXISTS, INSERT, SELECT).
   */
  async rawQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }> {
    return this.db.query<T>(sql, params);
  }

  // -- scrittura transazionale (dato + outbox) ------------------------------

  protected async writeWithOutbox(
    tabella: TabellaSync,
    operazione: OperazioneMutazione,
    row: Row & { id: string },
  ): Promise<void> {
    await this.db.transaction(async (tx: Transaction) => {
      if (operazione === "delete") {
        await tx.query(
          `update ${tabella} set deleted_at = $2, updated_at = $2 where id = $1`,
          [row.id, row.updated_at],
        );
      } else {
        const { sql, values } = upsertSql(tabella, row);
        await tx.query(sql, values);
      }
      await tx.query(
        `insert into sync_outbox
           (mutation_id, table_name, row_id, operation, payload, mutated_at, device_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uuidv4(),
          tabella,
          row.id,
          operazione,
          operazione === "delete" ? null : JSON.stringify(row),
          row.updated_at,
          this.deviceId,
        ],
      );
    });
  }

  /** Soft-delete standard: tombstone (`deleted_at`) + mutazione di delete in outbox. */
  protected async softDelete(tabella: TabellaSync, id: string): Promise<void> {
    await this.writeWithOutbox(tabella, "delete", {
      id,
      updated_at: new Date().toISOString(),
    });
  }

  // -- pull dal data plane remoto --------------------------------------------

  /**
   * Applica righe arrivate dal data plane remoto (pull di idratazione): upsert
   * LWW SENZA voce di outbox. Una riga locale più recente non viene sovrascritta.
   */
  async applyRemoteRows(tabella: TabellaSync, rows: Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    await this.db.transaction(async (tx: Transaction) => {
      for (const row of rows) {
        const { sql, values } = upsertSql(tabella, row, { lww: true });
        await tx.query(sql, values);
      }
    });
    return rows.length;
  }

  // -- watermark del pull incrementale ---------------------------------------

  /**
   * Watermark per tabella dell'ultimo pull riuscito (`agro_meta`, chiavi
   * `pull_watermark:<tabella>`): il target remoto li usa per scaricare solo le
   * righe con `updated_at` successivo, invece dell'intero dataset del tenant.
   */
  async getPullWatermarks(): Promise<Record<string, string>> {
    const result = await this.db.query<{ key: string; value: string }>(
      `select key, value from agro_meta where key like 'pull_watermark:%'`,
    );
    const out: Record<string, string> = {};
    for (const r of result.rows) {
      out[r.key.slice("pull_watermark:".length)] = r.value;
    }
    return out;
  }

  async setPullWatermark(tabella: TabellaSync, isoTs: string): Promise<void> {
    await this.db.query(
      `insert into agro_meta (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      [`pull_watermark:${tabella}`, isoTs],
    );
  }

  // -- outbox ----------------------------------------------------------------

  async listPendingMutations(limit = 200): Promise<OutboxMutazione[]> {
    const result = await this.db.query<OutboxMutazione>(
      `select * from sync_outbox
       where sync_status in ('pending', 'error')
       order by created_at
       limit $1`,
      [limit],
    );
    return result.rows;
  }

  async countPendingMutations(): Promise<number> {
    const result = await this.db.query<{ n: number }>(
      `select count(*)::int as n from sync_outbox
       where sync_status in ('pending', 'error', 'in_flight')`,
    );
    return result.rows[0]?.n ?? 0;
  }

  /** Coda di sync visibile all'utente: tutte le mutazioni non confermate. */
  async listOutbox(limit = 500): Promise<OutboxMutazione[]> {
    const result = await this.db.query<OutboxMutazione>(
      `select * from sync_outbox
       where sync_status in ('pending', 'error', 'in_flight')
       order by created_at desc
       limit $1`,
      [limit],
    );
    return result.rows;
  }

  /** Rimuove una singola voce dalla coda (non verrà più sincronizzata). */
  async deleteMutation(mutationId: string): Promise<void> {
    await this.db.query(
      `delete from sync_outbox where mutation_id = $1`,
      [mutationId],
    );
  }

  /** Svuota la coda delle mutazioni non sincronizzate; ritorna il n. rimosse. */
  async clearOutbox(): Promise<number> {
    const before = await this.countPendingMutations();
    await this.db.query(
      `delete from sync_outbox
       where sync_status in ('pending', 'error', 'in_flight')`,
    );
    return before;
  }

  async markMutations(
    mutationIds: string[],
    status: "in_flight" | "synced",
  ): Promise<void> {
    if (mutationIds.length === 0) return;
    await this.db.query(
      `update sync_outbox set sync_status = $1
       where mutation_id = any($2::uuid[])`,
      [status, mutationIds],
    );
  }

  async markMutationsFailed(
    mutationIds: string[],
    error: string,
  ): Promise<void> {
    if (mutationIds.length === 0) return;
    await this.db.query(
      `update sync_outbox
       set sync_status = 'error', attempts = attempts + 1, last_error = $1
       where mutation_id = any($2::uuid[])`,
      [error.slice(0, 500), mutationIds],
    );
  }
}
