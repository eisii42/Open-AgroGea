import type { DssModel } from "../types";
import { creaDssAccumuloTermico } from "../shared/dssComuni";

/**
 * DSS della frutta (specie di riferimento "melo"). Tracker fenologico ad
 * accumulo termico (base 7 °C): segnala l'avanzamento verso gli stadi critici
 * per la difesa (es. ticchiolatura/carpocapsa). Soglia GDD default editabile.
 */
const sviluppo: DssModel = creaDssAccumuloTermico("melo", {
  id: "sviluppo-melo",
  nome: "Sviluppo melo (accumulo termico)",
  bersaglio: "Fenologia melo — finestra di difesa",
  descrizione:
    "Gradi-giorno base 7 °C dalla ripresa vegetativa: al raggiungimento della soglia, allineare il monitoraggio.",
  sogliaObiettivo: 250,
  rischioAlRaggiungimento: "medio",
});

export const dssFrutta: DssModel[] = [sviluppo];
