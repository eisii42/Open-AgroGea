import {
  degreeDayAccumulation,
  type PhytopathologyAlert,
  type CropType as PhenologicalSpecies,
  getCropMatrix,
  type RiskLevel,
  type ThermalPoint,
} from "@agrogea/tools";
import type { DssModel, DssWeatherDay } from "../types";

/**
 * DSS comuni ai moduli coltura (refactor §3): factory che costruiscono un
 * `DssModel` componendo i motori puri di `fitopatologia`, senza duplicarli.
 */

/** Converte la series DSS unificata nei punti termici attesi dall'accumulo GDD. */
function puntiTermici(series: DssWeatherDay[]): ThermalPoint[] {
  return series.map((g) => ({ tMin: g.tMin, tMax: g.tMax }));
}

/** Primo index della series con data ≥ biofix (0 se biofix assente/precedente). */
function offsetBiofix(
  series: DssWeatherDay[],
  dataInizio?: string,
): number {
  if (!dataInizio) return 0;
  const day = dataInizio.slice(0, 10);
  const i = series.findIndex((g) => g.data.slice(0, 10) >= day);
  return i < 0 ? series.length : i;
}

/**
 * DSS ad accumulo termico (gradi-day): usa le soglie termiche della specie
 * (`fenologia`) e traccia l'accumulo verso un obiettivo di GDD — comparsa di uno
 * stadio fenologico o di una generazione d'insetto. È la base condivisa dei
 * moduli senza un model patologico dedicato; `targetThreshold` e le soglie
 * sono default editabili, non costanti regolatorie.
 *
 * L'accumulo parte dal BIOFIX (`context.gddStartDate`), non dal primo
 * day della finestra meteo: così il valore è agronomicamente ancorato (1°
 * gennaio, semina, ripresa vegetativa) e stabile rispetto a quanta storia è
 * stata scaricata. Ritorna SEMPRE un alert — quando sotto soglia, un alert di
 * "accumulo in corso" col progresso, così la UI mostra l'avanzamento e non solo
 * il momento del superamento.
 */
export function creaDssAccumuloTermico(
  specie: PhenologicalSpecies,
  config: {
    id: string;
    name: string;
    target: string;
    description: string;
    targetThreshold: number;
    rischioAlRaggiungimento?: RiskLevel;
  },
): DssModel {
  const { tBase, tCutoff } = getCropMatrix(specie);
  return {
    id: config.id,
    name: config.name,
    target: config.target,
    description: config.description,
    evaluate: (series, context): PhytopathologyAlert | null => {
      const offset = offsetBiofix(series, context?.gddStartDate);
      const finestra = series.slice(offset);
      // Nessun day dopo il biofix: nulla da accumulare (es. biofix futuro).
      if (finestra.length === 0) return null;

      const { cumulative, thresholdDay } = degreeDayAccumulation(
        puntiTermici(finestra),
        tBase,
        { tCutoff, targetThreshold: config.targetThreshold },
      );
      const gddTotale = cumulative[cumulative.length - 1] ?? 0;

      if (thresholdDay != null) {
        // Soglia raggiunta: risk configurato e day riportato all'index
        // assoluto della series completa (per la timeline UI).
        const risk = config.rischioAlRaggiungimento ?? "medio";
        const index = risk === "alto" ? 4 : risk === "medio" ? 3 : 2;
        const gdd = cumulative[thresholdDay] ?? config.targetThreshold;
        return {
          model: config.name,
          risk,
          index,
          message: `Soglia di ${config.targetThreshold} °Cd (base ${tBase} °C) raggiunta: ${gdd.toFixed(0)} °Cd accumulati. ${config.target}.`,
          day: offset + thresholdDay,
        };
      }

      // Sotto soglia: alert informativo di avanzamento (risk basso).
      const progresso = Math.min(100, (gddTotale / config.targetThreshold) * 100);
      return {
        model: config.name,
        risk: "basso",
        index: 1,
        message: `Accumulo in corso: ${gddTotale.toFixed(0)}/${config.targetThreshold} °Cd (base ${tBase} °C) — ${progresso.toFixed(0)}% verso «${config.target}».`,
        day: offset + finestra.length - 1,
      };
    },
  };
}
