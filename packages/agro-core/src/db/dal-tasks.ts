import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  FieldOperationSession,
  FieldSessionStatus,
  PlannedTask,
  PlannedTaskStatus,
  Recipe,
} from "../types";
import { AgroDalMachinery } from "./dal-machinery";
import { nowIso, type Row, upsertSql } from "./write";

/**
 * Schema dell'URI dei blob audio delle sessioni a bordo campo
 * (`field_session_audio`, LOCAL-ONLY): `AudioNote.audio_uri` è sempre
 * `${AUDIO_URI_SCHEME}<blob_id>`. Usato dagli step futuri (registrazione e
 * riproduzione delle note vocali); qui solo definito perché la forma del dato
 * (`AudioNote`) nasce in questo step.
 */
export const AUDIO_URI_SCHEME = "agro-audio://";

/**
 * Strato "Pianificazione task & Modalità Campo low-touch" del DAL: ricette riutilizzabili, task PROGRAMMATE su un plot
 * (l'oggetto che il geofencing cerca all'ingresso nel field) e
 * sessioni ESEGUITE a bordo campo (tracciato GPS, chiusura verso il Quaderno —
 * popolate dal tracking GPS e dal riepilogo post-operazione). L'avvio di una sessione da una task
 * programmata è ATOMICO: inserisce la sessione E porta la task a IN_PROGRESS
 * nella stessa transazione (mai una sessione "orfana" con la task ancora
 * PLANNED, né viceversa).
 */
export class AgroDalTasks extends AgroDalMachinery {
  // -- ricette --------------------------------------------------------------

