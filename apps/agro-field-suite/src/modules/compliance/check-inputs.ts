import type { AgroDal, Crop, Plot, PlotCampaign } from "@agrogea/core";
import type {
  CheckInput,
  DeclaredCampaign,
  DeclaredIssue,
  DeclaredOperation,
  IndexSeries,
  IndexSeriesPoint,
  LayerFindings,
  OrthophotoSummary,
  ParameterOverrides,
  TerrainSummary,
  VegetationIndex,
} from "@agrogea/tools";
import { SENTINEL2_GSD_M } from "@agrogea/tools";

/**
 * Costruzione degli ingressi delle schede di compliance: dal DAL e dallo store
 * alla struttura PURA che i motori consumano.
 *
 * Tutto ciò che è impuro — leggere il database, leggere l'orologio, sapere
 * quali layer sono caricati sulla mappa — vive qui. Le schede ricevono un
 * oggetto e restituiscono un verdetto: è la separazione che rende ogni esito
 * riproducibile a partire dal suo ingresso, e testabile senza un database.
 */

/** Numero di pixel dell'appezzamento stimato dalla superficie e dalla risoluzione. */
function pixelsOf(areaHa: number, gsdM = SENTINEL2_GSD_M): number {
  return Math.max(1, Math.round((areaHa * 10_000) / (gsdM * gsdM)));
}

/**
 * Serie temporale degli indici dalla cache locale
 * (`vegetation_index_scenes`). La cache tiene 24 mesi: le schede pluriennali
 * che chiedono di più troveranno una serie corta e diranno "non decidibile",
 * finché l'utente non lancia il recupero storico — che ha un costo, e che va
 * annunciato prima (vedi {@link estimateAnalysisCost}).
 */
export async function buildIndexSeries(
  dal: AgroDal,
  plot: Plot,
): Promise<IndexSeries> {
  const scenes = await dal.listVegetationIndexScenes(plot.id, { limit: 2000 });
  const points: IndexSeriesPoint[] = scenes
    .map((scene) => {
      const values: Partial<Record<VegetationIndex, number>> = {};
      for (const [key, value] of Object.entries(scene.index_means ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) {
          values[key as VegetationIndex] = value;
        }
      }
      return {
        date: scene.captured_at,
        sceneId: scene.scene_id,
        collection: scene.collection,
        gsdM: SENTINEL2_GSD_M,
        cloudCoverPct: scene.cloud_cover,
        validPixels: scene.valid_pixels,
        values,
      } satisfies IndexSeriesPoint;
    })
    // Le schede assumono l'ordine crescente: la cache le restituisce dalla più
    // recente, ed è l'unico punto in cui l'ordine va invertito.
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return { plotId: plot.id, points };
}

/** Campagne dichiarate dell'appezzamento, con il nome della coltura risolto. */
export function toDeclaredCampaigns(
  campaigns: readonly PlotCampaign[],
  crops: readonly Crop[],
): DeclaredCampaign[] {
  return campaigns.map((campaign) => {
    const crop = crops.find((c) => c.id === campaign.crop_id) ?? null;
    const category = crop?.crop_metadata?.["category"];
    return {
      plotId: campaign.plot_id,
      campaignYear: campaign.campaign_year,
      declaredAreaHa: Number(campaign.declared_area_ha),
      cropName: crop?.common_name ?? null,
      cropCategory: typeof category === "string" ? category : null,
      cropExternalCode: campaign.crop_external_code,
      productionRegime: campaign.production_regime,
      regimeSince: campaign.regime_since,
      closedAt: campaign.closed_at,
    } satisfies DeclaredCampaign;
  });
}

/** Riga di scarico arricchita con l'anagrafica del prodotto. */
type IssueRow = Awaited<
  ReturnType<AgroDal["listCompanyIssuesWithProducts"]>
>[number];

/**
 * Titolo di rame metallo del prodotto, dai metadata (`copper_content_pct`).
 *
 * È il dato senza il quale il massimale dei 28 kg/ha non si calcola: 5 kg di un
 * formulato al 20% e 5 kg di uno al 50% sono 1 kg e 2,5 kg di rame. Quando
 * manca, il motore lo dichiara mancante invece di sommare quantità di formulato
 * come se fossero rame.
 */
