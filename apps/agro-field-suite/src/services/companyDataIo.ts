/**
 * Orchestratore Import/Export dei dati aziendali (GeoJSON Esteso).
 *
 * Compone il motore PURO di `@agrogea/core` (serialize/parse) con il DAL PGlite:
 *   - EXPORT: legge le righe del perimetro azienda dai metodi tipati del DAL
 *     (la geometria è già GeoJSON in `jsonb`, nessuna funzione PostGIS) e le
 *     serializza nel documento.
 *   - IMPORT: ripristina via le upsert tipate del DAL, che scrivono dato +
 *     outbox in transazione. Con un data plane remoto questo garantisce che i dati
 *     ripristinati vengano poi sincronizzati; in standalone l'outbox è no-op
 *     (LocalOnlySyncTarget), quindi resta tutto locale.
 *
 * File I/O via Blob + `<a download>` / `<input type=file>`: identico su web/PWA
 * e webview Tauri (stesso pattern di regionalExport/sianExport), nessun plugin
 * nativo richiesto. Filtri estensione: .geojson / .json.
 */

import {
  type AgroDal,
  type AgronomicLogs,
  type Azienda,
  type CompanySnapshot,
  parseCompanyTransfer,
  serializeCompanySnapshot,
  useAgroStore,
} from "@agrogea/core";

// Nessun limite pratico: l'export è un backup completo del perimetro azienda.
const FULL = 1_000_000;

type WithPlot = { plot_id: string | null };

/** Raggruppa i log per `plot_id`; gli orfani (plot_id null) a parte. */
function groupByPlot<T extends WithPlot>(rows: T[]): {
  byPlot: Map<string, T[]>;
  orphans: T[];
} {
  const byPlot = new Map<string, T[]>();
  const orphans: T[] = [];
  for (const row of rows) {
    if (!row.plot_id) {
      orphans.push(row);
      continue;
    }
    const bucket = byPlot.get(row.plot_id);
    if (bucket) bucket.push(row);
    else byPlot.set(row.plot_id, [row]);
  }
  return { byPlot, orphans };
}

/** Legge dal DAL l'istantanea completa dei dati di un'azienda. */
export async function buildCompanySnapshot(
  dal: AgroDal,
  company: Azienda,
): Promise<CompanySnapshot> {
  const id = company.id;
  const [
    plots,
    treatments,
    soilSamples,
    harvests,
    assets,
    scouting,
    allCampaigns,
    allCrops,
  ] = await Promise.all([
    dal.listAppezzamenti(id),
    dal.listTrattamenti(id, { limit: FULL }),
    dal.listCampionamenti(id),
    dal.listRaccolte(id, { limit: FULL }),
    // Infrastrutture (POI puntuali, geometrie CAD) e rilievi GPS di campo:
    // entità a livello azienda, senza legame con un singolo appezzamento.
    dal.listAssets(id),
    dal.listOsservazioniScouting(id, { limit: FULL }),
    // plots_campaign e crops sono a livello tenant: si filtrano sugli
    // appezzamenti/colture di QUESTA azienda.
    dal.listCampiCampagna(),
    dal.listCrops(),
  ]);
  const t = groupByPlot(treatments);
  const s = groupByPlot(soilSamples);
  const h = groupByPlot(harvests);
  // Campagne agrarie (associazione coltura↔appezzamento) dei soli appezzamenti
  // dell'azienda, raggruppate per appezzamento.
  const plotIds = new Set(plots.map((p) => p.id));
  const campaigns = allCampaigns.filter((cc) => plotIds.has(cc.plot_id));
  const c = groupByPlot(campaigns);
  // Colture referenziate da quelle campagne (catalogo tenant, filtrato).
  const cropIds = new Set(campaigns.map((cc) => cc.crop_id));
  const crops = allCrops.filter((cr) => cropIds.has(cr.id));
  return {
    company,
    crops,
    plots: plots.map((plot) => ({
      plot,
      campaigns: c.byPlot.get(plot.id) ?? [],
      treatments: t.byPlot.get(plot.id) ?? [],
      soilSamples: s.byPlot.get(plot.id) ?? [],
      harvests: h.byPlot.get(plot.id) ?? [],
    })),
    assets,
    scouting,
    unassigned: {
      treatments: t.orphans,
      soilSamples: s.orphans,
      harvests: h.orphans,
    },
  };
}

/** Costruisce e serializza l'export di un'azienda (stringa JSON indentata). */
export async function exportCompanyData(
  dal: AgroDal,
  company: Azienda,
): Promise<string> {
  const snapshot = await buildCompanySnapshot(dal, company);
  return JSON.stringify(serializeCompanySnapshot(snapshot), null, 2);
}

