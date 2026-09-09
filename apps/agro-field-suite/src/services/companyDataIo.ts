/**
 * Orchestratore Import/Export dei dati aziendali (GeoJSON Esteso).
 *
 * Compone il motore PURO di `@agrogea/core` (serialize/parse) con il DAL PGlite:
 *   - EXPORT: legge le rows del perimetro company dai metodi tipati del DAL
 *     (la geometria è già GeoJSON in `jsonb`, nessuna funzione PostGIS) e le
 *     serializza nel documento, limitandosi alle sezioni e al periodo scelti
 *     dall'utente (default: tutto).
 *   - IMPORT: ripristina via le upsert tipate del DAL, che scrivono dato +
 *     outbox in transazione. Con un data plane remoto questo garantisce che i dati
 *     ripristinati vengano poi sincronizzati; in standalone l'outbox è no-op
 *     (LocalOnlySyncTarget), quindi resta tutto locale.
 *
 * File I/O via Blob + `<a download>` / `<input type=file>`: identico su web/PWA
 * e webview Tauri (stesso pattern di regionalExport/sianExport), nessun plugin
 * nativo richiesto. Filtri extension: .geojson / .json.
 */

import {
  type AgroDal,
  type AgronomicLogs,
  type Company,
  type CompanySnapshot,
  type Plot,
  type TransferScope,
  type TransferSection,
  emptyCompanySnapshot,
  fullTransferScope,
  parseCompanyTransfer,
  planPlotImport,
  serializeCompanySnapshot,
  useAgroStore,
  withinPeriod,
} from "@agrogea/core";

// Nessun limite pratico: l'export è un backup completo del perimetro company.
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

/**
 * Appezzamenti, colture e campagne sono la SPINA DORSALE del documento: ogni
 * altra sezione vi si appoggia (le operazioni stanno dentro la Feature del
 * loro appezzamento, i movimenti di magazzino puntano alle operazioni…), e
 * senza costano pochissimo. Restano quindi sempre nel backup, e la sezione
 * "plots" è dichiarata comunque nello `scope` del file.
 */
function withBackbone(sections: readonly TransferSection[]): TransferSection[] {
  return sections.includes("plots") ? [...sections] : ["plots", ...sections];
}

/**
 * Legge dal DAL l'istantanea dei dati di un'azienda, limitata al perimetro
 * chiesto. Il default è il backup completo.
 *
 * Cosa il periodo filtra e cosa no: filtra i FATTI datati (operazioni,
 * raccolte, analisi, rilievi, manutenzioni, rifornimenti, sessioni), non le
 * ANAGRAFICHE (appezzamenti, colture, prodotti, depositi, mezzi, ricette) né le
 * giacenze dei lotti, che descrivono lo stato di oggi e non un evento: un
 * backup "ultimi 12 mesi" senza il prodotto a cui il trattamento si riferisce
 * non sarebbe ripristinabile.
 */
