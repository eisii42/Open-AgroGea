// -- Indici spettrali e soil-masking (Modulo 1) --
export {
  applySoilMask,
  REQUIRED_BANDS,
  SOIL_BANDS,
  computeIndex,
  computeMsavi2,
  computeSavi,
  normalizedDifference,
  coverFraction,
  isSoilIndex,
  NDVI_RAMP,
  NDWI_RAMP,
  ndviColor,
  INDEX_RAMP,
  rampForIndex,
  indexStatistics,
  type NormalizedIndex,
  type IndexStats,
  type SoilIndex,
  type VegetationIndex,
} from "./indices";

// -- Overlay raster d'index sulla mappa (refactor modulo Suolo) --
export {
  colorFromRamp,
  windowToCoordinates,
  hexToRgb,
  indexToRgba,
  type OverlayCoordinates,
  type ColorRamp,
} from "./overlay";

// -- Matrici di calibrazione fenologica (Modulo 1) --
export {
  getPhaseCalibration,
  getCropMatrix,
  CROP_MATRICES,
  soilMaskThreshold,
  type PhaseCalibration,
  type CropType,
  type PhenologicalPhase,
  type CropMatrix,
} from "./phenology";

// -- Zonazione VRA (Modulo 1) --
export {
  dosesPerClass,
  kmeansZoning,
  type VigorClass,
  type VraLogic,
  type ZoningResult,
} from "./zoning";

// -- Agrometeo: ET0/ETc/bilancio idrico (Modulo 2) --
export {
  waterBalanceFao66,
  waterStressCoefficient,
  et0PenmanMonteith,
  cropEt,
  irrigationPlan,
  yieldReductionFao66,
  soilWaterStatus,
  type WaterBalanceDay,
  type WeatherDataDay,
  type SoilParameters,
  type IrrigationPlanDay,
  type WaterStatus,
} from "./agrometeo";

// -- Pedotransfer del suolo: Saxton-Rawls θFC/θPWP (Modulo Suolo) --
export {
  fractionsFromTexture,
  normalizeFractions,
  saxtonRawlsSoilParameters,
  saxtonRawls,
  type TextureFractions,
  type SaxtonRawlsOptions,
} from "./soil";

// -- DSS fitopatologico (Modulo 3) --
export {
  degreeDayAccumulation,
  alertA01,
  degreeDaysMeanThreshold,
  degreeDaysSingleSine,
  normalizeRiskIndex,
  threeTenRule,
  riskLevelA01,
  peacockEyeRisk,
  powderyMildewRisk,
  type PhytopathologyAlert,
  type PeacockEyeDay,
  type PowderyMildewDay,
  type DownyMildewDay,
  type RiskLevel,
  type ThermalPoint,
} from "./phytopathology";

// -- Parco macchine: consumo l/h, anomalie, scadenziario manutenzione (0.3.0) --
export {
  fuelConsumption,
  evaluateMaintenance,
  rescheduleMaintenance,
  type RefillPoint,
  type FuelConsumptionResult,
  type FuelConsumptionOptions,
  type MaintenanceUrgency,
  type MaintenanceScheduleInput,
  type MaintenanceEvaluation,
  type MaintenanceThresholds,
} from "./machinery";

// -- Clip raster sul poligono + proiezione UTM (Modulo 1) --
export {
  clipRasterToPolygon,
  type RasterWindow,
} from "./clip";
export {
  lonLatToUtm,
  utmEpsg,
  utmToLonLat,
  utmZoneFromLon,
  type UtmPoint,
} from "./utm";

// -- Pipeline NDVI on-demand via STAC (Modulo 1) --
export {
  BAND_ASSET_KEYS,
  requiredBandsForIndices,
  buildStacSearchBody,
  searchSceneSeries,
  searchLatestNdviScene,
  applySasToken,
  extractSceneSeries,
  filterWindowFromLatest,
  signPlanetaryComputerHref,
  selectBestItem,
  SENTINEL2_COLLECTION,
  STAC_API_URL,
  STAC_SIGN_URL,
  STAC_TOKEN_URL,
  planetaryComputerToken,
  type SasToken,
  type IndicesScene,
  type NdviScene,
  type StacAsset,
  type StacItem,
  type StacItemCollection,
  type StacSearchParams,
} from "./stac";

// -- Plugin GeoLibre (registro indici headless) --
export {
  AGRO_INDICES_PLUGIN_ID,
  agroIndicesPlugin,
  getAgroIndicesHost,
} from "./plugin";
