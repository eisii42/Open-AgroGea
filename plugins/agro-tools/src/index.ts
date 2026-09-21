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
  NDMI_RAMP,
  ndviColor,
  INDEX_RAMP,
  rampForIndex,
  indexStatistics,
  type NormalizedIndex,
  type IndexStats,
  type SoilIndex,
  type VegetationIndex,
} from "./indices";

// -- Colori/rampe per il fill degli indici (refactor modulo Suolo) --
export {
  colorFromRamp,
  hexToRgb,
  type ColorRamp,
} from "./overlay";

// -- Griglia celle raster d'index (10×10 m, color scale relativa) --
export {
  rasterToIndexCells,
  indexCellValues,
  relativeDomain,
  relativeRamp,
  indexCellColorExpression,
  type IndexLayerRaster,
  type IndexCellProperties,
  type IndexGridOptions,
} from "./index-grid";

// -- Codec compatto del raster d'index (cache locale del modulo Suolo) --
export {
  encodeIndexRaster,
  decodeIndexRaster,
  DEFAULT_INDEX_VALUE_SCALE,
  DEFAULT_INDEX_NODATA,
  type EncodedIndexRaster,
} from "./index-raster-codec";

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

// -- Geofencing GPS + tempo di rientro PAN --
export {
  GEOFENCE_DEFAULTS,
  advanceGeofence,
  dwellRemainingSeconds,
  haversineMeters,
  initialGeofenceState,
  pathLengthMeters,
  plotContainingPoint,
  speedKmh,
  workedAreaHectares,
  type GeoSample,
  type GeofenceEvent,
  type GeofenceOptions,
  type GeofencePlot,
  type GeofenceState,
} from "./geofencing";
export {
  activeReentryWindows,
  reentryWindowForPlot,
  type ReentryLogInput,
  type ReentryWindow,
} from "./reentry";
export { sessionElapsedMs, formatElapsedClock } from "./field-session-clock";

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
  bestScenePerDay,
  bestSceneIdsPerDay,
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

// -- Modulo Compliance: schede di monitoraggio normativo (autovalutazione) --
export {
  CHECK_GROUPS,
  LIMITING_SCORE,
  type BandId,
  type CheckGroup,
  type CheckInput,
  type CheckOutcome,
  type CheckParameter,
  type CheckParameterSpec,
  type CheckPlot,
  type CheckRequirements,
  type CheckResult,
  type CheckSpec,
  type CheckVerdict,
  type ComplianceMessage,
  type ComplianceMessageId,
  type Confidence,
  type ConfidenceFactor,
  type ConfidenceFactorId,
  type DeclaredCampaign,
  type DeclaredIssue,
  type DeclaredOperation,
  type DeclaredRequirement,
  type IndexSeries,
  type IndexSeriesPoint,
  type IndexSeriesRef,
  type LayerFindings,
  type MissingInput,
  type Observability,
  type ParameterOverrides,
  type RegulatoryReference,
  type SceneProvenance,
  type OrthophotoSummary,
  type TerrainSummary,
} from "./compliance/check-types";
export {
  DEFAULT_FACTOR_WEIGHTS,
  OBSERVABILITY_CEILING,
  SENTINEL2_GSD_M,
  SENTINEL2_REVISIT_DAYS,
  archiveDepthFactor,
  capByObservability,
  cloudCoverFactor,
  combineConfidence,
  daysBetween,
  declaredDataFactor,
  expectedScenes,
  maxGapDays,
  meanCloudCover,
  purePixelEstimate,
  purePixelFactor,
  rampScore,
  resolutionFitFactor,
  sceneCountFactor,
  temporalGapFactor,
} from "./compliance/confidence";
export {
  archiveYears,
  calendarYearWindow,
  daysAboveThresholdShare,
  detectDrops,
  dropsWithRecovery,
  multiYearWindow,
  pointsInWindow,
  provenanceOf,
  usablePoints,
  valuesOf,
  type SeriesDrop,
} from "./compliance/series";
export {
  CLOUD_COVER_PARAMETER,
  DEFAULT_MAX_CLOUD_PCT,
  DEFAULT_TOLERATED_GAP_DAYS,
  MIN_PURE_PIXELS,
  evaluatePreconditions,
  parameterValue,
  resolveParameters,
  runCheck,
  runChecks,
} from "./compliance/runner";
export { CheckRegistry } from "./compliance/registry";
export {
  DEFAULT_EXG_THRESHOLD,
  excessGreen,
  resolvesFeature,
  vegetatedShare,
} from "./compliance/orthophoto";
export {
  CORE_CHECKS,
  coreCheckRegistry,
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
  profileDistance,
} from "./compliance/checks";

// -- Motore del biologico: non satellitare, si calcola dalle operazioni --
export {
  CONVERSION_MONTHS,
  COPPER_LIMIT_KG_HA,
  COPPER_WINDOW_YEARS,
  NITROGEN_LIMIT_KG_HA,
  addMonths,
  assessConversion,
  assessCopper,
  assessNitrogen,
  assessOrganic,
  assessSubstances,
  nitrogenFromNpkRatio,
  type ConversionFinding,
  type LimitFinding,
  type OperationFinding,
  type OperationVerdict,
  type OrganicAssessment,
  type OrganicAssessmentInput,
} from "./compliance/organic/organic-engine";
export {
  ORGANIC_INPUT_REFERENCE,
  lookupSubstance,
  normalizeSubstance,
  type SubstanceAnnex,
  type SubstanceEntry,
  type SubstanceLookup,
  type SubstanceReference,
} from "./compliance/organic/substances";
