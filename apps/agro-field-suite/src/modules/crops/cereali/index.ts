import type { CropModule } from "../types";
import { dssCereali } from "./dss";

export { bilancioCereali } from "./bilancio";
export { dssCereali } from "./dss";

/** Modulo coltura Seminativi: tracker fenologico, specie di riferimento "frumento". */
export const cerealiModule: CropModule = {
  id: "cereali",
  label: "Seminativo",
  categorie: ["seminativo"],
  speciePrincipale: "frumento",
  dss: dssCereali,
  accumuloStagionale: true,
};