export async function buildCompanySnapshot(
  dal: AgroDal,
  company: Company,
  scope: TransferScope = fullTransferScope(),
): Promise<CompanySnapshot> {
  const id = company.id;
  const period = scope.period;
  const sections = withBackbone(scope.sections);
  const has = (section: TransferSection) => sections.includes(section);

  const snapshot = emptyCompanySnapshot(company);
  snapshot.scope = { sections, period };

  const [plots, allCampaigns, allCrops] = await Promise.all([
    dal.listPlots(id),
    // plots_campaign e crops sono a livello tenant: si filtrano sugli
    // plots/crops di QUESTA company.
    dal.listCampiCampagna(),
    dal.listCrops(),
  ]);

  const [treatments, soilSamples, harvests, scouting, assets] =
    await Promise.all([
      has("treatments")
        ? dal
            .listTreatments(id, { limit: FULL })
            .then((rows) =>
              rows.filter((r) => withinPeriod(r.executed_at, period)),
            )
        : [],
      has("soilSamples")
        ? dal
            .listSoilSamples(id)
            .then((rows) =>
              rows.filter((r) => withinPeriod(r.sampled_at, period)),
            )
        : [],
      has("harvests")
        ? dal
            .listHarvests(id, { limit: FULL })
            .then((rows) =>
              rows.filter((r) => withinPeriod(r.harvested_at, period)),
            )
        : [],
      // Rilievi GPS di field: la data del rilievo può mancare (rilievo
      // rapido), e allora vale quella di registrazione.
      has("scouting")
        ? dal
            .listOsservazioniScouting(id, { limit: FULL })
            .then((rows) =>
              rows.filter((r) =>
                withinPeriod(r.observation_date ?? r.created_at, period),
              ),
            )
        : [],
      // Infrastrutture (POI puntuali, geometrie CAD): entità a livello
      // company, senza legame con un singolo plot e senza data di evento.
      has("assets") ? dal.listAssets(id) : [],
    ]);

  const t = groupByPlot(treatments);
  const s = groupByPlot(soilSamples);
  const h = groupByPlot(harvests);
  // Campagne agrarie (associazione crop↔plot) dei soli plots
  // dell'azienda, raggruppate per plot.
  const plotIds = new Set(plots.map((p) => p.id));
  const campaigns = allCampaigns.filter((cc) => plotIds.has(cc.plot_id));
  const c = groupByPlot(campaigns);
  // Colture referenziate da quelle campagne (catalog tenant, filtrato).
  const cropIds = new Set(campaigns.map((cc) => cc.crop_id));

  snapshot.crops = allCrops.filter((cr) => cropIds.has(cr.id));
  snapshot.plots = plots.map((plot) => ({
    plot,
    campaigns: c.byPlot.get(plot.id) ?? [],
    treatments: t.byPlot.get(plot.id) ?? [],
    soilSamples: s.byPlot.get(plot.id) ?? [],
    harvests: h.byPlot.get(plot.id) ?? [],
  }));
  snapshot.assets = assets;
  snapshot.scouting = scouting;
  snapshot.unassigned = {
    treatments: t.orphans,
    soilSamples: s.orphans,
    harvests: h.orphans,
  };

  // Le righe agganciate a un'operazione (scarichi di magazzino, impieghi dei
  // mezzi) seguono le operazioni davvero esportate: senza la loro attività
  // sarebbero movimenti orfani, non ripristinabili.
  const treatmentIds = new Set(treatments.map((tr) => tr.id));

  if (has("warehouse")) {
    const [warehouses, products, lots, movements] = await Promise.all([
      dal.listWarehouses(id),
      dal.listProducts(id),
      dal.listLotti(id),
      dal.listCompanyActivityProducts(id),
    ]);
    snapshot.warehouse = {
      warehouses,
      products,
      lots,
      movements: movements.filter((m) => treatmentIds.has(m.treatment_log_id)),
    };
  }

  if (has("machinery")) {
    const [
      machines,
      equipment,
      activityMachines,
      maintenanceSchedules,
      maintenanceLogs,
      documents,
      counterAdjustments,
      fuelRefills,
    ] = await Promise.all([
      dal.listMachines(id),
      dal.listEquipment(id),
      dal.listCompanyActivityMachines(id),
      dal.listMaintenanceSchedules(id),
      dal.listCompanyMaintenanceLogs(id),
      dal.listMachineDocuments(id),
      dal.listCompanyCounterAdjustments(id),
      dal.listFuelRefills(id),
    ]);
    snapshot.machinery = {
      machines,
      equipment,
      activityMachines: activityMachines.filter((am) =>
        treatmentIds.has(am.treatment_log_id),
      ),
      // Lo scadenziario è uno stato (la prossima scadenza), non un fatto:
      // resta intero come le anagrafiche. I documenti pure: una revisione o
      // un'assicurazione scaduta è comunque parte del fascicolo del mezzo.
      maintenanceSchedules,
      maintenanceLogs: maintenanceLogs.filter((l) =>
        withinPeriod(l.performed_at, period),
      ),
      documents,
      counterAdjustments: counterAdjustments.filter((a) =>
        withinPeriod(a.adjusted_at, period),
      ),
      fuelRefills: fuelRefills.filter((r) =>
        withinPeriod(r.refueled_at, period),
      ),
    };
  }

  if (has("planning")) {
    const [recipes, plannedTasks, sessions] = await Promise.all([
      dal.listRecipes(id),
      dal.listPlannedTasks(id, { limit: FULL }),
      dal.listFieldSessions(id, { limit: FULL }),
    ]);
    snapshot.planning = {
      // La ricetta è un modello riutilizzabile: non ha una data da filtrare.
      recipes,
      plannedTasks: plannedTasks.filter((task) =>
        withinPeriod(task.planned_date, period),
      ),
      sessions: sessions.filter((session) =>
        withinPeriod(session.start_time, period),
      ),
    };
  }

  return snapshot;
}

