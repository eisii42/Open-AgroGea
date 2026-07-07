import type { DssModel } from "../types";
import { creaDssAccumuloTermico } from "../shared/dss-common";

/**
 * DSS dell'orticoltura (specie di riferimento "pomodoro"). Tracker fenologico ad
 * accumulo termico (base 10 °C): segnala l'avanzamento dello sviluppo, utile a
 * pianificare difesa e irrigazione. Soglia GDD default editabile.
 */
const sviluppo: DssModel = creaDssAccumuloTermico("pomodoro", {
  id: "sviluppo-pomodoro",
  nome: "Sviluppo pomodoro (accumulo termico)",
  bersaglio: "Fenologia pomodoro — pianificazione difesa/irrigazione",
  descrizione:
    "Gradi-giorno base 10 °C dal trapianto: al raggiungimento della soglia, rivalutare difesa e fabbisogno idrico.",
  sogliaObiettivo: 800,
  rischioAlRaggiungimento: "basso",
});

export const dssOrticoltura: DssModel[] = [sviluppo];