// I campi gestiti dall'ambiente (tenant, timestamp, tombstone) sono ricalcolati
// dal DAL a ogni scrittura: vanno rimossi prima dell'upsert per evitare di
// reintrodurre stato non pertinente all'istanza di destinazione.
type EnvManaged = "tenant_id" | "created_at" | "updated_at" | "deleted_at";
function stripEnv<T extends Record<EnvManaged, unknown>>(
  row: T,
): Omit<T, EnvManaged> {
  const { tenant_id, created_at, updated_at, deleted_at, ...rest } = row;
  return rest;
}

/** Conteggio dei record ripristinati. */
export interface ImportSummary {
  crops: number;
  plots: number;
  campaigns: number;
  treatments: number;
  soilSamples: number;
  harvests: number;
  assets: number;
  scouting: number;
}

/**
 * Ripristina i dati del documento nell'azienda `targetCompanyId`. Ogni record
 * viene RIASSEGNATO a quell'azienda (data protection cloud / adattamento
 * all'istanza locale) prima dell'upsert idempotente per `id`. `tenant_id` è
 * forzato dal DAL. Al termine rinotifica il sync e ri-idrata lo store.
 */
export async function importCompanyData(
  dal: AgroDal,
  raw: unknown,
  targetCompanyId: string,
): Promise<ImportSummary> {
  const snapshot = parseCompanyTransfer(raw);
  const summary: ImportSummary = {
    crops: 0,
    plots: 0,
    campaigns: 0,
    treatments: 0,
    soilSamples: 0,
    harvests: 0,
    assets: 0,
    scouting: 0,
  };

  const restoreLogs = async (logs: AgronomicLogs) => {
    for (const tr of logs.treatments) {
      await dal.insertTrattamento({
        ...stripEnv(tr),
        company_id: targetCompanyId,
      });
      summary.treatments++;
    }
    for (const so of logs.soilSamples) {
      await dal.upsertCampionamento({
        ...stripEnv(so),
        company_id: targetCompanyId,
      });
      summary.soilSamples++;
    }
    for (const ha of logs.harvests) {
      await dal.upsertRaccolta({
        ...stripEnv(ha),
        company_id: targetCompanyId,
      });
      summary.harvests++;
    }
  };

  // Colture PRIMA degli appezzamenti/campagne: le campagne (plots_campaign)
  // referenziano `crop_id`. Le crops sono a livello tenant (niente company_id):
  // `tenant_id` è forzato dal DAL.
  for (const crop of snapshot.crops) {
    await dal.upsertCrop({ ...stripEnv(crop) });
    summary.crops++;
  }

  for (const bundle of snapshot.plots) {
    await dal.upsertAppezzamento({
      ...stripEnv(bundle.plot),
      company_id: targetCompanyId,
    });
    summary.plots++;
    // Campagne agrarie dell'appezzamento (associazione coltura↔appezzamento per
    // annata). `plot_id`/`crop_id` restano: puntano a plot e crop appena
    // ripristinati con lo stesso id.
    for (const camp of bundle.campaigns) {
      await dal.upsertCampoCampagna({ ...stripEnv(camp) });
      summary.campaigns++;
    }
    await restoreLogs(bundle);
  }
  // Log non legati ad alcun appezzamento (plot_id resta null).
  await restoreLogs(snapshot.unassigned);

  // Infrastrutture / POI puntuali (geometria propria, livello azienda).
  for (const asset of snapshot.assets) {
    await dal.upsertAsset({ ...stripEnv(asset), company_id: targetCompanyId });
    summary.assets++;
  }
  // Rilievi GPS di campo.
  for (const obs of snapshot.scouting) {
    await dal.salvaOsservazioneScouting({
      ...stripEnv(obs),
      company_id: targetCompanyId,
    });
    summary.scouting++;
  }

  useAgroStore.getState().syncRouter?.notifyLocalWrite();
  await useAgroStore.getState().refreshDomainData();
  return summary;
}

// --------------------------------------------------------------------------
// File I/O (browser/Tauri webview): Blob download + input file picker.
// --------------------------------------------------------------------------

/** Nome file suggerito: `agrogea_<slug-azienda>_<data>.geojson`. */
export function exportFilename(company: Azienda): string {
  const slug =
    (company.business_name || "azienda")
      .toLowerCase()
      .normalize("NFD")
      // NFD scompone le lettere accentate; i segni combinanti residui non sono
      // [a-z0-9] e vengono ridotti a "-" dal filtro sotto (poi ripuliti).
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "azienda";
  return `agrogea_${slug}_${new Date().toISOString().slice(0, 10)}.geojson`;
}

/** Avvia il download del documento come file fisico. */
export function downloadCompanyJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** Apre il dialog nativo di selezione file (.geojson / .json). */
export function pickCompanyFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".geojson,.json,application/geo+json,application/json";
    input.addEventListener(
      "change",
      () => resolve(input.files?.[0] ?? null),
      { once: true },
    );
    input.click();
  });
}