/** Costruisce e serializza l'export di un'azienda (stringa JSON indentata). */
export async function exportCompanyData(
  dal: AgroDal,
  company: Company,
  scope: TransferScope = fullTransferScope(),
): Promise<string> {
  const snapshot = await buildCompanySnapshot(dal, company, scope);
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
  /** Depositi, prodotti, lotti e scarichi di magazzino. */
  warehouse: number;
  /** Mezzi, attrezzi, impieghi, manutenzioni, documenti, rifornimenti. */
  machinery: number;
  /** Ricette, task programmate e sessioni di campo. */
  planning: number;
  /**
   * Appezzamenti saltati perché la loro particella pubblica è già nel
   * portafoglio sotto un altro record, e l'utente non ha scelto di
   * sovrascriverla.
   */
  plotsSkipped: number;
  /**
   * Righe collegate (movimenti, rifornimenti, sessioni…) saltate perché il
   * record a cui si agganciano non è né nel file né già in archivio: un backup
   * parziale può contenerne, e saltarle è l'unico modo di ripristinare tutto
   * il resto.
   */
  linksSkipped: number;
}

/**
 * Decide che fare di un appezzamento in arrivo che descrive una particella già
 * presente sotto un record diverso. Riceve i due contendenti e risponde se
 * sovrascrivere.
 *
 * Il default, quando il chiamante non la fornisce, è **non** sovrascrivere: un
 * import è un'operazione di ripristino, e perdere in silenzio il quaderno di
 * campagna di un appezzamento già lavorato sarebbe il danno peggiore che questa
 * funzione possa fare.
 */
