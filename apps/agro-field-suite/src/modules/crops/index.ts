import { cerealsModule } from "./cereals";
import { fruitModule } from "./fruit";
import { oliveModule } from "./olive";
import { vegetablesModule } from "./vegetables";
import type { CropModule } from "./types";
import { grapevineModule } from "./grapevine";

/**
 * Registro dei moduli per crop (refactor §3). Punto unico da cui la UI
 * risolve il module verticale di un plot a partire dalla sua categoria
 * crop. Aggiungere una crop = creare la cartella e registrarla qui.
 */
export const CROP_MODULES: CropModule[] = [
  grapevineModule,
  cerealsModule,
  oliveModule,
  fruitModule,
  vegetablesModule,
];

const PER_CATEGORIA = new Map<string, CropModule>(
  CROP_MODULES.flatMap((module) =>
    module.categories.map((categoria) => [categoria, module] as const),
  ),
);

/** Modulo crop per la categoria di un plot (`coltura`), o undefined. */
export function cropModuleForCrop(
  crop: string | null | undefined,
): CropModule | undefined {
  if (!crop) return undefined;
  return PER_CATEGORIA.get(crop);
}

/** Modulo crop per id stabile (es. "vite"). */
export function cropModuleById(id: string): CropModule | undefined {
  return CROP_MODULES.find((module) => module.id === id);
}

export { cropWaterBalance } from "./shared/balance";
export { buildDssSeries } from "./shared/weather-series";
export {
  runDssModule,
  outcomesToDssResults,
  type DssOutcome,
} from "./shared/dssRunner";
export type {
  CropBalanceInput,
  CropBalanceOutput,
} from "./shared/balance";
export type {
  CropCategory,
  DssContext,
  CropModule,
  DssModel,
  DssWeatherDay,
} from "./types";
