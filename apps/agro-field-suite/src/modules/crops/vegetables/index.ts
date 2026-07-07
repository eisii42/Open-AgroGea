import type { CropModule } from "../types";
import { dssOrticoltura } from "./dss";

export { bilancioOrticoltura } from "./balance";
export { dssOrticoltura } from "./dss";

/** Modulo coltura Orticoltura: tracker fenologico, specie di riferimento "pomodoro". */
export const vegetablesModule: CropModule = {
  id: "orticoltura",
  label: "Orticoltura",
  categories: ["orticoltura"],
  mainSpecies: "pomodoro",
  dss: dssOrticoltura,
  seasonalAccumulation: true,
};
