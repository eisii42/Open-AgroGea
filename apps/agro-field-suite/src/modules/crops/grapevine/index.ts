import type { CropModule } from "../types";
import { dssVite } from "./dss";

export { bilancioVite } from "./balance";
export { dssVite } from "./dss";

/** Modulo coltura Vite: DSS peronospora/oidio, specie fenologica "vite". */
export const grapevineModule: CropModule = {
  id: "vite",
  label: "Vite",
  categorie: ["viticoltura"],
  speciePrincipale: "vite",
  dss: dssVite,
};
