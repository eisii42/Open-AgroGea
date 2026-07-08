import type { CropModule } from "../types";
import { dssFrutta } from "./dss";

export { bilancioFrutta } from "./balance";
export { dssFrutta } from "./dss";

/** Modulo crop Frutta: tracker fenologico, specie di riferimento "melo". */
export const fruitModule: CropModule = {
  id: "frutta",
  label: "Frutta",
  categories: ["frutticoltura"],
  mainSpecies: "melo",
  dss: dssFrutta,
  seasonalAccumulation: true,
};
