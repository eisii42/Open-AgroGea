import type { CropModule } from "../types";
import { dssCereali } from "./dss";

export { cerealsBalance } from "./balance";
export { dssCereali } from "./dss";

/** Modulo crop Seminativi: tracker fenologico, specie di riferimento "frumento". */
export const cerealsModule: CropModule = {
  id: "cereali",
  label: "Seminativo",
  categories: ["seminativo"],
  mainSpecies: "frumento",
  dss: dssCereali,
  seasonalAccumulation: true,
};
