import type { Plot } from "@agrogea/core";
import type { CheckResult } from "@agrogea/tools";

/**
 * Export del report di autovalutazione.
 *
 * ## Perché il disclaimer è un campo del documento, non una nota
 *
 * Un file esce dall'applicazione e continua a vivere: viene inoltrato a un
 * tecnico, allegato a una pratica, aperto fra due anni da qualcuno che non era
 * presente quando è stato generato. Se la natura del documento — **non è un
 * controllo ufficiale** — stesse solo nella schermata che l'ha prodotto, il
 * file la perderebbe al primo inoltro.
 *
 * Sta quindi in tre posti: nel campo `assessment` di ogni singolo esito (che il
 * motore scrive e nessuno può omettere), nell'intestazione `disclaimer` del
 * documento, e nel nome del file.
 *
 * ## Perché JSON e non PDF
 *
 * Il report è materiale di lavoro, non un certificato: deve poter essere
 * riletto da un programma, confrontato con quello dell'anno prima, e verificato
 * scena per scena. Un PDF sembrerebbe più ufficiale di quanto il contenuto sia,
 * ed è esattamente l'equivoco che questo modulo non deve alimentare.
 */

/** Intestazione: che cos'è questo file, e che cosa non è. */
export const REPORT_DISCLAIMER =
  "Autovalutazione generata da AgroGea sulla base di osservazioni satellitari " +
  "pubbliche (Copernicus Sentinel-2) e dei dati registrati nel Quaderno di " +
  "Campagna dell'azienda. NON è un controllo ufficiale e non sostituisce il " +
  "sistema di monitoraggio delle superfici (AMS) dell'Organismo Pagatore " +
  "(Reg. (UE) 2021/2116, art. 66) né le verifiche dell'organismo di controllo " +
  "per la produzione biologica. Ogni esito riporta il metodo, le soglie " +
  "applicate, le scene utilizzate e il grado di incertezza: vanno letti " +
  "insieme all'esito, non separatamente.";

export interface ComplianceReportInput {
  plot: Plot;
  companyName: string | null;
  campaignYear: number;
  results: readonly CheckResult[];
  generatedAt: string;
}

export interface ComplianceReportDocument {
  format: "agrogea.compliance-report";
  version: 1;
  generatedAt: string;
  /** Ripetuto qui perché il file viaggia da solo. */
  disclaimer: string;
  company: { name: string | null };
  plot: { id: string; name: string; areaHa: number };
  campaignYear: number;
  /** Conteggio per esito, "non decidibile" compreso. */
  summary: Record<string, number>;
  checks: readonly CheckResult[];
}

/**
 * Costruisce il documento del report. Gli esiti vengono inclusi **integralmente**
 * — scene, parametri, fattori di incertezza e serie grezza compresi: un report
 * che riportasse solo il verdetto sarebbe contestabile solo a scatola chiusa, e
 * un giudizio che non si può contestare non serve a chi lo riceve.
 */
export function buildComplianceReport(
  input: ComplianceReportInput,
): string {
  const summary: Record<string, number> = {
    compliant: 0,
    attention: 0,
    non_compliant: 0,
    undecidable: 0,
  };
  for (const result of input.results) summary[result.outcome] += 1;

  const document: ComplianceReportDocument = {
    format: "agrogea.compliance-report",
    version: 1,
    generatedAt: input.generatedAt,
    disclaimer: REPORT_DISCLAIMER,
    company: { name: input.companyName },
    plot: {
      id: input.plot.id,
      name: input.plot.user_plot_name,
      areaHa: Number(input.plot.area_ha),
    },
    campaignYear: input.campaignYear,
    summary,
    checks: input.results,
  };
  return JSON.stringify(document, null, 2);
}

/** Nome file: porta l'annata e la parola "autovalutazione". */
export function reportFilename(plot: Plot, campaignYear: number): string {
  const slug =
    plot.user_plot_name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "appezzamento";
  return `autovalutazione-compliance_${slug}_${campaignYear}.json`;
}
