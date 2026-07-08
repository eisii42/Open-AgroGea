import type { CropModule } from "../types";
import { dssOlivo } from "./dss";

export { bilancioOlivo } from "./balance";
export { dssOlivo } from "./dss";

/** Modulo crop Olivo: DSS mosca olearia, specie fenologica "olivo". */
export const oliveModule: CropModule = {
  id: "olivo",
  label: "Olivo",
  categories: ["olivicoltura"],
  mainSpecies: "olivo",
  dss: dssOlivo,
  seasonalAccumulation: true,
};
