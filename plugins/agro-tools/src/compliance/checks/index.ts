import type { CheckSpec } from "../check-types";
import { CheckRegistry } from "../registry";
import { a1AgriculturalActivity } from "./a1-agricultural-activity";
import { a2CropCoherence } from "./a2-crop-coherence";
import { a3DeclaredArea } from "./a3-declared-area";
import { b1Gaec4BufferStrips } from "./b1-gaec4-buffer-strips";
import { b2Gaec5ErosionScope } from "./b2-gaec5-erosion-scope";
import { b3Gaec6SoilCover } from "./b3-gaec6-soil-cover";
import { b4Gaec7CropRotation } from "./b4-gaec7-crop-rotation";
import { b5Gaec8NonProductive } from "./b5-gaec8-non-productive";
import { b6Gaec9PermanentGrassland } from "./b6-gaec9-permanent-grassland";
import { b7Gaec2Wetlands } from "./b7-gaec2-wetlands";
import { b8Gaec3StubbleBurning } from "./b8-gaec3-stubble-burning";
import { c1OrchardGroundCover, c2ExtensiveForage, c3CatchCrops } from "./c-eco-schemes";
import { d1MowingGrazing } from "./d1-mowing-grazing";
import { d2SowingHarvestDates, d4Irrigation } from "./d-transversal";
import { organicInputsCheck } from "./organic-inputs";

/**
 * Catalogo delle schede del CORE, nell'ordine in cui la UI le presenta:
 * ammissibilità di base (A), condizionalità BCAA (B), eco-schemi (C),
 * trasversali (D), e in coda il biologico — che non è satellitare e va tenuto
 * visibilmente distinto dalle schede che osservano il cielo.
 *
 * Il catalogo comprende deliberatamente schede che **non riescono a decidere**
 * (B5 sugli elementi non produttivi, D4 sull'irrigazione): dire che una cosa
 * non si può osservare con questo sensore è informazione utile, e toglierle
 * dall'elenco lascerebbe l'utente col dubbio che ce ne siamo dimenticati.
 *
 * Le schede dei disciplinari (DOP/DOCG/IGP e consorzi) NON stanno qui e non ci
 * staranno: ognuno ha il proprio disciplinare e vivrà in un plugin esterno,
 * registrato a runtime su questo stesso registro. Qui non se ne carica nessuno.
 */
export const CORE_CHECKS: readonly CheckSpec[] = [
  a1AgriculturalActivity,
  a2CropCoherence,
  a3DeclaredArea,
  b1Gaec4BufferStrips,
  b2Gaec5ErosionScope,
  b3Gaec6SoilCover,
  b4Gaec7CropRotation,
  b5Gaec8NonProductive,
  b6Gaec9PermanentGrassland,
  b7Gaec2Wetlands,
  b8Gaec3StubbleBurning,
  c1OrchardGroundCover,
  c2ExtensiveForage,
  c3CatchCrops,
  d1MowingGrazing,
  d2SowingHarvestDates,
  d4Irrigation,
  organicInputsCheck,
];

/** Registro del catalogo core. I plugin vi si aggiungono, non lo sostituiscono. */
export function coreCheckRegistry(): CheckRegistry {
  return new CheckRegistry(CORE_CHECKS);
}

export { a1AgriculturalActivity } from "./a1-agricultural-activity";
export { a2CropCoherence } from "./a2-crop-coherence";
export { a3DeclaredArea } from "./a3-declared-area";
export { b1Gaec4BufferStrips } from "./b1-gaec4-buffer-strips";
export { b2Gaec5ErosionScope } from "./b2-gaec5-erosion-scope";
export { b3Gaec6SoilCover } from "./b3-gaec6-soil-cover";
export { b4Gaec7CropRotation, profileDistance } from "./b4-gaec7-crop-rotation";
export { b5Gaec8NonProductive } from "./b5-gaec8-non-productive";
export { b6Gaec9PermanentGrassland } from "./b6-gaec9-permanent-grassland";
export { b7Gaec2Wetlands } from "./b7-gaec2-wetlands";
export { b8Gaec3StubbleBurning } from "./b8-gaec3-stubble-burning";
export { c1OrchardGroundCover, c2ExtensiveForage, c3CatchCrops } from "./c-eco-schemes";
export { d1MowingGrazing } from "./d1-mowing-grazing";
export { d2SowingHarvestDates, d4Irrigation } from "./d-transversal";
export { organicInputsCheck } from "./organic-inputs";
