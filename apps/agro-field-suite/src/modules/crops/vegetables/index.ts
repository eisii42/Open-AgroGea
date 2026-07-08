import type { CropModule } from "../types";
import { dssVegetables } from "./dss";

export { balanceVegetables } from "./balance";
export { dssVegetables } from "./dss";

/** Modulo crop Orticoltura: tracker fenologico, specie di riferimento "pomodoro". */
export const vegetablesModule: CropModule = {
  id: "orticoltura",
  label: "Orticoltura",
  categories: ["orticoltura"],
  mainSpecies: "pomodoro",
  dss: dssVegetables,
  seasonalAccumulation: true,
};