function copperContentOf(metadata: Record<string, unknown>): number | null {
  const raw = metadata?.["copper_content_pct"];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

/** Origine del fertilizzante dichiarata nei metadata (`organic` | `mineral`). */
function fertilizerOriginOf(metadata: Record<string, unknown>): string | null {
  const raw = metadata?.["fertilizer_origin"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function toDeclaredIssue(row: IssueRow): DeclaredIssue {
  return {
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    quantity: Number(row.quantity),
    unit: row.unit,
    activeSubstance: row.active_substance,
    registrationNumber: row.registration_number,
    copperContentPct: copperContentOf(row.metadata ?? {}),
    nitrogenContentPct: row.npk_n == null ? null : Number(row.npk_n),
    fertilizerOrigin: fertilizerOriginOf(row.metadata ?? {}),
  };
}

/**
 * Operazioni del Quaderno con i lotti REALMENTE scaricati. La distinzione è il
 * cuore del motore biologico: `treatment_logs` porta la dose pianificata e il
 * testo libero, `activity_products` porta ciò che è uscito davvero dal
 * magazzino. Quando i due divergono, è il secondo a contare.
 */
export async function buildDeclaredOperations(
  dal: AgroDal,
  companyId: string,
  plotId: string,
): Promise<DeclaredOperation[]> {
  const [treatments, issues] = await Promise.all([
    dal.listTreatments(companyId, { plotId, limit: 5000 }),
    dal.listCompanyIssuesWithProducts(companyId),
  ]);
  const byOperation = new Map<string, DeclaredIssue[]>();
  for (const row of issues) {
    const bucket = byOperation.get(row.treatment_log_id);
    const issue = toDeclaredIssue(row);
    if (bucket) bucket.push(issue);
    else byOperation.set(row.treatment_log_id, [issue]);
  }
  return treatments.map((treatment) => ({
    id: treatment.id,
    plotId: treatment.plot_id,
    operationType: treatment.operation_type,
    executedAt: treatment.executed_at,
    productName: treatment.product_name,
    registrationNumber: treatment.registration_number,
    activeSubstance: treatment.active_substance,
    doseValue: treatment.dose_value,
    doseUnit: treatment.dose_unit,
    totalQuantity: treatment.total_quantity,
    fertilizerType: treatment.fertilizer_type,
    npkRatio: treatment.npk_ratio,
    issues: byOperation.get(treatment.id) ?? [],
  }));
}

/** Override persistiti, nella forma che il runner si aspetta. */
export async function loadParameterOverrides(
  dal: AgroDal,
  companyId: string,
): Promise<ParameterOverrides> {
  const rows = await dal.listComplianceOverrides(companyId);
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const forCheck = (out[row.check_id] ??= {});
    forCheck[row.parameter_id] = Number(row.value);
  }
  return out;
}

export interface CheckInputContext {
  plot: Plot;
  campaignYear: number;
  country: string;
  campaigns: readonly PlotCampaign[];
  crops: readonly Crop[];
  layers: LayerFindings;
  terrain: TerrainSummary | null;
  orthophoto: OrthophotoSummary | null;
  now: string;
}

/** Ingresso completo di una scheda, meno i parametri (che dipendono dalla scheda). */
export async function buildCheckInput(
  dal: AgroDal,
  companyId: string,
  context: CheckInputContext,
): Promise<Omit<CheckInput, "parameters">> {
  const [series, operations] = await Promise.all([
    buildIndexSeries(dal, context.plot),
    buildDeclaredOperations(dal, companyId, context.plot.id),
  ]);
  return {
    plot: {
      id: context.plot.id,
      name: context.plot.user_plot_name,
      areaHa: Number(context.plot.area_ha),
    },
    campaignYear: context.campaignYear,
    country: context.country,
    series,
    campaigns: toDeclaredCampaigns(context.campaigns, context.crops),
    operations,
    layers: context.layers,
    terrain: context.terrain,
    orthophoto: context.orthophoto,
    now: context.now,
  };
}

export { pixelsOf };
