import type { CropModule } from "../types";
import { dssOlivo } from "./dss";

export { bilancioOlivo } from "./bilancio";
export { dssOlivo } from "./dss";

/** Modulo coltura Olivo: DSS mosca olearia, specie fenologica "olivo". */
export const olivoModule: CropModule = {
  id: "olivo",
  label: "Olivo",
  categorie: ["olivicoltura"],
  speciePrincipale: "olivo",
  dss: dssOlivo,
  accumuloStagionale: true,
};
