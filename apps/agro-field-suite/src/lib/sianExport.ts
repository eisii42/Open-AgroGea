import type {
  Plot,
  PlotCampaign,
  Harvest,
  TreatmentLog,
  OperationType,
} from "@agrogea/core";

/**
 * Esportazione configurabile del Quaderno di Campagna in CSV (Modulo QDC).
 *
 * Tracciato ispirato ai campi del registro treatments SIAN, ma **interamente
 * componibile**: l'utente sceglie quali colonne includere, in che ordine, con
 * quale separatore, e applica filtri temporali e spaziali. Questo lascia spazio
 * a cambiamenti normativi o richieste particolari senza toccare il codice.
 * NON è il tracciato record ufficiale completo del SIAN. Tutto in locale.
 *
 * Parte PURA (nessun DOM/React): testabile sotto `node --test`.
 */

export type SeparatoreCsv = ";" | "," | "\t";

function csvCell(value: unknown, separatore: SeparatoreCsv): string {
  if (value == null) return "";
  const s = String(value);
  // Quoting RFC-4180: virgolette, newline o il separatore in uso forzano il quote.
  const needsQuote = s.includes('"') || s.includes("\n") || s.includes(separatore);
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Definizione di una colonna esportabile: id stabile, etichetta di default
 * (italiano, usata dai test `node --test` e come fallback), estrattore.
 * La UI (SianExportDialog) risolve l'etichetta effettiva via i18n
 * (`sianExportDialog.columns.<id>`) e passa un `resolveLabel` a
 * {@link buildSianCsv}/{@link esportaSianCsv} così l'intestazione del CSV
 * segue la lingua attiva invece di restare fissa in italiano.
 */
/**
 * Contesto passato agli estrattori di colonna: risolutori dipendenti dalla UI
 * (es. l'etichetta localizzata del tipo operation) che il module puro non può
 * conoscere. Opzionale: senza, gli estrattori usano i default italiani.
 */
export interface SianColumnContext {
  /** Etichetta localizzata del tipo operation (default: italiano). */
  resolveOperationType?: (op: OperationType) => string;
}

export interface SianColumn {
  id: string;
  label: string;
  value: (
    t: TreatmentLog,
    app: Plot | undefined,
    field: PlotCampaign | undefined,
    ctx?: SianColumnContext,
  ) => unknown;
}

/**
 * Etichette italiane di default del tipo operation: il CSV NON deve mai
 * riportare il codice interno inglese (`phytosanitary`, `harvest`…). La UI
 * sovrascrive con la lingua attiva via {@link SianColumnContext}.
 */
export const ETICHETTE_TIPO_IT: Record<string, string> = {
  phytosanitary: "Trattamento fitosanitario",
  fertilization: "Fertilizzazione",
  irrigation: "Irrigazione",
  tillage: "Lavorazione",
  sowing: "Semina/Trapianto",
  harvest: "Harvest",
  sampling: "Campionamento",
};

function operationTypeLabel(
  op: OperationType,
  ctx?: SianColumnContext,
): string {
  return ctx?.resolveOperationType?.(op) ?? ETICHETTE_TIPO_IT[op] ?? op;
}

/**
 * Catalogo COMPLETO delle colonne disponibili. Aggiungere una voce qui la rende
 * subito selezionabile nel dialog di export (estendibilità per nuovi obblighi).
 */
export const COLONNE_SIAN: SianColumn[] = [
  { id: "data", label: "Data", value: (t) => isoData(t.executed_at) },
  { id: "ora", label: "Ora", value: (t) => isoOra(t.executed_at) },
  { id: "appezzamento", label: "Plot", value: (_t, a) => a?.user_plot_name ?? "" },
  { id: "coltura", label: "CropType", value: (_t, _a, c) => c?.crop_external_code ?? "" },
  { id: "varieta", label: "Varietà", value: (_t, _a, c) => c?.variety_external_code ?? "" },
  {
    id: "foglio_catastale",
    label: "Foglio catastale",
    value: (_t, a) => a?.cadastral_sheet ?? "",
  },
  { id: "particella", label: "Particella", value: (_t, a) => a?.cadastral_parcel ?? "" },
  {
    id: "superficie_ha",
    label: "Superficie (ha)",
    value: (_t, a) => a?.area_ha ?? "",
  },
  {
    id: "tipo_operazione",
    label: "Tipo operazione",
    // Etichetta leggibile (mai il codice interno inglese): default italiano,
    // sovrascrivibile con la lingua attiva dalla UI.
    value: (t, _a, _c, ctx) => operationTypeLabel(t.operation_type, ctx),
  },
  { id: "prodotto", label: "Product", value: (t) => t.product_name ?? "" },
  {
    id: "numero_registrazione",
    label: "N. registrazione",
    value: (t) => t.registration_number ?? "",
  },
  { id: "dose_valore", label: "Dose", value: (t) => t.dose_value ?? "" },
  { id: "dose_unita", label: "Unità dose", value: (t) => t.dose_unit ?? "" },
  {
    id: "quantita_totale",
    label: "Quantità totale",
    value: (t) => t.total_quantity ?? "",
  },
  {
    id: "avversita_target",
    label: "Avversità",
    value: (t) => t.target_disease ?? "",
  },
  { id: "operatore", label: "Operatore", value: (t) => t.operator_name ?? "" },
  {
    id: "operatore_cf",
    label: "CF operatore",
    value: (t) => t.operator_tax_code ?? "",
  },
  {
    id: "num_patentino",
    label: "N. patentino",
    value: (t) => t.license_number ?? "",
  },
  {
    id: "sostanza_attiva",
    label: "Sostanza attiva",
    value: (t) => t.active_substance ?? "",
  },
  {
    id: "acqua_volume_l",
    label: "Acqua (l)",
    value: (t) => t.water_volume_l ?? "",
  },
  { id: "tipo_concime", label: "Tipo concime", value: (t) => t.fertilizer_type ?? "" },
  { id: "titolo_npk", label: "Titolo NPK", value: (t) => t.npk_ratio ?? "" },
  // -- riferimenti ministeriali (join campi_campagna) --
  {
    id: "reference_parcel_external_id",
    label: "ID Isola SIAN",
    value: (_t, _a, c) => c?.reference_parcel_external_id ?? "",
  },
  {
    id: "agricultural_parcel_external_id",
    label: "ID Plot SIAN",
    value: (_t, _a, c) => c?.agricultural_parcel_external_id ?? "",
  },
  {
    id: "crop_external_code",
    label: "Codice crop SIAN",
    value: (_t, _a, c) => c?.crop_external_code ?? "",
  },
  {
    id: "variety_external_code",
    label: "Codice varietà SIAN",
    value: (_t, _a, c) => c?.variety_external_code ?? "",
  },
  {
    id: "campaign_year",
    label: "Anno campagna",
    value: (_t, _a, c) => c?.campaign_year ?? "",
  },
  { id: "mezzo", label: "Mezzo / macchina", value: (t) => t.machinery_equipment ?? "" },
  {
    id: "intervallo_rientro_h",
    label: "Rientro (h)",
    value: (t) => t.reentry_interval_h ?? "",
  },
  {
    id: "carenza_giorni",
    label: "Carenza (gg)",
    value: (t) => t.safety_period_days ?? "",
  },
  // -- colonne del Modulo Harvest (rows con tipo_operazione = harvest) --
  {
    id: "raccolta_kg",
    label: "Quantità harvest (kg)",
    value: (t) =>
      t.operation_type === "harvest" ? t.total_quantity ?? "" : "",
  },
  {
    id: "destinazione",
    label: "Destinazione raccolta",
    // La destinazione della harvest è congelata in metadata.destinazione (vedi
    // harvestsToOperations); vuota per le altre operazioni.
    value: (t) =>
      t.operation_type === "harvest"
        ? (t.weather_conditions as { destinazione?: string } | null)?.destinazione ?? ""
        : "",
  },
  { id: "note", label: "Note", value: (t) => t.note ?? "" },
];

/**
 * Selezione di colonne predefinita: tracciato SIAN/PAN con i riferimenti
 * ministeriali (id isola/plot + codice crop) sempre inclusi.
 */
export const COLONNE_SIAN_DEFAULT: string[] = [
  "data",
  "appezzamento",
  "reference_parcel_external_id",
  "agricultural_parcel_external_id",
  "crop_external_code",
  "tipo_operazione",
  "prodotto",
  "numero_registrazione",
  "sostanza_attiva",
  "dose_valore",
  "dose_unita",
  "quantita_totale",
  "avversita_target",
  "operatore_cf",
  "num_patentino",
  "carenza_giorni",
  // Harvest (QDCA): valorizzate solo sulle rows harvest, vuote altrove.
  "raccolta_kg",
  "destinazione",
];

function isoData(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
function isoOra(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

/** Filtri temporali e spaziali applicati prima della generazione del CSV. */
export interface SianFiltri {
  /** Data minima inclusiva (yyyy-mm-dd) o null per nessun limite. */
  dal?: string | null;
  /** Data massima inclusiva (yyyy-mm-dd) o null per nessun limite. */
  al?: string | null;
  /** Appezzamenti ammessi (vuoto = tutti). Filtro SPAZIALE per geometria. */
  appezzamentoIds?: string[];
  /** Colture ammesse (vuoto = tutte). */
  crops?: string[];
  /** Tipi di operation ammessi (vuoto = tutti). */
  tipiOperazione?: OperationType[];
  /** Includi le operazioni "intera azienda" (senza plot). Default true. */
  includiSenzaAppezzamento?: boolean;
}

/** Configurazione strutturale del CSV. */
export interface SianExportConfig {
  /** Id colonne selezionate, nell'ordine desiderato. */
  colonne: string[];
  separatore: SeparatoreCsv;
  includiIntestazioni: boolean;
  /** Premette il BOM UTF-8 (apertura corretta in Excel). */
  bom: boolean;
}

export const CONFIG_SIAN_DEFAULT: SianExportConfig = {
  colonne: COLONNE_SIAN_DEFAULT,
  separatore: ";",
  includiIntestazioni: true,
  bom: true,
};

/**
 * Applica i filtri temporali e spaziali al registro. Le operazioni "intera
 * azienda" (senza plot) sono escluse quando si filtra per plot
 * o crop, perché non hanno un riferimento spaziale da confrontare.
 */
export function filterSianTreatments(
  treatments: TreatmentLog[],
  plots: Plot[],
  filtri: SianFiltri,
): TreatmentLog[] {
  const daTs = filtri.dal ? new Date(`${filtri.dal}T00:00:00`).getTime() : null;
  const aTs = filtri.al ? new Date(`${filtri.al}T23:59:59.999`).getTime() : null;
  const appSet =
    filtri.appezzamentoIds && filtri.appezzamentoIds.length > 0
      ? new Set(filtri.appezzamentoIds)
      : null;
  const tipoSet =
    filtri.tipiOperazione && filtri.tipiOperazione.length > 0
      ? new Set<string>(filtri.tipiOperazione)
      : null;
  const includiSenza = filtri.includiSenzaAppezzamento ?? true;

  return treatments.filter((t) => {
    const ts = new Date(t.executed_at).getTime();
    if (daTs != null && ts < daTs) return false;
    if (aTs != null && ts > aTs) return false;
    if (tipoSet && !tipoSet.has(t.operation_type)) return false;

    if (!t.plot_id) {
      // Operazione intera company: nessun riferimento spaziale.
      if (!includiSenza) return false;
      return !appSet;
    }
    if (appSet && !appSet.has(t.plot_id)) return false;
    return true;
  });
}

/** Risolve gli id colonna della config nelle definizioni effettive (ordine config). */
export function resolveColumns(ids: string[]): SianColumn[] {
  const perId = new Map(COLONNE_SIAN.map((c) => [c.id, c]));
  return ids
    .map((id) => perId.get(id))
    .filter((c): c is SianColumn => c != null);
}

/**
 * Risolve la campagna agraria di un'operazione per popolare i riferimenti
 * ministeriali (codici SIAN/SIEX). Prima cerca l'aggancio diretto
 * (`plot_campaign_id`); se manca — o punta a una row non caricata — ricade sul
 * match per plot + anno dell'operazione. Così i codici compilati nella
 * scheda crop DOPO la registrazione (o su operazioni non agganciate, come la
 * semina con auto-assegnazione) compaiono comunque nell'export.
 */
function resolveField(
  t: TreatmentLog,
  perCampoId: Map<string, PlotCampaign>,
  perPlotAnno: Map<string, PlotCampaign[]>,
): PlotCampaign | undefined {
  if (t.plot_campaign_id) {
    const diretto = perCampoId.get(t.plot_campaign_id);
    if (diretto) return diretto;
  }
  if (!t.plot_id) return undefined;
  const anno = new Date(t.executed_at).getUTCFullYear();
  const candidati = perPlotAnno.get(`${t.plot_id}:${anno}`);
  if (!candidati || candidati.length === 0) return undefined;
  // Preferisce la campagna APERTA (una sola per plot+anno grazie all'indice
  // parziale); se tutte chiuse (es. raccolto già registrato) prende l'ultima.
  return candidati.find((c) => c.closed_at == null) ?? candidati[0];
}

/**
 * Genera il testo CSV dal registro (già filtrato) secondo la config. La
 * campagna agraria si risolve via `plot_campaign_id` con FALLBACK per
 * plot+anno (vedi {@link resolveField}): i codici ministeriali seguono
 * lo stato di campagna corrente, non una fotografia al momento dell'operazione.
 */
export function buildSianCsv(
  treatments: TreatmentLog[],
  plots: Plot[],
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
  campaignFields: PlotCampaign[] = [],
  // Risolve l'etichetta di intestazione per colonna; default = etichetta IT
  // hardcoded (usata dai test e da chi consuma il module fuori dalla UI).
  resolveLabel: (col: SianColumn) => string = (col) => col.label,
  ctx: SianColumnContext = {},
): string {
  const perId = new Map(plots.map((a) => [a.id, a]));
  const perCampo = new Map(campaignFields.map((c) => [c.id, c]));
  // Indice plot+anno per il fallback di risoluzione campagna.
  const perPlotAnno = new Map<string, PlotCampaign[]>();
  for (const c of campaignFields) {
    if (c.deleted_at != null) continue;
    const key = `${c.plot_id}:${c.campaign_year}`;
    const list = perPlotAnno.get(key) ?? [];
    list.push(c);
    perPlotAnno.set(key, list);
  }
  const cols = resolveColumns(config.colonne);
  const sep = config.separatore;
  const rows = treatments.map((t) => {
    const app = t.plot_id ? perId.get(t.plot_id) : undefined;
    const field = resolveField(t, perCampo, perPlotAnno);
    return cols.map((c) => csvCell(c.value(t, app, field, ctx), sep)).join(sep);
  });
  const lines = config.includiIntestazioni
    ? [cols.map((c) => csvCell(resolveLabel(c), sep)).join(sep), ...rows]
    : rows;
  return lines.join("\n");
}

/**
 * Mappa gli eventi di harvest (`harvest_logs`) in operazioni sintetiche del
 * Quaderno (`operation_type = "harvest"`), così confluiscono nello STESSO
 * export del registro treatments (requisito QDCA: la harvest è parte del
 * Quaderno di Campagna). La cultivar diventa il "prodotto", i kg la quantità
 * totale, la destinazione è congelata in `weather_conditions.destinazione` (bag
 * di metadati in memoria, mai persistito). L'aggancio alla campagna (`plot_id`,
 * `plot_campaign_id`) è preservato per la risoluzione dei codici SIAN.
 */
export function harvestsToOperations(
  harvests: Harvest[],
): TreatmentLog[] {
  return harvests
    .filter((r) => r.deleted_at == null)
    .map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      company_id: r.company_id,
      plot_id: r.plot_id,
      plot_campaign_id: r.plot_campaign_id,
      operation_type: "harvest",
      product_name: r.cultivar,
      registration_number: null,
      dose_value: null,
      dose_unit: null,
      total_quantity: r.quantity_kg,
      target_disease: null,
      operator_name: null,
      machinery_equipment: null,
      active_substance: null,
      water_volume_l: null,
      operator_tax_code: null,
      license_number: null,
      fertilizer_type: null,
      npk_ratio: null,
      executed_at: r.harvested_at,
      reentry_interval_h: null,
      safety_period_days: null,
      weather_conditions: r.destination_logistics
        ? { destinazione: r.destination_logistics }
        : null,
      note: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
    }));
}

