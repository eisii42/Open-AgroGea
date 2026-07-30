import type {
  FieldOperationSession,
  IssueRequest,
  Plot,
  PlannedTask,
  PlannedTaskMetadata,
  Product,
  ProductLot,
  Recipe,
  RecipeProduct,
  TreatmentLog,
} from "../types";
import { irrigationToLitres } from "./settings";
import { lotExpired } from "../warehouse/cump";
import type { OperatorMemory } from "./operator-memory";
import { toIsoString } from "./timestamps";

/**
 * Composizione PURA delle righe del Quaderno di Campagna a partire da una
 * sessione a bordo campo conclusa. Nessun accesso al DB: dati dentro, bozze
 * fuori — così la regola "cosa finisce nel registro" è testabile in isolamento,
 * separata dalla transazione che la persiste
 * ({@link AgroDalTasks.completeFieldSession}).
 *
 * Tre scelte di dominio che vivono qui:
 *
 *   * UNA RIGA PER PRODOTTO della ricetta. `treatment_logs` porta un solo
 *     product per row, ma una miscela ne ha spesso più d'uno (rame + zolfo):
 *     ogni riga di `recipes.products` diventa quindi una row del registro, e
 *     `field_operation_sessions.treatment_log_ids` le raccoglie tutte. Senza
 *     ricetta si scrive una singola row dal solo tipo di operation.
 *
 *   * QUANTITÀ DALLA SUPERFICIE GPS, non da quella catastale: il totale è
 *     `dose_per_ha × area_worked_ha`. È la ragione d'essere del tracciamento —
 *     usare `plots_registry.area_ha` significherebbe dichiarare prodotto su
 *     superficie non lavorata. Se il GPS non ha prodotto un tracciato
 *     utilizzabile si ricade sulla superficie dell'appezzamento e lo si
 *     SEGNALA ({@link SessionLogComposition.warnings}): meglio un record
 *     completo e marcato che una quantità nulla in un registro di compliance.
 *
 *   * OPERATORE DAL CONTESTO: name e patentino risalgono dalla task
 *     programmata o dalla memoria di dispositivo
 *     ({@link OperatorMemory}), mai `null` per pigrizia — un record senza
 *     patentino non è conforme al PAN, e con la scrittura automatica non c'è
 *     nessuno che se ne accorga al momento.
 */

/** Motivo per cui una chiusura merita l'attenzione dell'operatore nel riepilogo. */
export type SessionLogWarningKind =
  /** Il GPS non ha prodotto una superficie utile: si è usata quella dell'appezzamento. */
  | "gps_area_fallback"
  /** Nessun lot di warehouse utilizzabile per un product della ricetta. */
  | "no_lot_available"
  /**
   * Lo scarico warehouse è fallito (lot scaduto, giacenza insufficiente) e la
   * chiusura è stata ripetuta senza scarico: la lavorazione È registrata nel
   * Quaderno, ma le giacenze NON sono state aggiornate e vanno corrette a mano.
   */
  | "stock_issue_failed";

export interface SessionLogWarning {
  kind: SessionLogWarningKind;
  /** Prodotto interessato, quando il warning è per riga di ricetta. */
  productName?: string;
}

/** Bozza di una singola row del Quaderno + gli scarichi warehouse associati. */
export interface SessionLogDraft {
  input: Omit<
    TreatmentLog,
    "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
  >;
  issues: IssueRequest[];
}

export interface SessionLogComposition {
  drafts: SessionLogDraft[];
  /** Superficie effettivamente usata per le quantità (ha). */
  areaUsedHa: number;
  warnings: SessionLogWarning[];
}

