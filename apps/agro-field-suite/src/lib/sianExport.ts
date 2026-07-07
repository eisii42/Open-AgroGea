import type {
  Appezzamento,
  CampoCampagna,
  Raccolta,
  RegistroTrattamento,
  TipoOperazione,
} from "@agrogea/core";

/**
 * Esportazione configurabile del Quaderno di Campagna in CSV (Modulo QDC).
 *
 * Tracciato ispirato ai campi del registro trattamenti SIAN, ma **interamente
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
 * (es. l'etichetta localizzata del tipo operazione) che il modulo puro non può
 * conoscere. Opzionale: senza, gli estrattori usano i default italiani.
 */
export interface SianColumnContext {
  /** Etichetta localizzata del tipo operazione (default: italiano). */
  resolveOperationType?: (op: TipoOperazione) => string;
}

export interface SianColumn {
  id: string;
  label: string;
  value: (
    t: RegistroTrattamento,
    app: Appezzamento | undefined,
    campo: CampoCampagna | undefined,
    ctx?: SianColumnContext,
  ) => unknown;
}

/**
 * Etichette italiane di default del tipo operazione: il CSV NON deve mai
 * riportare il codice interno inglese (`phytosanitary`, `harvest`…). La UI
 * sovrascrive con la lingua attiva via {@link SianColumnContext}.
 */
export const ETICHETTE_TIPO_IT: Record<string, string> = {
  phytosanitary: "Trattamento fitosanitario",
  fertilization: "Fertilizzazione",
  irrigation: "Irrigazione",
  tillage: "Lavorazione",
  sowing: "Semina/Trapianto",
  harvest: "Raccolta",
  sampling: "Campionamento",
};

function etichettaTipoOperazione(
  op: TipoOperazione,
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
  { id: "appezzamento", label: "Appezzamento", value: (_t, a) => a?.user_plot_name ?? "" },
  { id: "coltura", label: "Coltura", value: (_t, _a, c) => c?.crop_external_code ?? "" },
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
    value: (t, _a, _c, ctx) => etichettaTipoOperazione(t.operation_type, ctx),
  },
  { id: "prodotto", label: "Prodotto", value: (t) => t.product_name ?? "" },
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
    label: "ID Appezzamento SIAN",
    value: (_t, _a, c) => c?.agricultural_parcel_external_id ?? "",
  },
  {
    id: "crop_external_code",
    label: "Codice coltura SIAN",
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
  // -- colonne del Modulo Raccolta (righe con tipo_operazione = harvest) --
  {
    id: "raccolta_kg",
    label: "Quantità raccolta (kg)",
    value: (t) =>
      t.operation_type === "harvest" ? t.total_quantity ?? "" : "",
  },
  {
    id: "destinazione",
    label: "Destinazione raccolta",
    // La destinazione della raccolta è congelata in metadata.destinazione (vedi
    // raccolteToOperazioni); vuota per le altre operazioni.
    value: (t) =>
      t.operation_type === "harvest"
        ? (t.weather_conditions as { destinazione?: string } | null)?.destinazione ?? ""
        : "",
  },
  { id: "note", label: "Note", value: (t) => t.note ?? "" },
];

/**
 * Selezione di colonne predefinita: tracciato SIAN/PAN con i riferimenti
 * ministeriali (id isola/appezzamento + codice coltura) sempre inclusi.
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
  // Raccolta (QDCA): valorizzate solo sulle righe harvest, vuote altrove.
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
  colture?: string[];
  /** Tipi di operazione ammessi (vuoto = tutti). */
  tipiOperazione?: TipoOperazione[];
  /** Includi le operazioni "intera azienda" (senza appezzamento). Default true. */
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
 * azienda" (senza appezzamento) sono escluse quando si filtra per appezzamento
 * o coltura, perché non hanno un riferimento spaziale da confrontare.
 */
export function filtraTrattamentiSian(
  trattamenti: RegistroTrattamento[],
  appezzamenti: Appezzamento[],
  filtri: SianFiltri,
): RegistroTrattamento[] {
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

  return trattamenti.filter((t) => {
    const ts = new Date(t.executed_at).getTime();
    if (daTs != null && ts < daTs) return false;
    if (aTs != null && ts > aTs) return false;
    if (tipoSet && !tipoSet.has(t.operation_type)) return false;

    if (!t.plot_id) {
      // Operazione intera azienda: nessun riferimento spaziale.
      if (!includiSenza) return false;
      return !appSet;
    }
    if (appSet && !appSet.has(t.plot_id)) return false;
    return true;
  });
}

/** Risolve gli id colonna della config nelle definizioni effettive (ordine config). */
export function risolviColonne(ids: string[]): SianColumn[] {
  const perId = new Map(COLONNE_SIAN.map((c) => [c.id, c]));
  return ids
    .map((id) => perId.get(id))
    .filter((c): c is SianColumn => c != null);
}

