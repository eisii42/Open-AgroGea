/**
 * Modulo Suolo — gestione idro-pedologica e bilancio idrico (FAO 56/66).
 *
 * Punti d'ingresso:
 *   * {@link SoilDataResolver} — risoluzione θFC/θPWP da mappa custom (Tier 1),
 *     soilSamples georeferenziati via DuckDB Spatial + Saxton-Rawls (Tier 2),
 *     metadata/default (Tier 3);
 *   * export dello storico umidità in GeoJSON/Shapefile/CSV localizzato.
 *
 * Il motore di BILANCIO IDRICO dinamico vive in `../dss/water-balance`
 * (orchestrazione FAO 56/66) e l'overlay tematico DSS in `../dss/dss-overlay`.
 */
export {
  aggregateTexture,
  fractionsFromSample,
  frazioniDaProprieta,
  SOIL_METADATA_KEY,
  parametriDaMetadata,
  parametersFromManualSoil,
  SoilDataResolver,
  sostanzaOrganicaDaProprieta,
  DEFAULT_LOAM_SOIL,
  type ResolutionOptions,
  type ResolvedSoilParameters,
  type SoilSource,
  type ManualSoil,
} from "./SoilDataResolver";

export {
  buildMoistureHistoryFc,
  serializeMoistureHistory,
  type MoistureHistoryFormat,
  type MoistureHistoryRow,
} from "./soil-export";
