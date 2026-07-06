import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  CostoProdottiCampo,
  LottoProdotto,
  Prodotto,
  RegistroTrattamento,
  ScaricoAttivita,
  ScaricoRichiesta,
} from "../types";
import {
  cumpDopoCarico,
  lottoScaduto,
  validateProdotto,
} from "../warehouse/cump";
import { AgroDalLogbook } from "./dal-logbook";
import { nowIso, type Row, upsertSql } from "./write";

/**
 * Errore di dominio del Magazzino: rialzato TAL QUALE alla UI (messaggio
 * leggibile). `code` permette alla UI di tradurre/decorare senza fare parsing
 * del testo.
 */
export class WarehouseError extends Error {
  constructor(
    readonly code:
      | "insufficient_stock"
      | "expired_lot"
      | "lot_not_found"
      | "invalid_product",
    message: string,
  ) {
    super(message);
    this.name = "WarehouseError";
  }
}

/**
 * Strato "Magazzino" del DAL (0.2.0): anagrafica prodotti (categorie rigide),
 * lotti con scadenza/giacenza, carico con aggiornamento CUMP e scarico ATOMICO
 * agganciato alle attività del Quaderno. Ogni scrittura segue il percorso
 * transazionale dato+outbox; le operazioni multi-riga (carico, scarico,
 * storno) vivono in UN'UNICA transazione: o si conferma tutto, o niente.
 */
export class AgroDalWarehouse extends AgroDalLogbook {
  // -- products (anagrafica) --------------------------------------------------

