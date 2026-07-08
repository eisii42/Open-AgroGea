import type { Transaction } from "@electric-sql/pglite";
import { v4 as uuidv4 } from "uuid";
import type {
  FieldProductCost,
  ProductLot,
  Product,
  TreatmentLog,
  ActivityProduct,
  IssueRequest,
} from "../types";
import {
  cumpAfterInbound,
  lotExpired,
  validateProduct,
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
 * Strato "Magazzino" del DAL (0.2.0): anagrafica products (categorie rigide),
 * lots con scadenza/stock, carico con aggiornamento CUMP e issue ATOMICO
 * agganciato alle attività del Quaderno. Ogni scrittura segue il percorso
 * transazionale dato+outbox; le operazioni multi-row (carico, issue,
 * storno) vivono in UN'UNICA transazione: o si conferma tutto, o niente.
 */
export class AgroDalWarehouse extends AgroDalLogbook {
  // -- products (anagrafica) --------------------------------------------------

  /**
   * Crea o update un product di warehouse. Valida i campi obbligatori della
   * categoria (`validateProduct`); il CUMP (`avg_unit_cost`) NON si imposta da
   * qui: lo update solo il carico lots ({@link receiveLot}).
   */
  async upsertProduct(
    input: Omit<
      Product,
      | "id"
      | "tenant_id"
      | "active_substance"
      | "supplier"
      | "metadata"
      | "avg_unit_cost"
      | "created_at"
      | "updated_at"
      | "deleted_at"
    > &
      Partial<Pick<Product, "active_substance" | "supplier" | "metadata">> & {
        id?: string;
        created_at?: string;
        avg_unit_cost?: number;
      },
  ): Promise<Product> {
    const errors = validateProduct(input);
    if (errors.length > 0) {
      throw new WarehouseError(
        "invalid_product",
        `Anagrafica product incompleta per la categoria "${input.category}": ` +
          errors.map((e) => e.field).join(", "),
      );
    }
    const ts = nowIso();
    const esistente = input.id ? await this.getProduct(input.id) : null;
    const row: Product = {
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      company_id: input.company_id,
      category: input.category,
      name: input.name.trim(),
      unit: input.unit.trim(),
      registration_number: input.registration_number ?? null,
      active_substance: input.active_substance ?? null,
      npk_n: input.npk_n ?? null,
      npk_p: input.npk_p ?? null,
      npk_k: input.npk_k ?? null,
      uma_code: input.uma_code ?? null,
      supplier: input.supplier ?? null,
      // Il CUMP sopravvive agli update anagrafici (lo muove solo il carico).
      avg_unit_cost: input.avg_unit_cost ?? esistente?.avg_unit_cost ?? 0,
      notes: input.notes ?? null,
      metadata: input.metadata ?? esistente?.metadata ?? {},
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

  async getProduct(id: string): Promise<Product | null> {
    const result = await this.db.query<Product>(
      `select * from products where id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listProducts(
    companyId: string,
    options: { categoria?: Product["category"] } = {},
  ): Promise<Product[]> {
    const conditions = ["company_id = $1", "deleted_at is null"];
    const params: unknown[] = [companyId];
    if (options.categoria) {
      params.push(options.categoria);
      conditions.push(`category = $${params.length}`);
    }
    const result = await this.db.query<Product>(
      `select * from products
       where ${conditions.join(" and ")}
       order by category, name`,
      params,
    );
    return result.rows;
  }

  async deleteProduct(id: string): Promise<void> {
    await this.softDelete("products", id);
  }

  // -- product_lots (carichi e giacenze) --------------------------------------

  /**
   * CARICO di un nuovo lot: inserisce il lot e update il CUMP del
   * product (media ponderata sulla stock complessiva corrente) nella
   * STESSA transazione, con entrambe le voci di outbox. §5.3.
   */
  async receiveLot(
    input: Omit<
      ProductLot,
      "id" | "tenant_id" | "quantity_on_hand" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ): Promise<ProductLot> {
    const ts = nowIso();
    const product = await this.getProduct(input.product_id);
    if (!product || product.deleted_at) {
      throw new WarehouseError(
        "invalid_product",
        `Product ${input.product_id} inesistente: carico annullato.`,
      );
    }
    const lot: ProductLot = {
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
      // Giacenza complessiva PRIMA del carico (tutti i lots vivi del product):
      // è il peso della media ponderata mobile.
      const stock = await tx.query<{ q: number | string | null }>(
        `select coalesce(sum(quantity_on_hand), 0) as q from product_lots
         where product_id = $1 and deleted_at is null`,
        [input.product_id],
      );
      const existingStock = Number(stock.rows[0]?.q ?? 0);
      const newCump = cumpAfterInbound(
        existingStock,
        Number(product.avg_unit_cost),
        input.initial_quantity,
        input.unit_cost,
      );

      const insLot = upsertSql("product_lots", lot as unknown as Row);
      await tx.query(insLot.sql, insLot.values);
      await this.enqueueOutbox(
        tx,
        "product_lots",
        "insert",
        lot as unknown as Row & { id: string },
      );

      const updatedProduct: Product = {
        ...product,
        avg_unit_cost: newCump,
        updated_at: ts,
      };
      const insProd = upsertSql("products", updatedProduct as unknown as Row);
      await tx.query(insProd.sql, insProd.values);
      await this.enqueueOutbox(
        tx,
        "products",
        "update",
        updatedProduct as unknown as Row & { id: string },
      );
    });
    return lot;
  }

  async listLotti(
    companyId: string,
    options: { productId?: string; soloDisponibili?: boolean } = {},
  ): Promise<ProductLot[]> {
    const conditions = [
      "p.company_id = $1",
      "l.deleted_at is null",
      "p.deleted_at is null",
    ];
    const params: unknown[] = [companyId];
    if (options.productId) {
      params.push(options.productId);
      conditions.push(`l.product_id = $${params.length}`);
    }
    if (options.soloDisponibili) {
      conditions.push("l.quantity_on_hand > 0");
    }
    const result = await this.db.query<ProductLot>(
      `select l.* from product_lots l
       join products p on p.id = l.product_id
       where ${conditions.join(" and ")}
       order by l.expires_at nulls last, l.created_at`,
      params,
    );
    return result.rows;
  }

  /**
   * Lotti con stock > 0 scaduti o in scadenza entro `warningDays` giorni
   * (alert §5.1). L'ordinamento mette prima le scadenze più urgenti.
   */
  async listLottiInScadenza(
    companyId: string,
    warningDays: number,
  ): Promise<ProductLot[]> {
    const result = await this.db.query<ProductLot>(
      `select l.* from product_lots l
       join products p on p.id = l.product_id
       where p.company_id = $1
         and l.deleted_at is null and p.deleted_at is null
         and l.quantity_on_hand > 0
         and l.expires_at is not null
         and l.expires_at <= (current_date + $2::int)
       order by l.expires_at`,
      [companyId, warningDays],
    );
    return result.rows;
  }

  async deleteLot(id: string): Promise<void> {
    await this.softDelete("product_lots", id);
  }

  // -- issue atomico (attività ↔ lots) --------------------------------------

  /**
   * Registra un'attività del Quaderno E download i lots richiesti in UN'UNICA
   * transazione (§5.2): se un lot è scaduto, inesistente o la stock
   * andrebbe sotto zero, l'INTERA operation fallisce (nessuno issue
   * parziale, nessuna attività orfana). Il costo imputato è quantità × CUMP
   * del product al momento dello issue (§5.3), congelato in
   * `activity_products` (§5.4). Con `scarichi` vuoto degrada a
   * {@link insertTreatment} (fallback testo libero intatto).
   */
  async insertTreatmentWithIssues(
    input: Omit<
      TreatmentLog,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
    scarichi: IssueRequest[],
  ): Promise<{ treatment: TreatmentLog; scarichi: ActivityProduct[] }> {
    if (scarichi.length === 0) {
      return { treatment: await this.insertTreatment(input), scarichi: [] };
    }
    const ts = nowIso();
    const treatment: TreatmentLog = {
      ...input,
      id: input.id ?? uuidv4(),
      tenant_id: this.tenantId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    const issueRows: ActivityProduct[] = [];

    await this.db.transaction(async (tx: Transaction) => {
      const insTratt = upsertSql("treatment_logs", treatment as unknown as Row);
      await tx.query(insTratt.sql, insTratt.values);
      await this.enqueueOutbox(
        tx,
        "treatment_logs",
        "insert",
        treatment as unknown as Row & { id: string },
      );

      for (const richiesta of scarichi) {
        const lookup = await tx.query<ProductLot & { avg_unit_cost: number | string; product_name: string }>(
          `select l.*, p.avg_unit_cost, p.name as product_name
           from product_lots l join products p on p.id = l.product_id
           where l.id = $1 and l.deleted_at is null`,
          [richiesta.product_lot_id],
        );
        const lot = lookup.rows[0];
        if (!lot) {
          throw new WarehouseError(
            "lot_not_found",
            `Lotto ${richiesta.product_lot_id} inesistente: registrazione annullata.`,
          );
        }
        // Uso di lots scaduti BLOCCATO (comportamento §5.1, esplicitato in UI).
        if (lotExpired(lot)) {
          throw new WarehouseError(
            "expired_lot",
            `Il lot ${lot.lot_number ?? lot.id.slice(0, 8)} di "${lot.product_name}" è scaduto il ${lot.expires_at}: uso bloccato.`,
          );
        }
        const disponibile = Number(lot.quantity_on_hand);
        if (richiesta.quantity > disponibile) {
          throw new WarehouseError(
            "insufficient_stock",
            `Giacenza insufficiente per il lot ${lot.lot_number ?? lot.id.slice(0, 8)} di "${lot.product_name}": disponibili ${disponibile}, richiesti ${richiesta.quantity}. Nessuno issue eseguito.`,
          );
        }

        // UPDATE della stock: il CHECK `quantity_on_hand >= 0` a schema è la
        // rete di sicurezza atomica anche in caso di scritture concorrenti.
        // La row di outbox è COMPLETA (solo colonne di product_lots, senza i
        // campi del join) come ogni altra mutazione sincronizzata.
        const updatedLot: ProductLot = {
          id: lot.id,
          tenant_id: lot.tenant_id,
          product_id: lot.product_id,
          lot_number: lot.lot_number,
          expires_at: lot.expires_at,
          initial_quantity: lot.initial_quantity,
          quantity_on_hand:
            Math.round((disponibile - richiesta.quantity) * 1000) / 1000,
          unit_cost: lot.unit_cost,
          created_at: lot.created_at,
          updated_at: ts,
          deleted_at: null,
        };
        const updLot = upsertSql("product_lots", updatedLot as unknown as Row);
        await tx.query(updLot.sql, updLot.values);
        await this.enqueueOutbox(
          tx,
          "product_lots",
          "update",
          updatedLot as unknown as Row & { id: string },
        );

        // Costo imputato = CUMP del product CONGELATO al momento dello issue.
        const cump = Number(lot.avg_unit_cost);
        const issue: ActivityProduct = {
          id: uuidv4(),
          tenant_id: this.tenantId,
          treatment_log_id: treatment.id,
          product_lot_id: lot.id,
          quantity: richiesta.quantity,
          unit_cost: cump,
          total_cost: Math.round(richiesta.quantity * cump * 10000) / 10000,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        const insIssue = upsertSql("activity_products", issue as unknown as Row);
        await tx.query(insIssue.sql, insIssue.values);
        await this.enqueueOutbox(
          tx,
          "activity_products",
          "insert",
          issue as unknown as Row & { id: string },
        );
        issueRows.push(issue);
      }
    });
    return { treatment, scarichi: issueRows };
  }

  /**
   * Soft-delete di un'operazione del Quaderno con STORNO warehouse: tombstone
   * dell'attività e dei suoi scarichi + reintegro delle giacenze dei lots,
   * tutto in un'unica transazione (l'inventario resta coerente). Sostituisce
   * {@link AgroDalLogbook.deleteTreatment} per le attività con scarichi.
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

      const scarichi = await tx.query<ActivityProduct>(
        `select * from activity_products
         where treatment_log_id = $1 and deleted_at is null`,
        [id],
      );
      for (const issue of scarichi.rows) {
        await tx.query(
          `update product_lots
           set quantity_on_hand = quantity_on_hand + $2, updated_at = $3
           where id = $1 and deleted_at is null`,
          [issue.product_lot_id, issue.quantity, ts],
        );
        const lot = await tx.query<ProductLot>(
          `select * from product_lots where id = $1`,
          [issue.product_lot_id],
        );
        if (lot.rows[0]) {
          await this.enqueueOutbox(
            tx,
            "product_lots",
            "update",
            lot.rows[0] as unknown as Row & { id: string },
          );
        }
        await tx.query(
          `update activity_products set deleted_at = $2, updated_at = $2 where id = $1`,
          [issue.id, ts],
        );
        await this.enqueueOutbox(tx, "activity_products", "delete", {
          id: issue.id,
          updated_at: ts,
        } as Row & { id: string });
      }
    });
  }

  /** Scarichi (con lot e product) di una singola attività del Quaderno. */
  async listScarichiAttivita(
    treatmentLogId: string,
  ): Promise<Array<ActivityProduct & { lot_number: string | null; product_name: string; unit: string }>> {
    const result = await this.db.query<
      ActivityProduct & { lot_number: string | null; product_name: string; unit: string }
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
   * Costo vivo dei products scaricati, aggregato per field trattato (§5.4):
   * base del bilancio di field (0.4.0). `plot_id` null = operazioni "intera
   * azienda".
   */
  async productCostsPerField(
    companyId: string,
    options: { dal?: string; al?: string } = {},
  ): Promise<FieldProductCost[]> {
    const conditions = [
      "t.company_id = $1",
      "a.deleted_at is null",
      "t.deleted_at is null",
    ];
    const params: unknown[] = [companyId];
    if (options.dal) {
      params.push(options.dal);
      conditions.push(`t.executed_at >= $${params.length}`);
    }
    if (options.al) {
      params.push(options.al);
      conditions.push(`t.executed_at <= $${params.length}`);
    }
    const result = await this.db.query<FieldProductCost>(
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