/**
 * Risolve la campagna agraria di un'operazione per popolare i riferimenti
 * ministeriali (codici SIAN/SIEX). Prima cerca l'aggancio diretto
 * (`plot_campaign_id`); se manca — o punta a una riga non caricata — ricade sul
 * match per appezzamento + anno dell'operazione. Così i codici compilati nella
 * scheda coltura DOPO la registrazione (o su operazioni non agganciate, come la
 * semina con auto-assegnazione) compaiono comunque nell'export.
 */
function risolviCampo(
  t: RegistroTrattamento,
  perCampoId: Map<string, CampoCampagna>,
  perPlotAnno: Map<string, CampoCampagna[]>,
): CampoCampagna | undefined {
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
 * appezzamento+anno (vedi {@link risolviCampo}): i codici ministeriali seguono
 * lo stato di campagna corrente, non una fotografia al momento dell'operazione.
 */
export function buildSianCsv(
  trattamenti: RegistroTrattamento[],
  appezzamenti: Appezzamento[],
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
  campiCampagna: CampoCampagna[] = [],
  // Risolve l'etichetta di intestazione per colonna; default = etichetta IT
  // hardcoded (usata dai test e da chi consuma il modulo fuori dalla UI).
  resolveLabel: (col: SianColumn) => string = (col) => col.label,
  ctx: SianColumnContext = {},
): string {
  const perId = new Map(appezzamenti.map((a) => [a.id, a]));
  const perCampo = new Map(campiCampagna.map((c) => [c.id, c]));
  // Indice appezzamento+anno per il fallback di risoluzione campagna.
  const perPlotAnno = new Map<string, CampoCampagna[]>();
  for (const c of campiCampagna) {
    if (c.deleted_at != null) continue;
    const key = `${c.plot_id}:${c.campaign_year}`;
    const list = perPlotAnno.get(key) ?? [];
    list.push(c);
    perPlotAnno.set(key, list);
  }
  const cols = risolviColonne(config.colonne);
  const sep = config.separatore;
  const righe = trattamenti.map((t) => {
    const app = t.plot_id ? perId.get(t.plot_id) : undefined;
    const campo = risolviCampo(t, perCampo, perPlotAnno);
    return cols.map((c) => csvCell(c.value(t, app, campo, ctx), sep)).join(sep);
  });
  const lines = config.includiIntestazioni
    ? [cols.map((c) => csvCell(resolveLabel(c), sep)).join(sep), ...righe]
    : righe;
  return lines.join("\n");
}

/**
 * Mappa gli eventi di raccolta (`harvest_logs`) in operazioni sintetiche del
 * Quaderno (`operation_type = "harvest"`), così confluiscono nello STESSO
 * export del registro trattamenti (requisito QDCA: la raccolta è parte del
 * Quaderno di Campagna). La cultivar diventa il "prodotto", i kg la quantità
 * totale, la destinazione è congelata in `weather_conditions.destinazione` (bag
 * di metadati in memoria, mai persistito). L'aggancio alla campagna (`plot_id`,
 * `plot_campaign_id`) è preservato per la risoluzione dei codici SIAN.
 */
export function raccolteToOperazioni(
  raccolte: Raccolta[],
): RegistroTrattamento[] {
  return raccolte
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
export function nomeFileSian(nomeAzienda = "azienda"): string {
  const slug = nomeAzienda.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "azienda";
  return `quaderno-sian-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Scarica il CSV nel browser. Ritorna il nome file usato (per il giornale
 * trasferimenti). Separata dalla logica pura per restare testabile.
 */
export function scaricaSianCsv(
  csv: string,
  config: SianExportConfig,
  nomeAzienda = "azienda",
): string {
  const contenuto = config.bom ? `﻿${csv}` : csv;
  const blob = new Blob([contenuto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const nomeFile = nomeFileSian(nomeAzienda);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  a.click();
  URL.revokeObjectURL(url);
  return nomeFile;
}

/**
 * Esporta il CSV con la config corrente (filtri già applicati a monte). Comodità
 * usata dal dialog di export. Ritorna il nome del file scaricato.
 */
export function esportaSianCsv(
  trattamenti: RegistroTrattamento[],
  appezzamenti: Appezzamento[],
  nomeAzienda = "azienda",
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
  campiCampagna: CampoCampagna[] = [],
  resolveLabel?: (col: SianColumn) => string,
  ctx: SianColumnContext = {},
): string {
  const csv = buildSianCsv(
    trattamenti,
    appezzamenti,
    config,
    campiCampagna,
    resolveLabel,
    ctx,
  );
  return scaricaSianCsv(csv, config, nomeAzienda);
}
