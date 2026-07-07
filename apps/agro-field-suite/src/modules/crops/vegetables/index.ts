import type { CropModule } from "../types";
import { dssOrticoltura } from "./dss";

export { bilancioOrticoltura } from "./balance";
export { dssOrticoltura } from "./dss";

/** Modulo coltura Orticoltura: tracker fenologico, specie di riferimento "pomodoro". */
export const orticolturaModule: CropModule = {
  id: "orticoltura",
  label: "Orticoltura",
  categorie: ["orticoltura"],
  speciePrincipale: "pomodoro",
  dss: dssOrticoltura,
  accumuloStagionale: true,
};
