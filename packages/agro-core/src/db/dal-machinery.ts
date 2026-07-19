import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  ActivityMachine,
  ActivityProduct,
  CounterAdjustment,
  Equipment,
  FuelRefill,
  IssueRequest,
  Machine,
  MachineDocument,
  MachineUsageRequest,
  MaintenanceLog,
  MaintenanceSchedule,
  ProductLot,
  TreatmentLog,
} from "../types";
import { AgroDalWarehouse, WarehouseError } from "./dal-warehouse";
import { nowIso, type Row, upsertSql } from "./write";

/**
 * Strato "Parco macchine" del DAL (0.3.0): anagrafica mezzi/attrezzi con
 * contatori materializzati, giunzione attività ↔ mezzo con incremento/storno
 * automatico dei contatori, rettifiche contaore (audit), scadenziari
 * manutenzione (riprogrammazione ricorrente + scarico ricambio atomico) e
 * documenti, refill carburante che scarica la cisterna dal Magazzino (atomico).
 *
 * Sta SOPRA il Magazzino: riusa le sue transazioni componibili
 * ({@link AgroDalWarehouse.insertTreatmentTx}/`issueLotsTx`/`reverseIssuesTx`)
 * per orchestrare attività + scarico lots + aggancio mezzi in UN'UNICA
 * transazione. I contatori (`machines.hour_counter`/`equipment.usage_counter`)
 * si muovono SOLO da qui: incremento dalle attività, SET dalle rettifiche.
 */
export class AgroDalMachinery extends AgroDalWarehouse {
  // -- anagrafica machines ----------------------------------------------------

