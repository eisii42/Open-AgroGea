import type { CropModule } from "../types";
import { dssFrutta } from "./dss";

export { bilancioFrutta } from "./bilancio";
export { dssFrutta } from "./dss";

/** Modulo coltura Frutta: tracker fenologico, specie di riferimento "melo". */
export const fruttaModule: CropModule = {
  id: "frutta",
  label: "Frutta",
  categorie: ["frutticoltura"],
  speciePrincipale: "melo",
  dss: dssFrutta,
  accumuloStagionale: true,
};
