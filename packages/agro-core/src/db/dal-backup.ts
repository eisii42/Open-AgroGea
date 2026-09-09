import type { Transaction } from "@electric-sql/pglite";
import type {
  ActivityMachine,
  ActivityProduct,
  CounterAdjustment,
  MaintenanceLog,
  SyncTable,
} from "../types";
import { AgroDalLocal } from "./dal-local";
import { type Row, nowIso, upsertSql } from "./write";

/**
 * Strato del DAL al servizio del BACKUP dell'azienda (export/ripristino del
 * documento GeoJSON Esteso). Due sole responsabilità:
 *
 *   - le letture d'insieme che ai moduli applicativi non servono, perché la
 *     UI legge sempre "i movimenti di QUESTA attività" o "gli interventi di
 *     QUESTO mezzo", mentre un backup deve prendere tutto il perimetro
 *     dell'azienda in un colpo solo;
 *   - {@link AgroDalBackup.restoreRows}, il ripristino di rows GIÀ FORMATE.
 *
 * Perché il ripristino non passa dai metodi di dominio: quelli REPLICANO
 * l'operazione (un carico ricalcola il CUMP, un rifornimento muove i contatori
 * del mezzo, uno scarico decrementa la giacenza). Rigiocarli su un ripristino
 * falsificherebbe proprio i valori che il backup deve riportare identici. Qui
 * si riscrivono le rows come stavano, con la loro voce di outbox: il dato
 * ripristinato resta sincronizzabile su un data plane on-premise, e in
 * standalone l'outbox è comunque no-op.
 */
export class AgroDalBackup extends AgroDalLocal {
  // -- letture d'insieme del perimetro company -------------------------------

  /**
   * Scarichi di magazzino (`activity_products`) di tutte le attività
   * dell'azienda. Il perimetro è quello dell'ATTIVITÀ: è il Quaderno a dire di
   * chi è il movimento, non il lot (che è a livello tenant).
   */
  async listCompanyActivityProducts(
    companyId: string,
  ): Promise<ActivityProduct[]> {
    const result = await this.db.query<ActivityProduct>(
      `select ap.* from activity_products ap
       join treatment_logs t on t.id = ap.treatment_log_id
       where t.company_id = $1 and ap.deleted_at is null
       order by ap.created_at`,
      [companyId],
    );
    return result.rows;
  }

  /** Impieghi mezzo/attrezzo (`activity_machines`) di tutte le attività. */
  async listCompanyActivityMachines(
    companyId: string,
  ): Promise<ActivityMachine[]> {
    const result = await this.db.query<ActivityMachine>(
      `select am.* from activity_machines am
       join treatment_logs t on t.id = am.treatment_log_id
       where t.company_id = $1 and am.deleted_at is null
       order by am.created_at`,
      [companyId],
    );
    return result.rows;
  }

  /**
   * Interventi di manutenzione dell'azienda. Il legame con la company passa
   * dal mezzo O dall'attrezzo (uno dei due è valorizzato), come nello
   * scadenziario.
   */
  async listCompanyMaintenanceLogs(
    companyId: string,
  ): Promise<MaintenanceLog[]> {
    const result = await this.db.query<MaintenanceLog>(
      `select l.* from maintenance_logs l
       left join machines m on m.id = l.machine_id
       left join equipment e on e.id = l.equipment_id
       where l.deleted_at is null
         and coalesce(m.company_id, e.company_id) = $1
       order by l.performed_at`,
      [companyId],
    );
    return result.rows;
  }

  /** Rettifiche dei contatori (ore/km) di mezzi e attrezzi dell'azienda. */
  async listCompanyCounterAdjustments(
    companyId: string,
  ): Promise<CounterAdjustment[]> {
    const result = await this.db.query<CounterAdjustment>(
      `select a.* from counter_adjustments a
       left join machines m on m.id = a.machine_id
       left join equipment e on e.id = a.equipment_id
       where a.deleted_at is null
         and coalesce(m.company_id, e.company_id) = $1
       order by a.adjusted_at`,
      [companyId],
    );
    return result.rows;
  }

  // -- ripristino ------------------------------------------------------------

  /**
   * Riscrive rows di dominio così come stanno nel backup: upsert idempotente
   * per `id` + voce di outbox, tutto in una sola transazione (nessuna row
   * ripristinata può restare fuori dalla coda di sync).
   *
   * `tenant_id` è FORZATO a quello dell'istanza: un file esportato altrove non
   * può reintrodurre il tenant di provenienza. Le columns che il DB locale non
   * ha vengono scartate, così un file prodotto da una versione più recente (in
   * additivo) si ripristina lo stesso, con i campi che questa versione conosce.
   *
   * @returns quante rows sono state scritte.
   */
  async restoreRows<T extends { id: string }>(
    table: SyncTable,
    rows: readonly T[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const columns = await this.tableColumns(table);
    const prepared = rows.map((row) => {
      const clean: Row = {};
      for (const [key, value] of Object.entries(row as Row)) {
        if (value !== undefined && columns.has(key)) clean[key] = value;
      }
      clean.tenant_id = this.tenantId;
      clean.updated_at = (clean.updated_at as string | undefined) ?? nowIso();
      return clean as Row & { id: string };
    });

    await this.db.transaction(async (tx: Transaction) => {
      for (const row of prepared) {
        const { sql, values } = upsertSql(table, row);
        await tx.query(sql, values);
        await this.enqueueOutbox(tx, table, "update", row);
      }
    });
    return prepared.length;
  }

  /**
   * Quali fra gli `ids` esistono già (anche cancellati logicamente) nella
   * tabella. Serve al ripristino per non tentare scritture che violerebbero
   * una foreign key: un backup parziale può contenere un rifornimento senza il
   * lot che lo alimentava, e quel rifornimento va saltato — non fatto fallire
   * l'intero ripristino.
   */
  async existingIds(
    table: SyncTable,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    // A blocchi: l'elenco di id di un ripristino può essere lungo, e i
    // parametri di una singola query non sono infiniti.
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map((_, n) => `$${n + 1}`).join(", ");
      const result = await this.db.query<{ id: string }>(
        `select id from ${table} where id in (${placeholders})`,
        [...chunk],
      );
      for (const row of result.rows) found.add(row.id);
    }
    return found;
  }

  /** Nomi delle columns realmente presenti nella tabella locale. */
  private async tableColumns(table: SyncTable): Promise<Set<string>> {
    const cached = this.columnCache.get(table);
    if (cached) return cached;
    const result = await this.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    const columns = new Set(result.rows.map((r) => r.column_name));
    this.columnCache.set(table, columns);
    return columns;
  }

  /** Lo schema locale non cambia a runtime: si interroga una volta per tabella. */
  private readonly columnCache = new Map<SyncTable, Set<string>>();
}
