import { missingDeclarative } from "../compliance/sian-campaign";
import type {
  Plot,
  PlannedTask,
  PlotCampaign,
  Recipe,
  TreatmentLog,
} from "../types";
import {
  evaluateLogCompleteness,
  evaluateTaskCompleteness,
} from "./task-completeness";

/**
 * Segnali di attenzione per appezzamento, disegnati SULLA MAPPA.
 *
 * Sono due cose diverse e devono restare distinguibili a colpo d'occhio, perché
 * chiedono azioni diverse:
 *
 *   * `!` (punto esclamativo) — c'è del LAVORO previsto: task programmate o
 *     ancora in corso su quel campo. Non è un errore: è un promemoria;
 *   * `⚠` (triangolo) — mancano dei DATI: tessitura del suolo, campi
 *     dichiarativi della campagna (SIAN/SIEX), o record del Quaderno incompleti.
 *     Qui c'è qualcosa da correggere prima che diventi un problema in fase di
 *     export o di controllo.
 *
 * Il motore è PURO (nessuna dipendenza da store o React) e riusa i motori già
 * esistenti — {@link evaluateTaskCompleteness}/{@link evaluateLogCompleteness}
 * per i record e {@link missingDeclarative} per la compliance dichiarativa —
 * invece di reimplementarne le regole: l'elenco di ciò che manca deve essere lo
 * stesso che l'utente legge nel cruscotto "Record incompleti" e nel gate SIAN,
 * altrimenti la mappa direbbe una cosa e il pannello un'altra.
 */

/** Perché un appezzamento porta il triangolo dei dati mancanti. */
export type PlotDataGap =
  /** Nessun dato pedologico inserito: il bilancio idrico gira sui default. */
  | "soil_texture"
  /** Campi dichiarativi della campagna incompleti (SIAN/SIEX). */
  | "declarative_fields"
  /** Task o righe del Quaderno con campi obbligatori mancanti. */
  | "incomplete_records";

/** Ordine di priorità dei gap: guida la CTA del triangolo (il primo vince). */
const GAP_PRIORITY: readonly PlotDataGap[] = [
  "declarative_fields",
  "incomplete_records",
  "soil_texture",
];

export interface PlotAlert {
  plotId: string;
  /** Task PLANNED/IN_PROGRESS sul campo: alimenta il badge del punto esclamativo. */
  taskCount: number;
  /** Gap di dati, in ordine di priorità (vuoto = nessun triangolo). */
  gaps: PlotDataGap[];
}

export interface PlotAlertsInput {
  plots: Plot[];
  plannedTasks: PlannedTask[];
  campaignFields: PlotCampaign[];
  recipes: Recipe[];
  treatments: TreatmentLog[];
  /** Paese dell'azienda: senza sistema dichiarativo il gap non si valuta. */
  countryCode?: string | null;
  operatorName?: string | null;
  operatorLicenseNumber?: string | null;
}

/** Chiave dei parametri pedologici inseriti a mano in `plots_registry.metadata`. */
const SOIL_METADATA_KEY = "suolo";

/**
 * `true` se l'appezzamento non ha ALCUN dato tessiturale utilizzabile: né la
 * classe testuale né le percentuali granulometriche. Basta uno dei due perché
 * Saxton-Rawls abbia di che lavorare, quindi il gap si segnala solo quando
 * mancano entrambi — segnalare un campo "incompleto" a chi ha già dato al
 * modello ciò che gli serve sarebbe rumore.
 */
export function lacksSoilTexture(plot: Pick<Plot, "metadata">): boolean {
  const soil = plot.metadata?.[SOIL_METADATA_KEY];
  if (!soil || typeof soil !== "object") return true;
  const s = soil as Record<string, unknown>;
  const hasClass = typeof s.tessitura === "string" && s.tessitura.trim() !== "";
  const hasFractions =
    Number.isFinite(Number(s.sabbia)) &&
    Number.isFinite(Number(s.limo)) &&
    Number.isFinite(Number(s.argilla));
  return !hasClass && !hasFractions;
}

/**
 * Alert per appezzamento, uno per ogni campo che ne ha almeno uno. Gli
 * appezzamenti senza nulla da segnalare NON compaiono nel risultato: la mappa
 * deve restare pulita, i simboli sono l'eccezione.
 */
export function buildPlotAlerts(input: PlotAlertsInput): PlotAlert[] {
  const recipeById = new Map(input.recipes.map((r) => [r.id, r]));
  const context = {
    operatorName: input.operatorName,
    operatorLicenseNumber: input.operatorLicenseNumber,
  };

  const taskCounts = new Map<string, number>();
  const gapSets = new Map<string, Set<PlotDataGap>>();
  const addGap = (plotId: string, gap: PlotDataGap) => {
    const set = gapSets.get(plotId) ?? new Set<PlotDataGap>();
    set.add(gap);
    gapSets.set(plotId, set);
  };

  // 1. Lavoro previsto + task incomplete.
  for (const task of input.plannedTasks) {
    if (task.deleted_at != null) continue;
    if (task.status !== "PLANNED" && task.status !== "IN_PROGRESS") continue;
    if (!task.plot_id) continue;
    taskCounts.set(task.plot_id, (taskCounts.get(task.plot_id) ?? 0) + 1);
    const recipe = task.recipe_id ? (recipeById.get(task.recipe_id) ?? null) : null;
    const result = evaluateTaskCompleteness(task, recipe, context);
    if (result.missing.some((m) => m.severity === "blocking")) {
      addGap(task.plot_id, "incomplete_records");
    }
  }

  // 2. Righe del Quaderno già registrate ma incomplete.
  for (const log of input.treatments) {
    if (log.deleted_at != null || !log.plot_id) continue;
    const result = evaluateLogCompleteness(log);
    if (result.missing.some((m) => m.severity === "blocking")) {
      addGap(log.plot_id, "incomplete_records");
    }
  }

  // 3. Compliance dichiarativa: si valuta sulla campagna APERTA del campo. Un
  //    appezzamento senza campagna (a riposo) non ha nulla da dichiarare e non
  //    va segnalato — altrimenti ogni campo libero porterebbe un triangolo.
  for (const camp of input.campaignFields) {
    if (camp.deleted_at != null || camp.closed_at != null) continue;
    if (missingDeclarative(input.countryCode, camp).length > 0) {
      addGap(camp.plot_id, "declarative_fields");
    }
  }

  // 4. Dati pedologici.
  for (const plot of input.plots) {
    if (plot.deleted_at != null) continue;
    if (lacksSoilTexture(plot)) addGap(plot.id, "soil_texture");
  }

  const alerts: PlotAlert[] = [];
  for (const plot of input.plots) {
    if (plot.deleted_at != null) continue;
    const taskCount = taskCounts.get(plot.id) ?? 0;
    const set = gapSets.get(plot.id);
    const gaps = set ? GAP_PRIORITY.filter((g) => set.has(g)) : [];
    if (taskCount === 0 && gaps.length === 0) continue;
    alerts.push({ plotId: plot.id, taskCount, gaps });
  }
  return alerts;
}
