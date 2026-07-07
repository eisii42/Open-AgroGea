import {
  type AlertFitopatologico,
  rischioOcchioPavone,
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
  nome: "Mosca olearia (accumulo termico)",
  bersaglio: "Bactrocera oleae",
  descrizione:
    "Gradi-giorno sopra la soglia di sviluppo: al completamento della generazione, intensificare il monitoraggio trappole.",
  sogliaObiettivo: 390,
  rischioAlRaggiungimento: "medio",
});

/**
 * Occhio di pavone (Spilocaea oleagina): modello puro a bagnatura+temperatura di
 * `fitopatologia`. Qui si adatta solo la serie meteo unificata (ore di bagnatura
 * da `leaf_wetness`) alla forma attesa dall'engine.
 */
const occhioPavone: DssModel = {
  id: "occhio-pavone",
  nome: "Occhio di pavone",
  bersaglio: "Spilocaea oleagina",
  descrizione:
    "Bagnatura fogliare prolungata (≥10 h) con temperatura mite (~8-26 °C): condizioni d'infezione primaverili/autunnali.",
  valuta: (serie): AlertFitopatologico | null =>
    rischioOcchioPavone(
      serie.map((g) => ({
        tMin: g.tMin,
        tMax: g.tMax,
        bagnaturaOre: g.bagnaturaOre ?? 0,
      })),
    ),
};

export const dssOlivo: DssModel[] = [moscaOlearia, occhioPavone];
