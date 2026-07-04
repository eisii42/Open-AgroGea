import type {
  Appezzamento,
  CampoCampagna,
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
export interface SianColumn {
  id: string;
  label: string;
  value: (
    t: RegistroTrattamento,
    app: Appezzamento | undefined,
    campo: CampoCampagna | undefined,
  ) => unknown;
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
    value: (t) => t.operation_type,
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
 * Genera il testo CSV dal registro (già filtrato) secondo la config. Il join con
 * `campiCampagna` (per `plot_campaign_id`) alimenta le colonne dei riferimenti
 * ministeriali, congelati allo stato di campagna del momento dell'operazione.
 */
export function buildSianCsv(
  trattamenti: RegistroTrattamento[],
  appezzamenti: Appezzamento[],
  config: SianExportConfig = CONFIG_SIAN_DEFAULT,
  campiCampagna: CampoCampagna[] = [],
  // Risolve l'etichetta di intestazione per colonna; default = etichetta IT
  // hardcoded (usata dai test e da chi consuma il modulo fuori dalla UI).
  resolveLabel: (col: SianColumn) => string = (col) => col.label,
): string {
  const perId = new Map(appezzamenti.map((a) => [a.id, a]));
  const perCampo = new Map(campiCampagna.map((c) => [c.id, c]));
  const cols = risolviColonne(config.colonne);
  const sep = config.separatore;
  const righe = trattamenti.map((t) => {
    const app = t.plot_id ? perId.get(t.plot_id) : undefined;
    const campo = t.plot_campaign_id
      ? perCampo.get(t.plot_campaign_id)
      : undefined;
    return cols.map((c) => csvCell(c.value(t, app, campo), sep)).join(sep);
  });
  const lines = config.includiIntestazioni
    ? [cols.map((c) => csvCell(resolveLabel(c), sep)).join(sep), ...righe]
    : righe;
  return lines.join("\n");
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
): string {
  const csv = buildSianCsv(
    trattamenti,
    appezzamenti,
    config,
    campiCampagna,
    resolveLabel,
  );
  return scaricaSianCsv(csv, config, nomeAzienda);
}
