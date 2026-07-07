import type { CropModule } from "../types";
import { dssVite } from "./dss";

export { bilancioVite } from "./bilancio";
export { dssVite } from "./dss";

/** Modulo coltura Vite: DSS peronospora/oidio, specie fenologica "vite". */
export const viteModule: CropModule = {
  id: "vite",
  label: "Vite",
  categorie: ["viticoltura"],
  speciePrincipale: "vite",
  dss: dssVite,
};