export interface SessionLogContext {
  session: FieldOperationSession;
  plot: Pick<Plot, "id" | "area_ha"> | null;
  recipe: Pick<Recipe, "products" | "target_disease"> | null;
  task: Pick<PlannedTask, "operator_name" | "target_pest_or_disease"> | null;
  /**
   * Campi già pianificati sulla task per i tipi che non passano da una ricetta
   * (`planned_tasks.metadata`): riversati nella row del Quaderno invece di
   * essere richiesti di nuovo a bordo campo.
   */
  taskMetadata?: PlannedTaskMetadata | null;
  /** Campagna agraria aperta dell'appezzamento, se risolvibile. */
  plotCampaignId: string | null;
  operator: OperatorMemory;
  /** Anagrafica products del workspace: fonte di carenza/rientro di default. */
  products: Product[];
  /** Lotti di warehouse: lo scarico reale sceglie il lot a scadenza più vicina. */
  lots: ProductLot[];
}

/**
 * Prefisso della nota che lega una row del Quaderno alla sessione che l'ha
 * generata. Non è una FK (il Quaderno resta indipendente e modificabile a
 * mano), ma rende il legame ispezionabile.
 */
export const SESSION_NOTE_PREFIX = "field-session:";

/** Estrae l'id di sessione dalla nota di una row, o null se non ne porta una. */
export function sessionIdFromNote(note: string | null): string | null {
  if (!note || !note.startsWith(SESSION_NOTE_PREFIX)) return null;
  return note.slice(SESSION_NOTE_PREFIX.length).trim() || null;
}

/** Arrotondamento a 3 decimali delle quantità (come le colonne numeric del magazzino). */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Lotto da scaricare per un product: fra quelli con stock e non scaduti,
 * quello con la scadenza più VICINA (FEFO — first expired, first out: è la
 * regola che minimizza lo scarto in magazzino). I lots senza scadenza vanno in
 * coda, dopo quelli datati. `null` se non c'è nulla di utilizzabile.
 */
