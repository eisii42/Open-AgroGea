import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  AudioNote,
  FieldOperationSession,
  FieldSessionStatus,
  PlannedTask,
  PlannedTaskStatus,
  Recipe,
  TreatmentLog,
} from "../types";
import type { SessionLogDraft } from "../field/session-logbook";
import { AgroDalMachinery } from "./dal-machinery";
import { nowIso, type Row, upsertSql } from "./write";

/**
 * Schema dell'URI dei blob audio delle sessioni a bordo campo
 * (`field_session_audio`, LOCAL-ONLY): `AudioNote.audio_uri` è sempre
 * `${AUDIO_URI_SCHEME}<blob_id>`. Usato da {@link AgroDalTasks.saveAudioNote}/
 * {@link AgroDalTasks.loadAudioBlob} (registrazione e riproduzione delle note
 * vocali dell'InFieldDashboard).
 */
export const AUDIO_URI_SCHEME = "agro-audio://";

/** Blob di una nota vocale letto da `field_session_audio` (senza il `session_id`: chi legge parte sempre dall'`audio_uri`, non serve). */
export interface AudioBlob {
  mime_type: string;
  data_base64: string;
  duration_s: number | null;
}

/** Esito della chiusura di una sessione verso il Quaderno di Campagna. */
export interface CompleteFieldSessionResult {
  session: FieldOperationSession;
  /** Righe del Quaderno create; vuoto se la sessione era già chiusa. */
  treatments: TreatmentLog[];
  /**
   * true quando la sessione risultava GIÀ `COMPLETED` alla rilettura in
   * transazione: nessuna scrittura è stata eseguita (guardia di idempotenza
   * contro doppi tap e retry).
   */
  alreadyCompleted: boolean;
}

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
      metadata: input.metadata ?? existing?.metadata ?? {},
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
   * CHIUSURA della sessione a bordo campo: scrive le righe del Quaderno di
   * Campagna e chiude tutto in UNA SOLA transazione — righe `treatment_logs`
   * (una per product della miscela), eventuali scarichi warehouse dei lots
   * con CUMP congelato, sessione ⇒ COMPLETED (con `end_time`, metriche finali
   * del tracciato e `treatment_log_ids`), task programmata ⇒ COMPLETED.
   *
   * L'atomicità qui non è un vezzo: il Quaderno è un registro di rilevanza
   * legale e la scrittura è AUTOMATICA (nessuna conferma dell'operatore). Una
   * chiusura a metà significherebbe lavoro registrato due volte o perso, senza
   * nessuno a notarlo. Se un lot è scaduto o la stock andrebbe sotto zero,
   * il {@link WarehouseError} di {@link issueLotsTx} annulla l'INTERA chiusura
   * (il chiamante decide se ritentare senza scarico: vedi lo store).
   *
   * IDEMPOTENTE per costruzione: lo status della sessione è riletto DENTRO la
   * transazione e una sessione già COMPLETED esce senza scrivere nulla
   * (`alreadyCompleted: true`). Un doppio tap su CONCLUDI, o un retry dopo un
   * errore, non possono quindi duplicare le righe del registro.
   */
  async completeFieldSession(
    sessionId: string,
    drafts: SessionLogDraft[],
    patch: Partial<
      Pick<
        FieldOperationSession,
        "end_time" | "path" | "path_length_m" | "area_worked_ha" | "audio_notes"
      >
    > = {},
  ): Promise<CompleteFieldSessionResult | null> {
    const existing = await this.getFieldSession(sessionId);
    if (!existing || existing.deleted_at) return null;

    const ts = nowIso();
    const treatments: TreatmentLog[] = [];
    let alreadyCompleted = false;
    let session = existing;

    await this.db.transaction(async (tx: Transaction) => {
      // Rilettura DENTRO la transazione: è questa, non il controllo a monte,
      // la guardia contro la doppia registrazione.
      const fresh = await tx.query<FieldOperationSession>(
        `select * from field_operation_sessions
         where id = $1 and deleted_at is null`,
        [sessionId],
      );
      const current = fresh.rows[0];
      if (!current) return;
      if (current.status === "COMPLETED") {
        alreadyCompleted = true;
        session = current;
        return;
      }

      for (const draft of drafts) {
        const treatment: TreatmentLog = {
          ...draft.input,
          id: uuidv4(),
          tenant_id: this.tenantId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        await this.insertTreatmentTx(tx, treatment);
        if (draft.issues.length > 0) {
          await this.issueLotsTx(tx, treatment.id, draft.issues, ts);
        }
        treatments.push(treatment);
      }

      const closed: FieldOperationSession = {
        ...current,
        ...patch,
        end_time: patch.end_time ?? current.end_time ?? ts,
        status: "COMPLETED",
        treatment_log_ids: treatments.map((t) => t.id),
        updated_at: ts,
      };
      const updSession = upsertSql(
        "field_operation_sessions",
        closed as unknown as Row,
      );
      await tx.query(updSession.sql, updSession.values);
      await this.enqueueOutbox(
        tx,
        "field_operation_sessions",
        "update",
        closed as unknown as Row & { id: string },
      );
      session = closed;

      if (closed.planned_task_id) {
        const found = await tx.query<PlannedTask>(
          `select * from planned_tasks where id = $1 and deleted_at is null`,
          [closed.planned_task_id],
        );
        const task = found.rows[0];
        if (task && task.status !== "COMPLETED") {
          const updatedTask: PlannedTask = {
            ...task,
            status: "COMPLETED",
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

    return {
      session,
      treatments: alreadyCompleted ? [] : treatments,
      alreadyCompleted,
    };
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

  // -- note vocali geotaggate (LOCAL-ONLY) ---------------------------------

  /**
   * Registra una nota vocale della sessione: INSERT diretto (query normale,
   * NON {@link writeWithOutbox}) del blob in `field_session_audio` — quella
   * tabella è LOCAL-ONLY e non deve MAI produrre una voce in `sync_outbox` —
   * più append dell'{@link AudioNote} nel jsonb `audio_notes` della sessione,
   * che invece SÌ sincronizza (viaggia la sessione, non il peso del blob).
   * Le due scritture avvengono nella STESSA transazione: mai un blob orfano
   * senza la sua voce in `audio_notes`, né una voce senza il blob referenziato.
   * Ritorna la nota creata, o null se la sessione non esiste/è cancellata.
   */
  async saveAudioNote(
    sessionId: string,
    input: {
      mime_type: string;
      duration_s: number | null;
      data_base64: string;
      lat: number;
      lon: number;
    },
  ): Promise<AudioNote | null> {
    const existing = await this.getFieldSession(sessionId);
    if (!existing || existing.deleted_at) return null;
    const blobId = uuidv4();
    const note: AudioNote = {
      id: uuidv4(),
      recorded_at: nowIso(),
      lat: input.lat,
      lon: input.lon,
      duration_s: input.duration_s,
      mime_type: input.mime_type,
      audio_uri: `${AUDIO_URI_SCHEME}${blobId}`,
    };
    const session: FieldOperationSession = {
      ...existing,
      audio_notes: [...existing.audio_notes, note],
      updated_at: nowIso(),
    };
    await this.db.transaction(async (tx: Transaction) => {
      // Blob LOCAL-ONLY: insert diretto senza passare da enqueueOutbox.
      await tx.query(
        `insert into field_session_audio (id, session_id, mime_type, duration_s, data_base64)
         values ($1, $2, $3, $4, $5)`,
        [blobId, sessionId, input.mime_type, input.duration_s, input.data_base64],
      );
      const upd = upsertSql(
        "field_operation_sessions",
        session as unknown as Row,
      );
      await tx.query(upd.sql, upd.values);
      await this.enqueueOutbox(
        tx,
        "field_operation_sessions",
        "update",
        session as unknown as Row & { id: string },
      );
    });
    return note;
  }

  /**
   * Legge il blob di una nota vocale dal suo `audio_uri`
   * (`${AUDIO_URI_SCHEME}<blob_id>`). Ritorna null se l'URI non ha lo schema
   * atteso o se il blob non esiste (es. già cancellato a cascata con la
   * sessione, vedi `field_session_audio.session_id ... on delete cascade`).
   */
  async loadAudioBlob(audioUri: string): Promise<AudioBlob | null> {
    if (!audioUri.startsWith(AUDIO_URI_SCHEME)) return null;
    const blobId = audioUri.slice(AUDIO_URI_SCHEME.length);
    const result = await this.db.query<AudioBlob>(
      `select mime_type, duration_s, data_base64
       from field_session_audio
       where id = $1`,
      [blobId],
    );
    return result.rows[0] ?? null;
  }
}
