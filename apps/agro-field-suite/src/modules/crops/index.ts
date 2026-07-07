import { cerealsModule } from "./cereals";
import { fruitModule } from "./fruit";
import { oliveModule } from "./olive";
import { vegetablesModule } from "./vegetables";
import type { CropModule } from "./types";
import { grapevineModule } from "./grapevine";

/**
 * Registro dei moduli per coltura (refactor §3). Punto unico da cui la UI
 * risolve il modulo verticale di un appezzamento a partire dalla sua categoria
 * coltura. Aggiungere una coltura = creare la cartella e registrarla qui.
 */
export const CROP_MODULES: CropModule[] = [
  grapevineModule,
  cerealsModule,
  oliveModule,
  fruitModule,
  vegetablesModule,
];

const PER_CATEGORIA = new Map<string, CropModule>(
  CROP_MODULES.flatMap((modulo) =>
    modulo.categorie.map((categoria) => [categoria, modulo] as const),
  ),
);

/** Modulo coltura per la categoria di un appezzamento (`coltura`), o undefined. */
export function cropModuleForCrop(
  coltura: string | null | undefined,
): CropModule | undefined {
  if (!coltura) return undefined;
  return PER_CATEGORIA.get(coltura);
}

/** Modulo coltura per id stabile (es. "vite"). */
export function cropModuleById(id: string): CropModule | undefined {
  return CROP_MODULES.find((modulo) => modulo.id === id);
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