export function pickLotForProduct(
  productId: string,
  lots: ProductLot[],
): ProductLot | null {
  const usable = lots.filter(
    (lot) =>
      lot.product_id === productId &&
      lot.deleted_at == null &&
      Number(lot.quantity_on_hand) > 0 &&
      !lotExpired(lot),
  );
  if (usable.length === 0) return null;
  return usable.sort((a, b) => {
    if (a.expires_at && b.expires_at) return a.expires_at.localeCompare(b.expires_at);
    if (a.expires_at) return -1;
    if (b.expires_at) return 1;
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

/** Default di carenza/rientro dall'anagrafica del product (`products.metadata`). */
function safetyFromProduct(product: Product | undefined): {
  reentry: number | null;
  safety: number | null;
} {
  const metadata = product?.metadata ?? {};
  const reentry = metadata.reentry_interval_h;
  const safety = metadata.safety_period_days;
  return {
    reentry: typeof reentry === "number" ? reentry : null,
    safety: typeof safety === "number" ? safety : null,
  };
}

/**
 * Compone le righe del Quaderno per una sessione conclusa. Non lancia: una
 * sessione senza ricetta e senza appezzamento produce comunque una row
 * minima (il lavoro è stato fatto, va registrato).
 */
export function composeSessionLogs(
  context: SessionLogContext,
): SessionLogComposition {
  const { session, plot, recipe, task, operator } = context;
  const warnings: SessionLogWarning[] = [];

  // Superficie: quella percorsa dal GPS è la verità; il fallback catastale è
  // l'ultima risorsa e viene segnalato.
  const gpsArea = Number(session.area_worked_ha);
  let areaUsedHa = Number.isFinite(gpsArea) && gpsArea > 0 ? gpsArea : 0;
  if (areaUsedHa === 0) {
    areaUsedHa = plot ? Number(plot.area_ha) || 0 : 0;
    warnings.push({ kind: "gps_area_fallback" });
  }

  // `end_time` può arrivare come `Date` (row riletta da PGlite) o come stringa
  // ISO (row appena costruita): normalizzato, la row del Quaderno porta sempre
  // la forma canonica.
  const executedAt = toIsoString(session.end_time) ?? new Date().toISOString();
  const operatorName = task?.operator_name ?? operator.name ?? null;
  const targetDisease =
    task?.target_pest_or_disease ?? recipe?.target_disease ?? null;

  /** Campi comuni a ogni row prodotta da questa sessione. */
  const base = {
    company_id: session.company_id,
    plot_id: session.plot_id,
    plot_campaign_id: context.plotCampaignId,
    operation_type: session.operation_type,
    executed_at: executedAt,
    operator_name: operatorName,
    operator_tax_code: operator.taxCode ?? null,
    license_number: operator.license ?? null,
    machinery_equipment: null,
    water_volume_l: null,
    weather_conditions: null,
    // Traccia il legame row ↔ sessione: il riepilogo e un'eventuale ispezione
    // successiva possono risalire al tracciato GPS che l'ha generata.
    note: `${SESSION_NOTE_PREFIX}${session.id}`,
  } satisfies Partial<SessionLogDraft["input"]>;

  const recipeRows: RecipeProduct[] = recipe?.products ?? [];

  if (recipeRows.length === 0) {
    // Nessuna ricetta: una sola row. I tipi che non passano da una miscela
    // (lavorazione, irrigazione, semina) portano però i propri campi già
    // PIANIFICATI in `planned_tasks.metadata`: si riversano qui nella forma che
    // il Quaderno usa per gli stessi dati, così l'operatore non li ridigita a
    // bordo campo. Le mappature ricalcano quelle di `OperationForm`:
    // tipo di lavorazione → `product_name`, apporto irriguo → `water_volume_l`
    // (convertito sulla superficie REALE percorsa), semente → product + dose.
    const planned = context.taskMetadata ?? {};
    const seedDose =
      planned.seed_dose != null && Number.isFinite(planned.seed_dose)
        ? Number(planned.seed_dose)
        : null;
    const irrigationLitres =
      planned.irrigation_amount != null
        ? irrigationToLitres(
            Number(planned.irrigation_amount),
            planned.irrigation_unit ?? "mm",
            areaUsedHa,
          )
        : null;

    return {
      drafts: [
        {
          input: {
            ...base,
            product_name:
              planned.seed_product_name ?? planned.tillage_type ?? null,
            registration_number: null,
            active_substance: null,
            dose_value: seedDose,
            dose_unit: seedDose != null ? (planned.seed_dose_unit ?? "kg/ha") : null,
            total_quantity:
              seedDose != null ? round3(seedDose * areaUsedHa) : null,
            water_volume_l: irrigationLitres,
            target_disease: targetDisease,
            fertilizer_type: null,
            npk_ratio: null,
            reentry_interval_h: null,
            safety_period_days: null,
          },
          issues: [],
        },
      ],
      areaUsedHa,
      warnings,
    };
  }

  const drafts: SessionLogDraft[] = recipeRows.map((line) => {
    const product = line.product_id
      ? context.products.find((p) => p.id === line.product_id)
      : undefined;
    const { reentry, safety } = safetyFromProduct(product);
    const totalQuantity = round3(Number(line.dose_per_ha) * areaUsedHa);

    // Scarico reale dal Magazzino solo se il product della ricetta è
    // agganciato all'anagrafica E ha un lot utilizzabile; altrimenti restano i
    // campi testo del Quaderno (fallback previsto dallo schema).
    const issues: IssueRequest[] = [];
    if (line.product_id && totalQuantity > 0) {
      const lot = pickLotForProduct(line.product_id, context.lots);
      if (lot) {
        issues.push({ product_lot_id: lot.id, quantity: totalQuantity });
      } else {
        warnings.push({
          kind: "no_lot_available",
          productName: line.product_name,
        });
      }
    }

    return {
      input: {
        ...base,
        product_name: line.product_name,
        registration_number: line.registration_number ?? null,
        active_substance: line.active_substance ?? null,
        dose_value: Number(line.dose_per_ha),
        dose_unit: line.unit,
        total_quantity: totalQuantity,
        target_disease: targetDisease,
        fertilizer_type: line.fertilizer_type ?? null,
        npk_ratio: line.npk_ratio ?? null,
        reentry_interval_h: reentry,
        safety_period_days: safety,
      },
      issues,
    };
  });

  return { drafts, areaUsedHa, warnings };
}