  /**
   * Crea/aggiorna una ricetta. `products` è un array jsonb (round-trip diretto,
   * senza serializzazione manuale: PGlite serializza correttamente gli array
   * JS passati come parametro su columns jsonb).
   */
  async saveRecipe(
    input: Omit<
      Recipe,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string },
  ): Promise<Recipe> {
    const ts = nowIso();
    const existing = input.id ? await this.getRecipe(input.id) : null;
    const row: Recipe = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      name: input.name.trim(),
      operation_type: input.operation_type ?? null,
      products: input.products ?? [],
      target_disease: input.target_disease ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at ?? existing?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "recipes",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async getRecipe(id: string): Promise<Recipe | null> {
    const result = await this.db.query<Recipe>(
      `select * from recipes where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.softDelete("recipes", id);
  }

  async listRecipes(companyId: string): Promise<Recipe[]> {
    const result = await this.db.query<Recipe>(
      `select * from recipes
       where company_id = $1 and deleted_at is null
       order by name`,
      [companyId],
    );
    return result.rows;
  }

  // -- task programmate -------------------------------------------------------

  /**
   * Crea/aggiorna una task programmata. Lo status di default è 'PLANNED' in
   * creazione; le transizioni successive passano da {@link setPlannedTaskStatus}
   * o dall'avvio atomico della sessione ({@link startFieldSession}).
   */
  async savePlannedTask(
    input: Omit<
      PlannedTask,
      "id" | "tenant_id" | "status" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; status?: PlannedTaskStatus; created_at?: string },
  ): Promise<PlannedTask> {
    const ts = nowIso();
    const existing = input.id ? await this.getPlannedTask(input.id) : null;
    const row: PlannedTask = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      plot_id: input.plot_id,
      operation_type: input.operation_type,
      recipe_id: input.recipe_id ?? null,
      target_pest_or_disease: input.target_pest_or_disease ?? null,
      status: input.status ?? existing?.status ?? "PLANNED",
      planned_date: input.planned_date ?? null,
      operator_name: input.operator_name ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at ?? existing?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "planned_tasks",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async getPlannedTask(id: string): Promise<PlannedTask | null> {
    const result = await this.db.query<PlannedTask>(
      `select * from planned_tasks where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async deletePlannedTask(id: string): Promise<void> {
    await this.softDelete("planned_tasks", id);
  }

  async listPlannedTasks(
    companyId: string,
    options: {
      plotId?: string;
      status?: PlannedTaskStatus;
      limit?: number;
    } = {},
  ): Promise<PlannedTask[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.plotId) {
      params.push(options.plotId);
      conditions.push(`plot_id = $${params.length}`);
    }
    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(options.limit ?? 500);
    const result = await this.db.query<PlannedTask>(
      `select * from planned_tasks
       where ${conditions.join(" and ")}
       order by planned_date nulls last, created_at
       limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  /**
   * Task PROGRAMMATE (status = 'PLANNED') di un singolo plot, ordinate per
   * data pianificata (senza data in coda) poi per creazione: è la query che il
   * geofencing esegue all'ingresso nel field per proporre la task
   * prioritaria nella modale di rilevamento.
   */
  async plannedTasksForPlot(plotId: string): Promise<PlannedTask[]> {
    const result = await this.db.query<PlannedTask>(
      `select * from planned_tasks
       where plot_id = $1 and status = 'PLANNED' and deleted_at is null
       order by planned_date nulls last, created_at`,
      [plotId],
    );
    return result.rows;
  }

  /**
   * Aggiorna SOLO lo status di una task (rilettura + riscrittura completa via
   * outbox, come ogni altra mutazione LWW). Ritorna la row aggiornata o null
   * se la task non esiste (più cancellata).
   */
  async setPlannedTaskStatus(
    id: string,
    status: PlannedTaskStatus,
  ): Promise<PlannedTask | null> {
    const existing = await this.getPlannedTask(id);
    if (!existing || existing.deleted_at) return null;
    const row: PlannedTask = { ...existing, status, updated_at: nowIso() };
    await this.writeWithOutbox(
      "planned_tasks",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  // -- sessioni a bordo campo ---------------------------------------------

  /**
   * Avvia una sessione a bordo campo: insert della sessione IN_PROGRESS con
   * tracciato vuoto (il tracking GPS lo popola) e, se agganciata
   * a una task programmata, flip ATOMICO della task a IN_PROGRESS — stessa
   * transazione, entrambe le voci di outbox: mai una sessione avviata con la
   * task ancora PLANNED, né una task IN_PROGRESS senza sessione viva.
   */
  async startFieldSession(
    input: Omit<
      FieldOperationSession,
      | "id"
      | "tenant_id"
      | "start_time"
      | "end_time"
      | "path"
      | "path_length_m"
      | "area_worked_ha"
      | "status"
      | "audio_notes"
      | "treatment_log_ids"
      | "created_at"
      | "updated_at"
      | "deleted_at"
    > & { id?: string; start_time?: string },
  ): Promise<FieldOperationSession> {
    const ts = nowIso();
    const session: FieldOperationSession = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      planned_task_id: input.planned_task_id ?? null,
      plot_id: input.plot_id,
      operation_type: input.operation_type,
      recipe_id: input.recipe_id ?? null,
      machine_id: input.machine_id ?? null,
      equipment_id: input.equipment_id ?? null,
      working_width_m: input.working_width_m ?? null,
      start_time: input.start_time ?? ts,
      end_time: null,
      path: { type: "LineString", coordinates: [] },
      path_length_m: 0,
      area_worked_ha: 0,
      status: "IN_PROGRESS",
      audio_notes: [],
      treatment_log_ids: [],
      operator_name: input.operator_name ?? null,
      notes: input.notes ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.transaction(async (tx: Transaction) => {
      const insSession = upsertSql(
        "field_operation_sessions",
        session as unknown as Row,
      );
      await tx.query(insSession.sql, insSession.values);
      await this.enqueueOutbox(
        tx,
        "field_operation_sessions",
        "insert",
        session as unknown as Row & { id: string },
      );

      if (session.planned_task_id) {
        const found = await tx.query<PlannedTask>(
          `select * from planned_tasks where id = $1 and deleted_at is null`,
          [session.planned_task_id],
        );
        const task = found.rows[0];
        if (task) {
          const updatedTask: PlannedTask = {
            ...task,
            status: "IN_PROGRESS",
            updated_at: ts,
          };
          const updTask = upsertSql(
            "planned_tasks",
            updatedTask as unknown as Row,
          );
          await tx.query(updTask.sql, updTask.values);
          await this.enqueueOutbox(
            tx,
            "planned_tasks",
            "update",
            updatedTask as unknown as Row & { id: string },
          );
        }
      }
    });
    return session;
  }

  /**
   * Aggiornamento parziale di una sessione (rilettura + merge + riscrittura
   * completa via outbox): usato dal tracking GPS (patch di `path`/
   * `path_length_m`/`area_worked_ha`) e dalla chiusura (patch di
   * `status`/`end_time`/`audio_notes`/`treatment_log_ids`). Ritorna la row
   * aggiornata o null se la sessione non esiste.
   */
  async updateFieldSession(
    id: string,
    patch: Partial<
      Omit<
        FieldOperationSession,
        "id" | "tenant_id" | "company_id" | "created_at" | "deleted_at"
      >
    >,
  ): Promise<FieldOperationSession | null> {
    const existing = await this.getFieldSession(id);
    if (!existing || existing.deleted_at) return null;
    const row: FieldOperationSession = {
      ...existing,
      ...patch,
      updated_at: nowIso(),
    };
    await this.writeWithOutbox(
      "field_operation_sessions",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  /**
   * Abbandona una sessione a bordo campo SENZA registrarla: sessione ⇒
   * ABORTED (`end_time` valorizzato, come ogni transizione terminale) e, se
   * agganciata a una task programmata, la task torna a PLANNED nella STESSA
   * transazione — l'avvio accidentale di una sessione (geofencing con task
   * sbagliata, tap involontario) è così completamente reversibile: mai una
   * task bloccata IN_PROGRESS senza una sessione viva a cui appartiene.
   * Ritorna la sessione aggiornata o null se non esiste/già cancellata.
   */
  async abortFieldSession(id: string): Promise<FieldOperationSession | null> {
    const existing = await this.getFieldSession(id);
    if (!existing || existing.deleted_at) return null;
    const ts = nowIso();
    const session: FieldOperationSession = {
      ...existing,
      status: "ABORTED",
      end_time: existing.end_time ?? ts,
      updated_at: ts,
    };
    await this.db.transaction(async (tx: Transaction) => {
      const updSession = upsertSql(
        "field_operation_sessions",
        session as unknown as Row,
      );
      await tx.query(updSession.sql, updSession.values);
      await this.enqueueOutbox(
        tx,
        "field_operation_sessions",
        "update",
        session as unknown as Row & { id: string },
      );

      if (session.planned_task_id) {
        const found = await tx.query<PlannedTask>(
          `select * from planned_tasks where id = $1 and deleted_at is null`,
          [session.planned_task_id],
        );
        const task = found.rows[0];
        if (task && task.status === "IN_PROGRESS") {
          const updatedTask: PlannedTask = {
            ...task,
            status: "PLANNED",
            updated_at: ts,
          };
          const updTask = upsertSql(
            "planned_tasks",
            updatedTask as unknown as Row,
          );
          await tx.query(updTask.sql, updTask.values);
          await this.enqueueOutbox(
            tx,
            "planned_tasks",
            "update",
            updatedTask as unknown as Row & { id: string },
          );
        }
      }
    });
    return session;
  }

  async getFieldSession(id: string): Promise<FieldOperationSession | null> {
    const result = await this.db.query<FieldOperationSession>(
      `select * from field_operation_sessions where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listFieldSessions(
    companyId: string,
    options: {
      plotId?: string;
      status?: FieldSessionStatus;
      limit?: number;
    } = {},
  ): Promise<FieldOperationSession[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.plotId) {
      params.push(options.plotId);
      conditions.push(`plot_id = $${params.length}`);
    }
    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(options.limit ?? 200);
    const result = await this.db.query<FieldOperationSession>(
      `select * from field_operation_sessions
       where ${conditions.join(" and ")}
       order by start_time desc
       limit $${params.length}`,
      params,
    );
    return result.rows;
  }

  /**
   * Sessione attiva dell'azienda (status IN_PROGRESS o PAUSED), la più
   * recente, o null se nessuna: la Modalità Campo ne ammette una sola
   * alla volta per azienda.
   */
  async activeFieldSession(
    companyId: string,
  ): Promise<FieldOperationSession | null> {
    const result = await this.db.query<FieldOperationSession>(
      `select * from field_operation_sessions
       where company_id = $1
         and status in ('IN_PROGRESS', 'PAUSED')
         and deleted_at is null
       order by start_time desc
       limit 1`,
      [companyId],
    );
    return result.rows[0] ?? null;
  }
}
