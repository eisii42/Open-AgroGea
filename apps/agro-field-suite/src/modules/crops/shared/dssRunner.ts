import type { DssRiskLevel } from "@agrogea/core";
import type { PhytopathologyAlert, RiskLevel } from "@agrogea/tools";
import type { DssContext, CropModule, DssModel, DssWeatherDay } from "../types";

/**
 * Runner dei DSS di coltura (refactor §3): esegue in locale i modelli del
 * modulo su una series meteo costruita da PGlite e ne ricava sia gli alert
 * ricchi per la UI (timeline/messaggi) sia le righe sintetiche da persistere in
 * `dss_risultati`. Non duplica logica: ogni `dss.evaluate` compone i motori puri
 * di `@agrogea/tools`.
 */

/** Esito di un singolo DSS, pronto sia per la UI sia per la cache. */
export interface DssOutcome {
  dss: DssModel;
  /** Alert completo del motore (null = nessun risk nella finestra). */
  alert: PhytopathologyAlert | null;
  /** Nome stabile del model in cache (es. "peronospora_vite"). */
  modelloNome: string;
  livello: DssRiskLevel;
  /** Indice numerico salvato in `valore_output` (0 se nessun alert). */
  valore: number;
}

/** Riduce i 4 livelli del motore ai 3 della cache DSS ('nullo' → 'low'). */
function normalizzaLivello(risk: RiskLevel): DssRiskLevel {
  switch (risk) {
    case "alto":
      return "high";
    case "medio":
      return "medium";
    default:
      return "low";
  }
}

/** Esegue tutti i DSS del modulo sulla series, con guardia anti-crash per model. */
export function runDssModule(
  modulo: CropModule,
  series: DssWeatherDay[],
  context?: DssContext,
): DssOutcome[] {
  return modulo.dss.map((dss) => {
    let alert: PhytopathologyAlert | null = null;
    try {
      alert = series.length > 0 ? dss.evaluate(series, context) : null;
    } catch {
      // Un model che esplode non deve bloccare gli altri né la UI.
      alert = null;
    }
    return {
      dss,
      alert,
      modelloNome: `${modulo.id}_${dss.id}`,
      livello: alert ? normalizzaLivello(alert.risk) : "low",
      valore: alert?.index ?? 0,
    };
  });
}

/** Proietta gli esiti nelle righe accettate da `AgroDal.saveDssResults`. */
export function outcomesToDssResults(
  esiti: DssOutcome[],
): Array<{
  model_name: string;
  risk_level: DssRiskLevel;
  output_value: number;
}> {
  return esiti.map((e) => ({
    model_name: e.modelloNome,
    risk_level: e.livello,
    output_value: e.valore,
  }));
}
