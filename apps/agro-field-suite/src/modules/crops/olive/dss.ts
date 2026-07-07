import {
  type PhytopathologyAlert,
  peacockEyeRisk,
} from "@agrogea/tools";
import type { DssModel } from "../types";
import { creaDssAccumuloTermico } from "../shared/dss-common";

/**
 * DSS dell'olivo. La mosca olearia (Bactrocera oleae) si modella sull'accumulo
 * termico sopra la soglia di sviluppo (~9 °C dalla matrice "olivo"): al
 * raggiungimento della costante termica di una generazione scatta l'alert di
 * monitoraggio. Soglia default editabile (~390 °Cd), non costante regolatoria.
 */
const moscaOlearia: DssModel = creaDssAccumuloTermico("olivo", {
  id: "mosca-olearia",
  name: "Mosca olearia (accumulo termico)",
  target: "Bactrocera oleae",
  description:
    "Gradi-day sopra la soglia di sviluppo: al completamento della generazione, intensificare il monitoraggio trappole.",
  targetThreshold: 390,
  rischioAlRaggiungimento: "medio",
});

/**
 * Occhio di pavone (Spilocaea oleagina): model puro a bagnatura+temperatura di
 * `fitopatologia`. Qui si adatta solo la series meteo unificata (ore di bagnatura
 * da `leaf_wetness`) alla forma attesa dall'engine.
 */
const occhioPavone: DssModel = {
  id: "occhio-pavone",
  name: "Occhio di pavone",
  target: "Spilocaea oleagina",
  description:
    "Bagnatura fogliare prolungata (≥10 h) con temperatura mite (~8-26 °C): condizioni d'infezione primaverili/autunnali.",
  evaluate: (series): PhytopathologyAlert | null =>
    peacockEyeRisk(
      series.map((g) => ({
        tMin: g.tMin,
        tMax: g.tMax,
        leafWetnessHours: g.leafWetnessHours ?? 0,
      })),
    ),
};

export const dssOlivo: DssModel[] = [moscaOlearia, occhioPavone];
