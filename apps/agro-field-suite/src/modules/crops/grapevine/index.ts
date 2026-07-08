import type { CropModule } from "../types";
import { dssVite } from "./dss";

export { bilancioVite } from "./balance";
export { dssVite } from "./dss";

/** Modulo crop Vite: DSS peronospora/oidio, specie fenologica "vite". */
export const grapevineModule: CropModule = {
  id: "vite",
  label: "Vite",
  categories: ["viticoltura"],
  mainSpecies: "vite",
  dss: dssVite,
};
