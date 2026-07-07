import type { DssModel } from "../types";
import { creaDssAccumuloTermico } from "../shared/dss-common";

/**
 * DSS dei cereali (specie di riferimento "frumento"). Tracker fenologico ad
 * accumulo termico (gradi-giorno da soglia 0 °C): segnala l'avvicinarsi della
 * spigatura, finestra critica per la difesa fungina (es. fusariosi/septoria).
 * Soglia GDD default editabile.
 */
const spigatura: DssModel = creaDssAccumuloTermico("frumento", {
  id: "spigatura",
  nome: "Spigatura (accumulo termico)",
  bersaglio: "Fenologia frumento — finestra di difesa fungina",
  descrizione:
    "Gradi-giorno base 0 °C: al raggiungimento della soglia, valutare la protezione della spiga.",
  sogliaObiettivo: 1100,
  rischioAlRaggiungimento: "medio",
});

export const dssCereali: DssModel[] = [spigatura];
