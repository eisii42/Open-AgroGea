import type { DssModel } from "../types";
import { creaDssAccumuloTermico } from "../shared/dss-common";

/**
 * DSS dell'orticoltura (specie di riferimento "pomodoro"). Tracker fenologico ad
 * accumulo termico (base 10 °C): segnala l'avanzamento dello sviluppo, utile a
 * pianificare difesa e irrigation. Soglia GDD default editabile.
 */
const sviluppo: DssModel = creaDssAccumuloTermico("pomodoro", {
  id: "sviluppo-pomodoro",
  name: "Sviluppo pomodoro (accumulo termico)",
  target: "Fenologia pomodoro — pianificazione difesa/irrigation",
  description:
    "Gradi-day base 10 °C dal trapianto: al raggiungimento della soglia, rivalutare difesa e fabbisogno idrico.",
  targetThreshold: 800,
  rischioAlRaggiungimento: "basso",
});

export const dssOrticoltura: DssModel[] = [sviluppo];