  /**
   * Crea/aggiorna una macchina. Il contatore ore NON si imposta da qui (lo
   * muovono attività e rettifiche, come il CUMP dei products): un upsert
   * preserva `hour_counter` esistente, un nuovo record parte da 0 (la lettura
   * iniziale passa da {@link adjustCounter}, così ogni valore ha audit trail).
   */
  async upsertMachine(
    input: Omit<
      Machine,
      "id" | "tenant_id" | "hour_counter" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<Machine> {
    const ts = nowIso();
    const existing = input.id ? await this.getMachine(input.id) : null;
    const row: Machine = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      name: input.name.trim(),
      machine_type: input.machine_type ?? null,
      license_plate: input.license_plate ?? null,
      chassis_number: input.chassis_number ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      hour_counter: existing?.hour_counter ?? 0,
      status: input.status ?? "operational",
      purchase_value: input.purchase_value ?? null,
      purchase_date: input.purchase_date ?? null,
      useful_life_hours: input.useful_life_hours ?? null,
      useful_life_years: input.useful_life_years ?? null,
      residual_value: input.residual_value ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at ?? existing?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "machines",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async getMachine(id: string): Promise<Machine | null> {
    const result = await this.db.query<Machine>(
      `select * from machines where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listMachines(companyId: string): Promise<Machine[]> {
    const result = await this.db.query<Machine>(
      `select * from machines
       where company_id = $1 and deleted_at is null
       order by name`,
      [companyId],
    );
    return result.rows;
  }

  async deleteMachine(id: string): Promise<void> {
    await this.softDelete("machines", id);
  }

  // -- anagrafica equipment ---------------------------------------------------

  /** Come {@link upsertMachine}: `usage_counter` preservato/azzerato, non impostato qui. */
  async upsertEquipment(
    input: Omit<
      Equipment,
      "id" | "tenant_id" | "usage_counter" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<Equipment> {
    const ts = nowIso();
    const existing = input.id ? await this.getEquipment(input.id) : null;
    const row: Equipment = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      name: input.name.trim(),
      equipment_type: input.equipment_type ?? null,
      working_width_m: input.working_width_m ?? null,
      usage_counter: existing?.usage_counter ?? 0,
      status: input.status ?? "operational",
      purchase_value: input.purchase_value ?? null,
      purchase_date: input.purchase_date ?? null,
      useful_life_hours: input.useful_life_hours ?? null,
      useful_life_years: input.useful_life_years ?? null,
      residual_value: input.residual_value ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at ?? existing?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "equipment",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async getEquipment(id: string): Promise<Equipment | null> {
    const result = await this.db.query<Equipment>(
      `select * from equipment where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listEquipment(companyId: string): Promise<Equipment[]> {
    const result = await this.db.query<Equipment>(
      `select * from equipment
       where company_id = $1 and deleted_at is null
       order by name`,
      [companyId],
    );
    return result.rows;
  }

  async deleteEquipment(id: string): Promise<void> {
    await this.softDelete("equipment", id);
  }

  // -- rettifiche contaore (audit trail, §4.6) --------------------------------

  /**
   * Rettifica MANUALE del contatore (lettura iniziale, rettifica, sostituzione
   * motore/reset): registra la riga di audit `counter_adjustments`
   * (`previous_value` = valore reale corrente) e SETta il contatore del
   * mezzo/attrezzo a `new_value`, in una sola transazione. L'incremento
   * automatico delle attività riparte così dal valore rettificato reale (§5.2).
   */
  async adjustCounter(input: {
    machine_id?: string | null;
    equipment_id?: string | null;
    type: CounterAdjustment["type"];
    new_value: number;
    adjusted_at: string;
    reason?: string | null;
    author?: string | null;
  }): Promise<CounterAdjustment> {
    const ts = nowIso();
    const isMachine = Boolean(input.machine_id);
    const table = isMachine ? "machines" : "equipment";
    const counterCol = isMachine ? "hour_counter" : "usage_counter";
    const targetId = (input.machine_id ?? input.equipment_id) as string;
    let adjustment!: CounterAdjustment;
    await this.db.transaction(async (tx: Transaction) => {
      const cur = await tx.query<{ c: number | string | null }>(
        `select ${counterCol} as c from ${table} where id = $1`,
        [targetId],
      );
      const previous = cur.rows[0]?.c != null ? Number(cur.rows[0].c) : null;
      adjustment = {
        id: uuidv4(),
        tenant_id: this.tenantId,
        machine_id: input.machine_id ?? null,
        equipment_id: input.equipment_id ?? null,
        type: input.type,
        previous_value: previous,
        new_value: input.new_value,
        adjusted_at: input.adjusted_at,
        reason: input.reason ?? null,
        author: input.author ?? null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      };
      const ins = upsertSql("counter_adjustments", adjustment as unknown as Row);
      await tx.query(ins.sql, ins.values);
      await this.enqueueOutbox(
        tx,
        "counter_adjustments",
        "insert",
        adjustment as unknown as Row & { id: string },
      );
      await tx.query(
        `update ${table} set ${counterCol} = $2, updated_at = $3 where id = $1`,
        [targetId, input.new_value, ts],
      );
      await this.enqueueTargetRow(tx, table, targetId);
    });
    return adjustment;
  }

  async listCounterAdjustments(opts: {
    machineId?: string;
    equipmentId?: string;
  }): Promise<CounterAdjustment[]> {
    const col = opts.machineId ? "machine_id" : "equipment_id";
    const id = opts.machineId ?? opts.equipmentId;
    const result = await this.db.query<CounterAdjustment>(
      `select * from counter_adjustments
       where ${col} = $1 and deleted_at is null
       order by created_at desc`,
      [id],
    );
    return result.rows;
  }

  // -- giunzione attività ↔ mezzo + contatori automatici (§5.2) ---------------

  /**
   * Aggancia i mezzi a un'attività DENTRO la transazione passata: inserisce le
   * giunzioni `activity_machines` e INCREMENTA i contatori (letti al valore
   * reale corrente via `+ delta` in SQL, coerenti con eventuali rettifiche).
   */
  protected async attachMachinesTx(
    tx: Transaction,
    treatmentId: string,
    machineUsages: MachineUsageRequest[],
    ts: string,
  ): Promise<ActivityMachine[]> {
    const rows: ActivityMachine[] = [];
    for (const usage of machineUsages) {
      const junction: ActivityMachine = {
        id: uuidv4(),
        tenant_id: this.tenantId,
        treatment_log_id: treatmentId,
        machine_id: usage.machine_id,
        equipment_id: usage.equipment_id ?? null,
        hours: usage.hours,
        operator_name: usage.operator_name ?? null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      };
      const ins = upsertSql("activity_machines", junction as unknown as Row);
      await tx.query(ins.sql, ins.values);
      await this.enqueueOutbox(
        tx,
        "activity_machines",
        "insert",
        junction as unknown as Row & { id: string },
      );
      await tx.query(
        `update machines set hour_counter = hour_counter + $2, updated_at = $3
         where id = $1 and deleted_at is null`,
        [usage.machine_id, usage.hours, ts],
      );
      await this.enqueueTargetRow(tx, "machines", usage.machine_id);
      if (usage.equipment_id) {
        await tx.query(
          `update equipment set usage_counter = usage_counter + $2, updated_at = $3
           where id = $1 and deleted_at is null`,
          [usage.equipment_id, usage.hours, ts],
        );
        await this.enqueueTargetRow(tx, "equipment", usage.equipment_id);
      }
      rows.push(junction);
    }
    return rows;
  }

  /**
   * Storna i mezzi agganciati a un'attività DENTRO la transazione passata:
   * decrementa i contatori delle ore già conteggiate (clamp a 0 per non andare
   * sotto un eventuale reset motore) e tombstone delle giunzioni. Nessun doppio
   * conteggio: si storna ESATTAMENTE ciò che era stato incrementato.
   */
  protected async reverseMachinesTx(
    tx: Transaction,
    treatmentId: string,
    ts: string,
  ): Promise<void> {
    const junctions = await tx.query<ActivityMachine>(
      `select * from activity_machines
       where treatment_log_id = $1 and deleted_at is null`,
      [treatmentId],
    );
    for (const j of junctions.rows) {
      await tx.query(
        `update machines set hour_counter = greatest(0, hour_counter - $2), updated_at = $3
         where id = $1 and deleted_at is null`,
        [j.machine_id, j.hours, ts],
      );
      await this.enqueueTargetRow(tx, "machines", j.machine_id);
      if (j.equipment_id) {
        await tx.query(
          `update equipment set usage_counter = greatest(0, usage_counter - $2), updated_at = $3
           where id = $1 and deleted_at is null`,
          [j.equipment_id, j.hours, ts],
        );
        await this.enqueueTargetRow(tx, "equipment", j.equipment_id);
      }
      await tx.query(
        `update activity_machines set deleted_at = $2, updated_at = $2 where id = $1`,
        [j.id, ts],
      );
      await this.enqueueOutbox(tx, "activity_machines", "delete", {
        id: j.id,
        updated_at: ts,
      } as Row & { id: string });
    }
  }

  /**
   * Override del salvataggio attività del Magazzino che aggancia ANCHE i mezzi
   * (contatori) nella STESSA transazione di attività + scarico lots (§5.2): un
   * errore su qualunque fronte annulla l'intero salvataggio.
   */
  override async insertTreatmentWithIssues(
    input: Omit<
      TreatmentLog,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
    issues: IssueRequest[],
    machineUsages: MachineUsageRequest[] = [],
  ): Promise<{ treatment: TreatmentLog; issues: ActivityProduct[] }> {
    const ts = nowIso();
    const treatment: TreatmentLog = {
      ...input,
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    let issueRows: ActivityProduct[] = [];
    await this.db.transaction(async (tx: Transaction) => {
      await this.insertTreatmentTx(tx, treatment);
      issueRows = await this.issueLotsTx(tx, treatment.id, issues, ts);
      await this.attachMachinesTx(tx, treatment.id, machineUsages, ts);
    });
    return { treatment, issues: issueRows };
  }

  /**
   * Override della cancellazione: oltre allo storno warehouse dei lots, storna
   * i contatori dei mezzi agganciati (§5.2), sempre in un'unica transazione.
   */
  override async deleteTreatment(id: string): Promise<void> {
    const ts = nowIso();
    await this.db.transaction(async (tx: Transaction) => {
      await tx.query(
        `update treatment_logs set deleted_at = $2, updated_at = $2 where id = $1`,
        [id, ts],
      );
      await this.enqueueOutbox(tx, "treatment_logs", "delete", {
        id,
        updated_at: ts,
      } as Row & { id: string });
      await this.reverseIssuesTx(tx, id, ts);
      await this.reverseMachinesTx(tx, id, ts);
    });
  }

  /**
   * Ricalcolo consistente dei contatori alla MODIFICA dei mezzi di un'attività
   * (§5.2): storna i vecchi agganci e applica i nuovi in un'unica transazione
   * (nessuno scostamento). Usato dall'editing dell'operazione.
   */
  async updateActivityMachines(
    treatmentId: string,
    machineUsages: MachineUsageRequest[],
  ): Promise<ActivityMachine[]> {
    const ts = nowIso();
    let rows: ActivityMachine[] = [];
    await this.db.transaction(async (tx: Transaction) => {
      await this.reverseMachinesTx(tx, treatmentId, ts);
      rows = await this.attachMachinesTx(tx, treatmentId, machineUsages, ts);
    });
    return rows;
  }

  /** Mezzi/attrezzi (con name) agganciati a una singola attività. */
  async listActivityMachines(
    treatmentLogId: string,
  ): Promise<
    Array<ActivityMachine & { machine_name: string; equipment_name: string | null }>
  > {
    const result = await this.db.query<
      ActivityMachine & { machine_name: string; equipment_name: string | null }
    >(
      `select am.*, m.name as machine_name, e.name as equipment_name
       from activity_machines am
       join machines m on m.id = am.machine_id
       left join equipment e on e.id = am.equipment_id
       where am.treatment_log_id = $1 and am.deleted_at is null
       order by am.created_at`,
      [treatmentLogId],
    );
    return result.rows;
  }

  // -- scadenziario manutenzione (§5.3) ---------------------------------------

  async upsertMaintenanceSchedule(
    input: Omit<
      MaintenanceSchedule,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<MaintenanceSchedule> {
    const ts = nowIso();
    const row: MaintenanceSchedule = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      machine_id: input.machine_id ?? null,
      equipment_id: input.equipment_id ?? null,
      name: input.name.trim(),
      category: input.category,
      trigger_type: input.trigger_type,
      interval_days: input.interval_days ?? null,
      due_date: input.due_date ?? null,
      interval_hours: input.interval_hours ?? null,
      due_hours: input.due_hours ?? null,
      active: input.active ?? true,
      notes: input.notes ?? null,
      created_at: input.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "maintenance_schedules",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async deleteMaintenanceSchedule(id: string): Promise<void> {
    await this.softDelete("maintenance_schedules", id);
  }

  /** Piani di manutenzione dell'azienda (join a machines/equipment). */
  async listMaintenanceSchedules(
    companyId: string,
  ): Promise<MaintenanceSchedule[]> {
    const result = await this.db.query<MaintenanceSchedule>(
      `select s.* from maintenance_schedules s
       left join machines m on m.id = s.machine_id
       left join equipment e on e.id = s.equipment_id
       where s.deleted_at is null
         and coalesce(m.company_id, e.company_id) = $1
       order by s.due_date nulls last, s.created_at`,
      [companyId],
    );
    return result.rows;
  }

  /**
   * Registra un intervento e — se il piano è ricorrente e attivo — lo
   * RIPROGRAMMA (prossima scadenza = data/ore intervento + intervallo, §4.5).
   * Se `product_lot_id` + `parts_quantity` sono valorizzati scarica il ricambio
   * dal Magazzino con blocco atomico (§5.3); tutto in un'unica transazione.
   */
  async recordMaintenance(
    input: Omit<
      MaintenanceLog,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ): Promise<MaintenanceLog> {
    const ts = nowIso();
    const log: MaintenanceLog = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      schedule_id: input.schedule_id ?? null,
      machine_id: input.machine_id ?? null,
      equipment_id: input.equipment_id ?? null,
      performed_at: input.performed_at,
      counter_hours: input.counter_hours ?? null,
      description: input.description ?? null,
      cost: input.cost ?? null,
      parts: input.parts ?? null,
      product_lot_id: input.product_lot_id ?? null,
      parts_quantity: input.parts_quantity ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.transaction(async (tx: Transaction) => {
      // Scarico atomico del ricambio dal Magazzino (opzionale).
      if (log.product_lot_id && log.parts_quantity && log.parts_quantity > 0) {
        await this.decrementLotTx(
          tx,
          log.product_lot_id,
          log.parts_quantity,
          ts,
        );
      }
      const ins = upsertSql("maintenance_logs", log as unknown as Row);
      await tx.query(ins.sql, ins.values);
      await this.enqueueOutbox(
        tx,
        "maintenance_logs",
        "insert",
        log as unknown as Row & { id: string },
      );
      // Riprogrammazione del piano ricorrente.
      if (log.schedule_id) {
        await this.rescheduleTx(tx, log.schedule_id, log, ts);
      }
    });
    return log;
  }

  async listMaintenanceLogs(opts: {
    machineId?: string;
    equipmentId?: string;
    scheduleId?: string;
  }): Promise<MaintenanceLog[]> {
    const col = opts.scheduleId
      ? "schedule_id"
      : opts.machineId
        ? "machine_id"
        : "equipment_id";
    const id = opts.scheduleId ?? opts.machineId ?? opts.equipmentId;
    const result = await this.db.query<MaintenanceLog>(
      `select * from maintenance_logs
       where ${col} = $1 and deleted_at is null
       order by performed_at desc`,
      [id],
    );
    return result.rows;
  }

  // -- documenti del mezzo (§5.4) ---------------------------------------------

  async upsertMachineDocument(
    input: Omit<
      MachineDocument,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<MachineDocument> {
    const ts = nowIso();
    const row: MachineDocument = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      machine_id: input.machine_id ?? null,
      equipment_id: input.equipment_id ?? null,
      type: input.type,
      reference: input.reference ?? null,
      issued_at: input.issued_at ?? null,
      expires_at: input.expires_at,
      issuer: input.issuer ?? null,
      amount: input.amount ?? null,
      attachment_path: input.attachment_path ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "machine_documents",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async deleteMachineDocument(id: string): Promise<void> {
    await this.softDelete("machine_documents", id);
  }

  async listMachineDocuments(companyId: string): Promise<MachineDocument[]> {
    const result = await this.db.query<MachineDocument>(
      `select d.* from machine_documents d
       left join machines m on m.id = d.machine_id
       left join equipment e on e.id = d.equipment_id
       where d.deleted_at is null
         and coalesce(m.company_id, e.company_id) = $1
       order by d.expires_at`,
      [companyId],
    );
    return result.rows;
  }

  /**
   * Documenti in scadenza entro `warningDays` giorni o già scaduti (alert §5.4,
   * stesso pattern di `listLottiInScadenza` del Magazzino).
   */
  async listExpiringDocuments(
    companyId: string,
    warningDays: number,
  ): Promise<MachineDocument[]> {
    const result = await this.db.query<MachineDocument>(
      `select d.* from machine_documents d
       left join machines m on m.id = d.machine_id
       left join equipment e on e.id = d.equipment_id
       where d.deleted_at is null
         and coalesce(m.company_id, e.company_id) = $1
         and d.expires_at <= (current_date + $2::int)
       order by d.expires_at`,
      [companyId, warningDays],
    );
    return result.rows;
  }

  // -- refill carburante (§5.5) -----------------------------------------------

  /**
   * Registra un rifornimento e SCARICA il lot carburante (cisterna) dal
   * Magazzino con blocco atomico (giacenza negativa ⇒ rollback). Deriva
   * `uma_code` dal product carburante se non fornito. Ricostruisce carico/
   * scarico sia a livello cisterna sia per singolo mezzo.
   */
  async recordFuelRefill(
    input: Omit<
      FuelRefill,
      "id" | "tenant_id" | "uma_code" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; uma_code?: string | null },
  ): Promise<FuelRefill> {
    const ts = nowIso();
    let refill!: FuelRefill;
    await this.db.transaction(async (tx: Transaction) => {
      const lookup = await tx.query<
        ProductLot & { category: string; uma_code: string | null; product_name: string }
      >(
        `select l.*, p.category, p.uma_code, p.name as product_name
         from product_lots l join products p on p.id = l.product_id
         where l.id = $1 and l.deleted_at is null`,
        [input.product_lot_id],
      );
      const lot = lookup.rows[0];
      if (!lot) {
        throw new WarehouseError(
          "lot_not_found",
          `Lotto ${input.product_lot_id} inesistente: rifornimento annullato.`,
        );
      }
      if (lot.category !== "fuel") {
        throw new WarehouseError(
          "invalid_product",
          `Il lot ${lot.lot_number ?? lot.id.slice(0, 8)} non è di categoria carburante.`,
        );
      }
      await this.decrementLotTx(tx, lot.id, input.liters, ts, lot);
      refill = {
        id: input.id ?? uuidv4(),
        tenant_id: this.tenantId,
        machine_id: input.machine_id,
        product_lot_id: input.product_lot_id,
        liters: input.liters,
        refueled_at: input.refueled_at,
        counter_hours: input.counter_hours ?? null,
        operator_name: input.operator_name ?? null,
        uma_code: input.uma_code ?? lot.uma_code ?? null,
        full_tank: input.full_tank ?? true,
        notes: input.notes ?? null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      };
      const ins = upsertSql("fuel_refills", refill as unknown as Row);
      await tx.query(ins.sql, ins.values);
      await this.enqueueOutbox(
        tx,
        "fuel_refills",
        "insert",
        refill as unknown as Row & { id: string },
      );
    });
    return refill;
  }

  /** Storno di un rifornimento: reintegra la giacenza della cisterna + tombstone. */
  async deleteFuelRefill(id: string): Promise<void> {
    const ts = nowIso();
    await this.db.transaction(async (tx: Transaction) => {
      const found = await tx.query<FuelRefill>(
        `select * from fuel_refills where id = $1 and deleted_at is null`,
        [id],
      );
      const refill = found.rows[0];
      if (!refill) return;
      await tx.query(
        `update product_lots
         set quantity_on_hand = quantity_on_hand + $2, updated_at = $3
         where id = $1 and deleted_at is null`,
        [refill.product_lot_id, refill.liters, ts],
      );
      await this.enqueueTargetRow(tx, "product_lots", refill.product_lot_id);
      await tx.query(
        `update fuel_refills set deleted_at = $2, updated_at = $2 where id = $1`,
        [id, ts],
      );
      await this.enqueueOutbox(tx, "fuel_refills", "delete", {
        id,
        updated_at: ts,
      } as Row & { id: string });
    });
  }

  async listFuelRefills(
    companyId: string,
    opts: { machineId?: string; lotId?: string } = {},
  ): Promise<FuelRefill[]> {
    const conditions = ["r.deleted_at is null", "m.company_id = $1"];
    const params: unknown[] = [companyId];
    if (opts.machineId) {
      params.push(opts.machineId);
      conditions.push(`r.machine_id = $${params.length}`);
    }
    if (opts.lotId) {
      params.push(opts.lotId);
      conditions.push(`r.product_lot_id = $${params.length}`);
    }
    const result = await this.db.query<FuelRefill>(
      `select r.* from fuel_refills r
       join machines m on m.id = r.machine_id
       where ${conditions.join(" and ")}
       order by r.refueled_at desc, r.created_at desc`,
      params,
    );
    return result.rows;
  }

  /** Rifornimenti di un mezzo in ordine cronologico (input del consumo l/h). */
  async fuelRefillsForMachine(machineId: string): Promise<FuelRefill[]> {
    const result = await this.db.query<FuelRefill>(
      `select * from fuel_refills
       where machine_id = $1 and deleted_at is null
       order by refueled_at, counter_hours nulls last, created_at`,
      [machineId],
    );
    return result.rows;
  }

  // -- helper condivisi -------------------------------------------------------

  /**
   * Scarico atomico di un lot DENTRO la transazione: blocco su lot
   * inesistente/giacenza insufficiente (riuso della guardia del Magazzino).
   * Usato dal refill carburante e dallo scarico ricambi della manutenzione.
   */
  private async decrementLotTx(
    tx: Transaction,
    lotId: string,
    quantity: number,
    ts: string,
    known?: ProductLot & { product_name?: string },
  ): Promise<void> {
    let lot = known;
    if (!lot) {
      const lookup = await tx.query<ProductLot & { product_name: string }>(
        `select l.*, p.name as product_name
         from product_lots l join products p on p.id = l.product_id
         where l.id = $1 and l.deleted_at is null`,
        [lotId],
      );
      lot = lookup.rows[0];
    }
    if (!lot) {
      throw new WarehouseError(
        "lot_not_found",
        `Lotto ${lotId} inesistente: operazione annullata.`,
      );
    }
    const available = Number(lot.quantity_on_hand);
    if (quantity > available) {
      throw new WarehouseError(
        "insufficient_stock",
        `Giacenza insufficiente per il lot ${lot.lot_number ?? lot.id.slice(0, 8)}${
          lot.product_name ? ` di "${lot.product_name}"` : ""
        }: disponibili ${available}, richiesti ${quantity}. Operazione annullata.`,
      );
    }
    await tx.query(
      `update product_lots set quantity_on_hand = $2, updated_at = $3
       where id = $1 and deleted_at is null`,
      [lotId, Math.round((available - quantity) * 1000) / 1000, ts],
    );
    await this.enqueueTargetRow(tx, "product_lots", lotId);
  }

  /** Rilegge una row per id e la accoda in outbox come `update` (payload completo). */
  private async enqueueTargetRow(
    tx: Transaction,
    table: "machines" | "equipment" | "product_lots",
    id: string,
  ): Promise<void> {
    const result = await tx.query<Row>(`select * from ${table} where id = $1`, [
      id,
    ]);
    const row = result.rows[0];
    if (row) {
      await this.enqueueOutbox(
        tx,
        table,
        "update",
        row as Row & { id: string },
      );
    }
  }

  /**
   * Riprogramma un piano ricorrente attivo dentro la transazione: la prossima
   * scadenza è data/ore dell'intervento + intervallo. Per il trigger a ore, se
   * l'intervento non porta la lettura contaore si usa il contatore corrente del
   * mezzo/attrezzo.
   */
  private async rescheduleTx(
    tx: Transaction,
    scheduleId: string,
    log: MaintenanceLog,
    ts: string,
  ): Promise<void> {
    const found = await tx.query<MaintenanceSchedule>(
      `select * from maintenance_schedules where id = $1 and deleted_at is null`,
      [scheduleId],
    );
    const sched = found.rows[0];
    if (!sched || !sched.active) return;

    const patch: { due_date?: string | null; due_hours?: number | null } = {};
    if (sched.trigger_type === "time" && sched.interval_days != null) {
      // Aritmetica in UTC: evita lo slittamento di un giorno che si avrebbe con
      // la mezzanotte LOCALE riformattata in ISO. `interval_days` arriva da
      // PGlite come stringa: va coerciato a number (altrimenti concatenazione).
      const parts = log.performed_at.slice(0, 10).split("-").map(Number);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        const base = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        base.setUTCDate(base.getUTCDate() + Number(sched.interval_days));
        patch.due_date = base.toISOString().slice(0, 10);
      }
    } else if (sched.trigger_type === "hours" && sched.interval_hours != null) {
      let baseHours = log.counter_hours != null ? Number(log.counter_hours) : null;
      if (baseHours == null) {
        const counterCol = sched.machine_id ? "hour_counter" : "usage_counter";
        const table = sched.machine_id ? "machines" : "equipment";
        const targetId = sched.machine_id ?? sched.equipment_id;
        if (targetId) {
          const cur = await tx.query<{ c: number | string | null }>(
            `select ${counterCol} as c from ${table} where id = $1`,
            [targetId],
          );
          baseHours = cur.rows[0]?.c != null ? Number(cur.rows[0].c) : null;
        }
      }
      if (baseHours != null) {
        patch.due_hours =
          Math.round((baseHours + Number(sched.interval_hours)) * 100) / 100;
      }
    }
    if (patch.due_date === undefined && patch.due_hours === undefined) return;

    const updated: MaintenanceSchedule = {
      ...sched,
      due_date: patch.due_date ?? sched.due_date,
      due_hours: patch.due_hours ?? sched.due_hours,
      updated_at: ts,
    };
    const upd = upsertSql("maintenance_schedules", updated as unknown as Row);
    await tx.query(upd.sql, upd.values);
    await this.enqueueOutbox(
      tx,
      "maintenance_schedules",
      "update",
      updated as unknown as Row & { id: string },
    );
  }
}
