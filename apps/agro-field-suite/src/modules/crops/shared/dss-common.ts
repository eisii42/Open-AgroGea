import {
  accumuloGradiGiorno,
  type AlertFitopatologico,
  type CropType as SpecieFenologica,
  getMatriceColtura,
  type LivelloRischio,
  type PuntoTermico,
} from "@agrogea/tools";
import type { DssModel, DssWeatherDay } from "../types";

/**
 * DSS comuni ai moduli coltura (refactor §3): factory che costruiscono un
 * `DssModel` componendo i motori puri di `fitopatologia`, senza duplicarli.
 */

/** Converte la serie DSS unificata nei punti termici attesi dall'accumulo GDD. */
function puntiTermici(serie: DssWeatherDay[]): PuntoTermico[] {
  return serie.map((g) => ({ tMin: g.tMin, tMax: g.tMax }));
}

/** Primo indice della serie con data ≥ biofix (0 se biofix assente/precedente). */
function offsetBiofix(
  serie: DssWeatherDay[],
  dataInizio?: string,
): number {
  if (!dataInizio) return 0;
  const giorno = dataInizio.slice(0, 10);
  const i = serie.findIndex((g) => g.data.slice(0, 10) >= giorno);
  return i < 0 ? serie.length : i;
}

/**
 * DSS ad accumulo termico (gradi-giorno): usa le soglie termiche della specie
 * (`fenologia`) e traccia l'accumulo verso un obiettivo di GDD — comparsa di uno
 * stadio fenologico o di una generazione d'insetto. È la base condivisa dei
 * moduli senza un modello patologico dedicato; `sogliaObiettivo` e le soglie
 * sono default editabili, non costanti regolatorie.
 *
 * L'accumulo parte dal BIOFIX (`contesto.dataInizioAccumuloGdd`), non dal primo
 * giorno della finestra meteo: così il valore è agronomicamente ancorato (1°
 * gennaio, semina, ripresa vegetativa) e stabile rispetto a quanta storia è
 * stata scaricata. Ritorna SEMPRE un alert — quando sotto soglia, un alert di
 * "accumulo in corso" col progresso, così la UI mostra l'avanzamento e non solo
 * il momento del superamento.
 */
export function creaDssAccumuloTermico(
  specie: SpecieFenologica,
  config: {
    id: string;
    nome: string;
    bersaglio: string;
    descrizione: string;
    sogliaObiettivo: number;
    rischioAlRaggiungimento?: LivelloRischio;
  },
): DssModel {
  const { tBase, tCutoff } = getMatriceColtura(specie);
  return {
    id: config.id,
    nome: config.nome,
    bersaglio: config.bersaglio,
    descrizione: config.descrizione,
    valuta: (serie, contesto): AlertFitopatologico | null => {
      const offset = offsetBiofix(serie, contesto?.dataInizioAccumuloGdd);
      const finestra = serie.slice(offset);
      // Nessun giorno dopo il biofix: nulla da accumulare (es. biofix futuro).
      if (finestra.length === 0) return null;

      const { cumulato, giornoSoglia } = accumuloGradiGiorno(
        puntiTermici(finestra),
        tBase,
        { tCutoff, sogliaObiettivo: config.sogliaObiettivo },
      );
      const gddTotale = cumulato[cumulato.length - 1] ?? 0;

      if (giornoSoglia != null) {
        // Soglia raggiunta: rischio configurato e giorno riportato all'indice
        // assoluto della serie completa (per la timeline UI).
        const rischio = config.rischioAlRaggiungimento ?? "medio";
        const indice = rischio === "alto" ? 4 : rischio === "medio" ? 3 : 2;
        const gdd = cumulato[giornoSoglia] ?? config.sogliaObiettivo;
        return {
          modello: config.nome,
          rischio,
          indice,
          messaggio: `Soglia di ${config.sogliaObiettivo} °Cd (base ${tBase} °C) raggiunta: ${gdd.toFixed(0)} °Cd accumulati. ${config.bersaglio}.`,
          giorno: offset + giornoSoglia,
        };
      }

      // Sotto soglia: alert informativo di avanzamento (rischio basso).
      const progresso = Math.min(100, (gddTotale / config.sogliaObiettivo) * 100);
      return {
        modello: config.nome,
        rischio: "basso",
        indice: 1,
        messaggio: `Accumulo in corso: ${gddTotale.toFixed(0)}/${config.sogliaObiettivo} °Cd (base ${tBase} °C) — ${progresso.toFixed(0)}% verso «${config.bersaglio}».`,
        giorno: offset + finestra.length - 1,
      };
    },
  };
}
