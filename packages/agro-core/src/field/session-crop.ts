import type {
  PlannedTaskMetadata,
  Plot,
  PlotCampaign,
  Product,
} from "../types";

/**
 * Automazione SEMINA → coltura di campagna per le sessioni a bordo campo.
 *
 * Nel Quaderno di Campagna una semina registrata a mano assegna già da sé la
 * crop al field (`OperationForm` → `CropAssignment` → `LogbookPanel`): la
 * stessa semina chiusa a bordo campo non lo faceva, e il field restava senza
 * coltura per l'annata — nessun DSS, nessun bilancio idrico, nessuna riga
 * nella campagna agraria. Questa è la regola PURA equivalente, applicata dallo
 * store subito dopo la chiusura della sessione.
 *
 * Due condizioni, entrambe necessarie: l'operazione è una `sowing` e il field
 * NON ha già una campagna APERTA per l'annata (una coltura in corso non si
 * sovrascrive mai — al più si semina dopo averla chiusa col raccolto).
 * L'identità colturale arriva dall'anagrafica della semente
 * (`products.metadata`: `species`, `scientific_name`, `variety_name`,
 * `crop_category`), con il name commerciale come ultima risorsa.
 */

/** Scheda crop + campagna da creare per una semina appena registrata. */
export interface SowingCropAssignment {
  plotId: string;
  /** Nome comune della specie (dall'anagrafica semente o dal name del product). */
  species: string;
  scientificName: string | null;
  varietyName: string | null;
  /** Categoria DSS del field ("seminativo" | "orticoltura"). */
  cropCategory: string;
  /** Densità di semina derivata dalla dose pianificata (kg/ha), se disponibile. */
  seedingDensity: number | null;
  /** Superficie dichiarata della campagna: quella catastale del field. */
  declaredAreaHa: number;
}

export interface SowingCropContext {
  operationType: string;
  plot: Pick<Plot, "id" | "area_ha"> | null;
  /** Campi di campagna dell'annata attiva (per verificare che il field sia libero). */
  campaignFields: Pick<PlotCampaign, "plot_id" | "closed_at" | "deleted_at">[];
  /** Metadata della task programmata: porta semente e dose pianificate. */
  taskMetadata?: PlannedTaskMetadata | null;
  /** Anagrafica products del workspace (per risalire alla semente scelta). */
  products: Product[];
}

/** Valore stringa non vuoto da `products.metadata`, o null. */
function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Proposta di assegnazione crop per una sessione di semina conclusa, o null
 * quando non si applica (operazione diversa, field già coltivato, nessuna
 * semente pianificata, superficie ignota).
 */
export function sowingCropAssignment(
  context: SowingCropContext,
): SowingCropAssignment | null {
  const { operationType, plot, taskMetadata } = context;
  if (operationType !== "sowing" || !plot) return null;

  const areaHa = Number(plot.area_ha);
  if (!Number.isFinite(areaHa) || areaHa <= 0) return null;

  // Campagna già aperta sul field: la coltura in corso non si tocca.
  const alreadyCropped = context.campaignFields.some(
    (c) => c.plot_id === plot.id && c.closed_at == null && c.deleted_at == null,
  );
  if (alreadyCropped) return null;

  const planned = taskMetadata ?? {};
  const seedProduct = planned.seed_product_id
    ? (context.products.find((p) => p.id === planned.seed_product_id) ?? null)
    : null;
  const metadata = seedProduct?.metadata ?? {};
  const species =
    metadataString(metadata, "species") ??
    seedProduct?.name ??
    planned.seed_product_name ??
    null;
  // Senza una specie non c'è una scheda coltura sensata da creare: meglio
  // nessuna assegnazione che una coltura "senza nome" nella campagna agraria.
  if (!species) return null;

  const dose = planned.seed_dose;
  return {
    plotId: plot.id,
    species,
    scientificName: metadataString(metadata, "scientific_name"),
    varietyName: metadataString(metadata, "variety_name"),
    cropCategory: metadataString(metadata, "crop_category") ?? "seminativo",
    seedingDensity:
      planned.seed_dose_unit === "kg/ha" && dose != null && Number.isFinite(dose)
        ? Number(dose)
        : null,
    declaredAreaHa: areaHa,
  };
}