/** Nome file deterministico per l'export. */
export function sianFileName(nomeAzienda = "azienda"): string {
  const slug = nomeAzienda.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "azienda";
  return `quaderno-sian-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Scarica il CSV nel browser. Ritorna il name file usato (per il giornale
 * trasferimenti). Separata dalla logica pura per restare testabile.
 */
export function downloadSianCsv(
  csv: string,
  config: SianExportConfig,
  nomeAzienda = "azienda",
): string {
  const contenuto = config.bom ? `﻿${csv}` : csv;
  const blob = new Blob([contenuto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const fileName = sianFileName(nomeAzienda);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return fileName;
}

/**
 * Esporta il CSV con la config corrente (filtri già applicati a monte). Comodità
 * usata dal dialog di export. Ritorna il name del file scaricato.
 */
export function esportaSianCsv(
  treatments: TreatmentLog[],
  plots: Plot[],
  nomeAzienda = "azienda",
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
  campaignFields: PlotCampaign[] = [],
  resolveLabel?: (col: SianColumn) => string,
  ctx: SianColumnContext = {},
): string {
  const csv = buildSianCsv(
    treatments,
    plots,
    config,
    campaignFields,
    resolveLabel,
    ctx,
  );
  return downloadSianCsv(csv, config, nomeAzienda);
}
