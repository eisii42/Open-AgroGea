import { cerealiModule } from "./cereali";
import { fruttaModule } from "./frutta";
import { olivoModule } from "./olivo";
import { orticolturaModule } from "./orticoltura";
import type { CropModule } from "./types";
import { viteModule } from "./vite";

/**
 * Registro dei moduli per coltura (refactor §3). Punto unico da cui la UI
 * risolve il modulo verticale di un appezzamento a partire dalla sua categoria
 * coltura. Aggiungere una coltura = creare la cartella e registrarla qui.
 */
export const CROP_MODULES: CropModule[] = [
  viteModule,
  cerealiModule,
  olivoModule,
  fruttaModule,
  orticolturaModule,
];

const PER_CATEGORIA = new Map<string, CropModule>(
  CROP_MODULES.flatMap((modulo) =>
    modulo.categorie.map((categoria) => [categoria, modulo] as const),
  ),
);

/** Modulo coltura per la categoria di un appezzamento (`coltura`), o undefined. */
export function cropModulePerColtura(
  coltura: string | null | undefined,
): CropModule | undefined {
  if (!coltura) return undefined;
  return PER_CATEGORIA.get(coltura);
}

/** Modulo coltura per id stabile (es. "vite"). */
export function cropModuleById(id: string): CropModule | undefined {
  return CROP_MODULES.find((modulo) => modulo.id === id);
}

export { bilancioIdricoColtura } from "./shared/bilancio";
export { costruisciSerieDss } from "./shared/serieMeteo";
export {
  eseguiDssModulo,
  esitiToRisultatiDss,
  type EsitoDss,
} from "./shared/dssRunner";
export type {
  BilancioColturaInput,
  BilancioColturaOutput,
} from "./shared/bilancio";
export type {
  CategoriaColtura,
  ContestoDss,
  CropModule,
  DssModel,
  MeteoGiornoDss,
} from "./types";