  /**
   * Crea o aggiorna un prodotto di magazzino. Valida i campi obbligatori della
   * categoria (`validateProdotto`); il CUMP (`avg_unit_cost`) NON si imposta da
   * qui: lo aggiorna solo il carico lotti ({@link caricaLotto}).
   */
  async upsertProdotto(
    input: Omit<
      Prodotto,
      "id" | "tenant_id" | "avg_unit_cost" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string; created_at?: string; avg_unit_cost?: number },
  ): Promise<Prodotto> {
    const errors = validateProdotto(input);
    if (errors.length > 0) {
      throw new WarehouseError(
        "invalid_product",
        `Anagrafica prodotto incompleta per la categoria "${input.category}": ` +
          errors.map((e) => e.field).join(", "),
      );
    }
    const ts = nowIso();
    const esistente = input.id ? await this.getProdotto(input.id) : null;
    const row: Prodotto = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      category: input.category,
      name: input.name.trim(),
      unit: input.unit.trim(),
      registration_number: input.registration_number ?? null,
      npk_n: input.npk_n ?? null,
      npk_p: input.npk_p ?? null,
      npk_k: input.npk_k ?? null,
      uma_code: input.uma_code ?? null,
      // Il CUMP sopravvive agli update anagrafici (lo muove solo il carico).
      avg_unit_cost: input.avg_unit_cost ?? esistente?.avg_unit_cost ?? 0,
      notes: input.notes ?? null,
      created_at: input.created_at ?? esistente?.created_at ?? ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.writeWithOutbox(
      "products",
      "update",
      row as unknown as Row & { id: string },
    );
    return row;
  }

  async getProdotto(id: string): Promise<Prodotto | null> {
    const result = await this.db.query<Prodotto>(
      `select * from products where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listProdotti(
    aziendaId: string,
    options: { categoria?: Prodotto["category"] } = {},
  ): Promise<Prodotto[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [aziendaId];
    if (options.categoria) {
      params.push(options.categoria);
      conditions.push(`category = $${params.length}`);
    }
    const result = await this.db.query<Prodotto>(
      `select * from products
       where ${conditions.join(" and ")}
       order by category, name`,
      params,
    );
    return result.rows;
  }

  async deleteProdotto(id: string): Promise<void> {
    await this.softDelete("products", id);
  }

  // -- product_lots (carichi e giacenze) --------------------------------------

  /**
   * CARICO di un nuovo lotto: inserisce il lotto e aggiorna il CUMP del
   * prodotto (media ponderata sulla giacenza complessiva corrente) nella
   * STESSA transazione, con entrambe le voci di outbox. §5.3.
   */
  async caricaLotto(
    input: Omit<
      LottoProdotto,
      "id" | "tenant_id" | "quantity_on_hand" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ): Promise<LottoProdotto> {
    const ts = nowIso();
    const prodotto = await this.getProdotto(input.product_id);
    if (!prodotto || prodotto.deleted_at) {
      throw new WarehouseError(
        "invalid_product",
        `Prodotto ${input.product_id} inesistente: carico annullato.`,
      );
    }
    const lotto: LottoProdotto = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      product_id: input.product_id,
      lot_number: input.lot_number ?? null,
      expires_at: input.expires_at ?? null,
      initial_quantity: input.initial_quantity,
      quantity_on_hand: input.initial_quantity,
      unit_cost: input.unit_cost,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.transaction(async (tx: Transaction) => {
      // Giacenza complessiva PRIMA del carico (tutti i lotti vivi del prodotto):
      // è il peso della media ponderata mobile.
      const giacenza = await tx.query<{ q: number | string | null }>(
        `select coalesce(sum(quantity_on_hand), 0) as q from product_lots
         where product_id = $1 and deleted_at is null`,
        [input.product_id],
      );
      const giacenzaEsistente = Number(giacenza.rows[0]?.q ?? 0);
      const nuovoCump = cumpDopoCarico(
        giacenzaEsistente,
        Number(prodotto.avg_unit_cost),
        input.initial_quantity,
        input.unit_cost,
      );

      const insLotto = upsertSql("product_lots", lotto as unknown as Row);
      await tx.query(insLotto.sql, insLotto.values);
      await this.enqueueOutbox(
        tx,
        "product_lots",
        "insert",
        lotto as unknown as Row & { id: string },
      );

      const prodottoAggiornato: Prodotto = {
        ...prodotto,
        avg_unit_cost: nuovoCump,
        updated_at: ts,
      };
      const insProd = upsertSql("products", prodottoAggiornato as unknown as Row);
      await tx.query(insProd.sql, insProd.values);
      await this.enqueueOutbox(
        tx,
        "products",
        "update",
        prodottoAggiornato as unknown as Row & { id: string },
      );
    });
    return lotto;
  }

  async listLotti(
    aziendaId: string,
    options: { productId?: string; soloDisponibili?: boolean } = {},
  ): Promise<LottoProdotto[]> {
    const conditions = [
      "p.company_id = $1",
      "l.deleted_at is null",
      "p.deleted_at is null",
    ];
    const params: unknown[] = [aziendaId];
    if (options.productId) {
      params.push(options.productId);
      conditions.push(`l.product_id = $${params.length}`);
    }
    if (options.soloDisponibili) {
      conditions.push("l.quantity_on_hand > 0");
    }
    const result = await this.db.query<LottoProdotto>(
      `select l.* from product_lots l
       join products p on p.id = l.product_id
       where ${conditions.join(" and ")}
       order by l.expires_at nulls last, l.created_at`,
      params,
    );
    return result.rows;
  }

  /**
   * Lotti con giacenza > 0 scaduti o in scadenza entro `warningDays` giorni
   * (alert §5.1). L'ordinamento mette prima le scadenze più urgenti.
   */
  async listLottiInScadenza(
    aziendaId: string,
    warningDays: number,
  ): Promise<LottoProdotto[]> {
    const result = await this.db.query<LottoProdotto>(
      `select l.* from product_lots l
       join products p on p.id = l.product_id
       where p.company_id = $1
         and l.deleted_at is null and p.deleted_at is null
         and l.quantity_on_hand > 0
         and l.expires_at is not null
         and l.expires_at <= (current_date + $2::int)
       order by l.expires_at`,
      [aziendaId, warningDays],
    );
    return result.rows;
  }

  async deleteLotto(id: string): Promise<void> {
    await this.softDelete("product_lots", id);
  }

  // -- scarico atomico (attività ↔ lotti) --------------------------------------

  /**
   * Registra un'attività del Quaderno E scarica i lotti richiesti in UN'UNICA
   * transazione (§5.2): se un lotto è scaduto, inesistente o la giacenza
   * andrebbe sotto zero, l'INTERA operazione fallisce (nessuno scarico
   * parziale, nessuna attività orfana). Il costo imputato è quantità × CUMP
   * del prodotto al momento dello scarico (§5.3), congelato in
   * `activity_products` (§5.4). Con `scarichi` vuoto degrada a
   * {@link insertTrattamento} (fallback testo libero intatto).
   */
  async insertTrattamentoConScarichi(
    input: Omit<
      RegistroTrattamento,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
    scarichi: ScaricoRichiesta[],
  ): Promise<{ trattamento: RegistroTrattamento; scarichi: ScaricoAttivita[] }> {
    if (scarichi.length === 0) {
      return { trattamento: await this.insertTrattamento(input), scarichi: [] };
    }
    const ts = nowIso();
    const trattamento: RegistroTrattamento = {
      ...input,
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    const righeScarico: ScaricoAttivita[] = [];

    await this.db.transaction(async (tx: Transaction) => {
      const insTratt = upsertSql("treatment_logs", trattamento as unknown as Row);
      await tx.query(insTratt.sql, insTratt.values);
      await this.enqueueOutbox(
        tx,
        "treatment_logs",
        "insert",
        trattamento as unknown as Row & { id: string },
      );

      for (const richiesta of scarichi) {
        const lookup = await tx.query<LottoProdotto & { avg_unit_cost: number | string; product_name: string }>(
          `select l.*, p.avg_unit_cost, p.name as product_name
           from product_lots l join products p on p.id = l.product_id
           where l.id = $1 and l.deleted_at is null`,
          [richiesta.product_lot_id],
        );
        const lotto = lookup.rows[0];
        if (!lotto) {
          throw new WarehouseError(
            "lot_not_found",
            `Lotto ${richiesta.product_lot_id} inesistente: registrazione annullata.`,
          );
        }
        // Uso di lotti scaduti BLOCCATO (comportamento §5.1, esplicitato in UI).
        if (lottoScaduto(lotto)) {
          throw new WarehouseError(
            "expired_lot",
            `Il lotto ${lotto.lot_number ?? lotto.id.slice(0, 8)} di "${lotto.product_name}" è scaduto il ${lotto.expires_at}: uso bloccato.`,
          );
        }
        const disponibile = Number(lotto.quantity_on_hand);
        if (richiesta.quantity > disponibile) {
          throw new WarehouseError(
            "insufficient_stock",
            `Giacenza insufficiente per il lotto ${lotto.lot_number ?? lotto.id.slice(0, 8)} di "${lotto.product_name}": disponibili ${disponibile}, richiesti ${richiesta.quantity}. Nessuno scarico eseguito.`,
          );
        }

        // UPDATE della giacenza: il CHECK `quantity_on_hand >= 0` a schema è la
        // rete di sicurezza atomica anche in caso di scritture concorrenti.
        // La riga di outbox è COMPLETA (solo colonne di product_lots, senza i
        // campi del join) come ogni altra mutazione sincronizzata.
        const lottoAggiornato: LottoProdotto = {
          id: lotto.id,
          tenant_id: lotto.tenant_id,
          product_id: lotto.product_id,
          lot_number: lotto.lot_number,
          expires_at: lotto.expires_at,
          initial_quantity: lotto.initial_quantity,
          quantity_on_hand:
            Math.round((disponibile - richiesta.quantity) * 1000) / 1000,
          unit_cost: lotto.unit_cost,
          created_at: lotto.created_at,
          updated_at: ts,
          deleted_at: null,
        };
        const updLotto = upsertSql("product_lots", lottoAggiornato as unknown as Row);
        await tx.query(updLotto.sql, updLotto.values);
        await this.enqueueOutbox(
          tx,
          "product_lots",
          "update",
          lottoAggiornato as unknown as Row & { id: string },
        );

        // Costo imputato = CUMP del prodotto CONGELATO al momento dello scarico.
        const cump = Number(lotto.avg_unit_cost);
        const scarico: ScaricoAttivita = {
          id: uuidv4(),
          tenant_id: this.tenantId,
          treatment_log_id: trattamento.id,
          product_lot_id: lotto.id,
          quantity: richiesta.quantity,
          unit_cost: cump,
          total_cost: Math.round(richiesta.quantity * cump * 10000) / 10000,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        const insScarico = upsertSql("activity_products", scarico as unknown as Row);
        await tx.query(insScarico.sql, insScarico.values);
        await this.enqueueOutbox(
          tx,
          "activity_products",
          "insert",
          scarico as unknown as Row & { id: string },
        );
        righeScarico.push(scarico);
      }
    });
    return { trattamento, scarichi: righeScarico };
  }

  /**
   * Soft-delete di un'operazione del Quaderno con STORNO magazzino: tombstone
   * dell'attività e dei suoi scarichi + reintegro delle giacenze dei lotti,
   * tutto in un'unica transazione (l'inventario resta coerente). Sostituisce
   * {@link AgroDalLogbook.deleteTrattamento} per le attività con scarichi.
   */
  override async deleteTrattamento(id: string): Promise<void> {
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

      const scarichi = await tx.query<ScaricoAttivita>(
        `select * from activity_products
         where treatment_log_id = $1 and deleted_at is null`,
        [id],
      );
      for (const scarico of scarichi.rows) {
        await tx.query(
          `update product_lots
           set quantity_on_hand = quantity_on_hand + $2, updated_at = $3
           where id = $1 and deleted_at is null`,
          [scarico.product_lot_id, scarico.quantity, ts],
        );
        const lotto = await tx.query<LottoProdotto>(
          `select * from product_lots where id = $1`,
          [scarico.product_lot_id],
        );
        if (lotto.rows[0]) {
          await this.enqueueOutbox(
            tx,
            "product_lots",
            "update",
            lotto.rows[0] as unknown as Row & { id: string },
          );
        }
        await tx.query(
          `update activity_products set deleted_at = $2, updated_at = $2 where id = $1`,
          [scarico.id, ts],
        );
        await this.enqueueOutbox(tx, "activity_products", "delete", {
          id: scarico.id,
          updated_at: ts,
        } as Row & { id: string });
      }
    });
  }

  /** Scarichi (con lotto e prodotto) di una singola attività del Quaderno. */
  async listScarichiAttivita(
    treatmentLogId: string,
  ): Promise<Array<ScaricoAttivita & { lot_number: string | null; product_name: string; unit: string }>> {
    const result = await this.db.query<
      ScaricoAttivita & { lot_number: string | null; product_name: string; unit: string }
    >(
      `select a.*, l.lot_number, p.name as product_name, p.unit
       from activity_products a
       join product_lots l on l.id = a.product_lot_id
       join products p on p.id = l.product_id
       where a.treatment_log_id = $1 and a.deleted_at is null
       order by a.created_at`,
      [treatmentLogId],
    );
    return result.rows;
  }

  /**
   * Costo vivo dei prodotti scaricati, aggregato per campo trattato (§5.4):
   * base del bilancio di campo (0.4.0). `plot_id` null = operazioni "intera
   * azienda".
   */
  async costiProdottiPerCampo(
    aziendaId: string,
    options: { dal?: string; al?: string } = {},
  ): Promise<CostoProdottiCampo[]> {
    const conditions = [
      "t.company_id = $1",
      "a.deleted_at is null",
      "t.deleted_at is null",
    ];
    const params: unknown[] = [aziendaId];
    if (options.dal) {
      params.push(options.dal);
      conditions.push(`t.executed_at >= $${params.length}`);
    }
    if (options.al) {
      params.push(options.al);
      conditions.push(`t.executed_at <= $${params.length}`);
    }
    const result = await this.db.query<CostoProdottiCampo>(
      `select t.plot_id, sum(a.total_cost)::float as total_cost
       from activity_products a
       join treatment_logs t on t.id = a.treatment_log_id
       where ${conditions.join(" and ")}
       group by t.plot_id
       order by total_cost desc`,
      params,
    );
    return result.rows;
  }
}