export type ImportConflictResolver = (conflict: {
  incoming: Plot;
  existing: Plot;
}) => boolean | Promise<boolean>;

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
  onConflict: ImportConflictResolver = () => false,
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
    warehouse: 0,
    machinery: 0,
    planning: 0,
    plotsSkipped: 0,
    linksSkipped: 0,
  };

  const restoredTreatments = new Set<string>();
  const restoreLogs = async (logs: AgronomicLogs) => {
    for (const tr of logs.treatments) {
      await dal.insertTreatment({
        ...stripEnv(tr),
        company_id: targetCompanyId,
      });
      restoredTreatments.add(tr.id);
      summary.treatments++;
    }
    for (const so of logs.soilSamples) {
      await dal.upsertSoilSample({
        ...stripEnv(so),
        company_id: targetCompanyId,
      });
      summary.soilSamples++;
    }
    for (const ha of logs.harvests) {
      await dal.upsertHarvest({
        ...stripEnv(ha),
        company_id: targetCompanyId,
      });
      summary.harvests++;
    }
  };

  // Colture PRIMA degli plots/campagne: le campagne (plots_campaign)
  // referenziano `crop_id`. Le crops sono a livello tenant (niente company_id):
  // `tenant_id` è forzato dal DAL.
  for (const crop of snapshot.crops) {
    await dal.upsertCrop({ ...stripEnv(crop) });
    summary.crops++;
  }

  // Si pianifica PRIMA di scrivere: gli appezzamenti nuovi e i ripristini dello
  // stesso record passano lisci, mentre una particella già presente sotto un
  // altro record si chiede — mai la si sovrascrive di iniziativa.
  const plan = planPlotImport(snapshot.plots, await dal.listPlots(targetCompanyId));
  const bundles = [...plan.toCreate, ...plan.toUpdate];
  for (const { incoming, existing } of plan.conflicts) {
    if (await onConflict({ incoming: incoming.plot, existing })) {
      bundles.push(incoming);
    } else {
      summary.plotsSkipped++;
    }
  }

  const restoredPlots = new Set<string>();
  for (const bundle of bundles) {
    await dal.upsertPlot({
      ...stripEnv(bundle.plot),
      company_id: targetCompanyId,
    });
    restoredPlots.add(bundle.plot.id);
    summary.plots++;
    // Campagne agrarie dell'appezzamento (associazione crop↔plot per
    // annata). `plot_id`/`crop_id` restano: puntano a plot e crop appena
    // ripristinati con lo stesso id.
    for (const camp of bundle.campaigns) {
      await dal.upsertCampoCampagna({ ...stripEnv(camp) });
      summary.campaigns++;
    }
    await restoreLogs(bundle);
  }
  // Log non legati ad alcun plot (plot_id resta null).
  await restoreLogs(snapshot.unassigned);

  // Infrastrutture / POI puntuali (geometria propria, livello company).
  for (const asset of snapshot.assets) {
    await dal.upsertAsset({ ...stripEnv(asset), company_id: targetCompanyId });
    summary.assets++;
  }
  // Rilievi GPS di field.
  for (const obs of snapshot.scouting) {
    await dal.saveScoutingObservation({
      ...stripEnv(obs),
      company_id: targetCompanyId,
    });
    summary.scouting++;
  }

  // -- sezioni ripristinate come rows (vedi AgroDalBackup.restoreRows) -------

  /**
   * Ids utilizzabili come riferimento: quelli appena ripristinati più quelli
   * che l'archivio già conteneva. Ciò che non è in nessuno dei due non può
   * essere agganciato, e la row che lo cita viene saltata.
   */
  const resolvable = async (
    table: Parameters<AgroDal["existingIds"]>[0],
    restored: ReadonlySet<string>,
    needed: readonly (string | null)[],
  ): Promise<ReadonlySet<string>> => {
    const missing = [
      ...new Set(
        needed.filter((v): v is string => v != null && !restored.has(v)),
      ),
    ];
    const found = await dal.existingIds(table, missing);
    return new Set([...restored, ...found]);
  };

  /** Trattiene le rows agganciabili e conta le altre fra i link saltati. */
  const linkable = <T>(rows: readonly T[], keep: (row: T) => boolean): T[] => {
    const kept = rows.filter(keep);
    summary.linksSkipped += rows.length - kept.length;
    return kept;
  };

  const own = <T extends object>(rows: readonly T[]): T[] =>
    rows.map((row) => ({ ...row, company_id: targetCompanyId }));

  const { warehouse, machinery, planning } = snapshot;

  summary.warehouse += await dal.restoreRows(
    "warehouses",
    own(warehouse.warehouses),
  );
  summary.warehouse += await dal.restoreRows("products", own(warehouse.products));
  const productIds = new Set(warehouse.products.map((p) => p.id));
  const warehouseIds = new Set(warehouse.warehouses.map((w) => w.id));
  const knownProducts = await resolvable(
    "products",
    productIds,
    warehouse.lots.map((l) => l.product_id),
  );
  const knownWarehouses = await resolvable(
    "warehouses",
    warehouseIds,
    warehouse.lots.map((l) => l.warehouse_id),
  );
  const lots = linkable(warehouse.lots, (l) =>
    knownProducts.has(l.product_id),
  ).map((lot) => ({
    // Un lot il cui deposito non è stato ripristinato torna "non collocato":
    // la giacenza è il dato che conta, la collocazione si riassegna a mano.
    ...lot,
    warehouse_id:
      lot.warehouse_id && knownWarehouses.has(lot.warehouse_id)
        ? lot.warehouse_id
        : null,
  }));
  summary.warehouse += await dal.restoreRows("product_lots", lots);

  const lotIds = new Set(lots.map((l) => l.id));
  const knownTreatments = await resolvable(
    "treatment_logs",
    restoredTreatments,
    [
      ...warehouse.movements.map((m) => m.treatment_log_id),
      ...machinery.activityMachines.map((am) => am.treatment_log_id),
    ],
  );
  const knownLots = await resolvable("product_lots", lotIds, [
    ...warehouse.movements.map((m) => m.product_lot_id),
    ...machinery.fuelRefills.map((r) => r.product_lot_id),
    ...machinery.maintenanceLogs.map((l) => l.product_lot_id),
  ]);
  summary.warehouse += await dal.restoreRows(
    "activity_products",
    linkable(
      warehouse.movements,
      (m) =>
        knownTreatments.has(m.treatment_log_id) && knownLots.has(m.product_lot_id),
    ),
  );

  summary.machinery += await dal.restoreRows("machines", own(machinery.machines));
  summary.machinery += await dal.restoreRows(
    "equipment",
    own(machinery.equipment),
  );
  const machineIds = new Set(machinery.machines.map((m) => m.id));
  const equipmentIds = new Set(machinery.equipment.map((e) => e.id));
  const linkedToFleet = (row: {
    machine_id: string | null;
    equipment_id: string | null;
  }) =>
    (row.machine_id != null && machineIds.has(row.machine_id)) ||
    (row.equipment_id != null && equipmentIds.has(row.equipment_id));

  summary.machinery += await dal.restoreRows(
    "activity_machines",
    linkable(
      machinery.activityMachines,
      (am) =>
        knownTreatments.has(am.treatment_log_id) && machineIds.has(am.machine_id),
    ),
  );
  const schedules = linkable(machinery.maintenanceSchedules, linkedToFleet);
  summary.machinery += await dal.restoreRows("maintenance_schedules", schedules);
  const scheduleIds = new Set(schedules.map((s) => s.id));
  summary.machinery += await dal.restoreRows(
    "maintenance_logs",
    linkable(
      machinery.maintenanceLogs,
      (l) =>
        linkedToFleet(l) &&
        (l.schedule_id == null || scheduleIds.has(l.schedule_id)) &&
        (l.product_lot_id == null || knownLots.has(l.product_lot_id)),
    ),
  );
  summary.machinery += await dal.restoreRows(
    "machine_documents",
    linkable(machinery.documents, linkedToFleet),
  );
  summary.machinery += await dal.restoreRows(
    "counter_adjustments",
    linkable(machinery.counterAdjustments, linkedToFleet),
  );
  summary.machinery += await dal.restoreRows(
    "fuel_refills",
    linkable(
      machinery.fuelRefills,
      (r) => machineIds.has(r.machine_id) && knownLots.has(r.product_lot_id),
    ),
  );

  summary.planning += await dal.restoreRows("recipes", own(planning.recipes));
  const recipeIds = new Set(planning.recipes.map((r) => r.id));
  const tasks = linkable(
    own(planning.plannedTasks),
    (task) =>
      restoredPlots.has(task.plot_id) &&
      (task.recipe_id == null || recipeIds.has(task.recipe_id)),
  );
  summary.planning += await dal.restoreRows("planned_tasks", tasks);
  const taskIds = new Set(tasks.map((task) => task.id));
  summary.planning += await dal.restoreRows(
    "field_operation_sessions",
    linkable(
      own(planning.sessions),
      (session) =>
        restoredPlots.has(session.plot_id) &&
        (session.planned_task_id == null ||
          taskIds.has(session.planned_task_id)) &&
        (session.recipe_id == null || recipeIds.has(session.recipe_id)) &&
        (session.machine_id == null || machineIds.has(session.machine_id)) &&
        (session.equipment_id == null || equipmentIds.has(session.equipment_id)),
    ),
  );

  useAgroStore.getState().syncRouter?.notifyLocalWrite();
  await useAgroStore.getState().refreshDomainData();
  return summary;
}

// --------------------------------------------------------------------------
// File I/O (browser/Tauri webview): Blob download + input file picker.
// --------------------------------------------------------------------------

/** Nome file suggerito: `agrogea_<slug-company>_<data>.geojson`. */
export function exportFilename(company: Company): string {
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
