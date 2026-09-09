export * from "./types";
export * from "./team/subscription-limits";
export * from "./team/membership-guard";
export * from "./team/hooks";
export {
  cropColor,
  cropStyle,
  NO_CROP_COLOR,
  type CropIconKey,
  type CropStyle,
} from "./crop-colors";
export {
  assetColor,
  assetStyle,
  ASSET_NEUTRAL_COLOR,
  type AssetIconKey,
  type AssetStyle,
} from "./asset-colors";
export { isTauriRuntime, tauriInvoke } from "./runtime";
export {
  controlPlane,
  registerControlPlane,
  type ControlPlaneAdapter,
} from "./control-plane";
export {
  AGRO_LOCAL_SCHEMA_SQL,
  AGRO_LOCAL_SCHEMA_VERSION,
} from "./db/schema";
export {
  openTenantDb,
  closeTenantDb,
  dumpTenantDb,
  exportSqlDump,
  tenantDataDir,
} from "./db/tenant-db";
export { AgroDal } from "./db/dal";
export { WarehouseError } from "./db/dal-warehouse";
export {
  AUDIO_URI_SCHEME,
  type AudioBlob,
  type CompleteFieldSessionOptions,
  type CompleteFieldSessionResult,
} from "./db/dal-tasks";
export {
  EXPIRY_WARNING_DAYS_DEFAULT,
  categoryForOperation,
  cumpAfterInbound,
  fertilizerTypeFromProduct,
  lotExpired,
  expiryStatus,
  npkRatioFromProduct,
  validateProduct,
  type ProductDraft,
  type ProductValidationError,
  type LotExpiryStatus,
} from "./warehouse/cump";
export {
  OnPremiseSyncTarget,
  LocalOnlySyncTarget,
  createSyncTarget,
  toWirePayload,
  maxUpdatedAt,
  PULL_TABLES,
  PULL_PAGE_SIZE,
  type SyncTarget,
} from "./sync/targets";
export { LOCAL_TENANT_ID, localTenantClaims } from "./standalone";
export {
  COMPANY_TRANSFER_FORMAT,
  COMPANY_TRANSFER_VERSION,
  TRANSFER_SCHEMA_VERSION,
  TRANSFER_SECTIONS,
  CompanyTransferError,
  documentSchemaVersion,
  emptyCompanySnapshot,
  emptyMachineryBundle,
  emptyPlanningBundle,
  emptyWarehouseBundle,
  fullTransferScope,
  migrateTransferDocument,
  parseCompanyTransfer,
  planPlotImport,
  serializeCompanySnapshot,
  withinPeriod,
  type PlotImportPlan,
  type AgronomicLogs,
  type AssetFeatureProperties,
  type CompanySnapshot,
  type CompanyTransferDocument,
  type CompanyTransferMeta,
  type MachineryBundle,
  type PlanningBundle,
  type PlotBundle,
  type PlotFeatureProperties,
  type ScoutingFeatureProperties,
  type SessionFeatureProperties,
  type TransferFeatureProperties,
  type TransferPeriod,
  type TransferScope,
  type TransferSection,
  type WarehouseBundle,
  type WarehouseFeatureProperties,
} from "./transfer/company-transfer";
export { SyncRouter, type SyncRouterOptions } from "./sync/router";
export {
  useAgroStore,
  isViewerReadOnly,
  PARCEL_CANDIDATE_COLOR,
  PARCEL_SELECTED_COLOR,
  parcelsToFeatureCollection,
  plotsToFeatureCollection,
  assetsToFeatureCollection,
  cropForPlot,
  poiToFeatureCollection,
  harvestsToFeatureCollection,
  treatmentsToFeatureCollection,
  type AgroState,
  type AppView,
  type PlotDrawAttrs,
  type AssetDrawAttrs,
  type GeofenceWatchErrorCode,
  type GeofenceWatchStatus,
  type NewCompanyInput,
  type PendingGeometry,
  type SelectableKind,
  type SelectedFeatureRef,
  type SessionCloseOutcome,
  type GeomEditSession,
} from "./store";
export { bindGeoEditorCapture } from "./field/geo-editor-bridge";
export {
  areaHectares,
  boundingBox,
  centroid,
  classifyGeometry,
  geometryHasCoordinates,
  geometryFamily,
  lengthMeters,
  normalizeGeometry,
  pickEditedFeature,
  sameGeometryFamily,
  type DrawnGeometry,
} from "./geo/area";
export {
  applyTheme,
  loadTheme,
  persistTheme,
  type AgroTheme,
} from "./field/theme";
export {
  APP_LOCALES,
  DEFAULT_LOCALE,
  loadLocale,
  persistLocale,
  type AppLocale,
} from "./field/locale";
export {
  DASHBOARD_MODULE_IDS,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_MAP_ZOOM_LIMITS,
  DEFAULT_UNITS,
  MAP_ZOOM_CEILING,
  MAP_ZOOM_CHOICES,
  MAP_ZOOM_FLOOR,
  areaUnitLabel,
  formatArea,
  formatYield,
  irrigationToLitres,
  litresToIrrigation,
  loadDashboardLayout,
  loadMapZoomLimits,
  loadUnits,
  mergeDashboardLayout,
  normalizeMapZoomLimits,
  persistDashboardLayout,
  persistMapZoomLimits,
  persistUnits,
  waterUnitLabel,
  yieldUnitLabel,
  type AreaUnit,
  type DashboardLayoutConfig,
  type DashboardModuleId,
  type MapZoomLimits,
  type UnitSystem,
  type WaterUnit,
  type YieldUnit,
} from "./field/settings";
export {
  useSettingsStore,
  type PreferencesSyncState,
  type SettingsState,
} from "./field/settings-store";
export {
  PAN_DOSE_UNITS,
  validateFertilizationLog,
  validateTreatmentLog,
  type FertilizationDraft,
  type PanDoseUnit,
  type TreatmentDraft,
  type ValidationError,
} from "./field/pan-validation";
export {
  evaluateLogCompleteness,
  evaluateTaskCompleteness,
  type CompletenessField,
  type CompletenessResult,
  type CompletenessSeverity,
  type RecipeCompletenessInput,
  type TaskCompletenessContext,
  type TaskCompletenessInput,
} from "./field/task-completeness";
export {
  buildPlotAlerts,
  lacksSoilTexture,
  type PlotAlert,
  type PlotAlertsInput,
  type PlotDataGap,
} from "./field/plot-alerts";
export {
  loadOperatorMemory,
  persistOperatorMemory,
  type OperatorMemory,
} from "./field/operator-memory";
export {
  toDate,
  toEpochMs,
  toIsoDay,
  toIsoString,
  type TimestampLike,
} from "./field/timestamps";
export {
  SESSION_NOTE_PREFIX,
  composeSessionLogs,
  pickLotForProduct,
  sessionIdFromNote,
  type SessionLogComposition,
  type SessionLogContext,
  type SessionLogDraft,
  type SessionLogWarning,
  type SessionLogWarningKind,
} from "./field/session-logbook";
export {
  sowingCropAssignment,
  type SowingCropAssignment,
  type SowingCropContext,
} from "./field/session-crop";
export {
  missingDeclarative,
  sianComplete,
  missingSian,
  declarativeSystem,
  declarativeLabelSet,
  type DeclarativeLabelSet,
  type MissingDeclarativeField,
  type MissingSianField,
  type DeclarativeSystem,
} from "./compliance/sian-campaign";
export {
  CERTIFICATION_SCHEMES,
  ORGANIC_CONVERSION_MONTHS,
  PRODUCTION_REGIMES,
  conversionEndsOn,
  findOperatorCertification,
  isCertificationValid,
  isEmptyCertification,
  isOrganicRegime,
  isProductionRegime,
  readOperatorCertifications,
  withOperatorCertification,
} from "./compliance/certifications";
export {
  EPSG_DEFINITIONS,
  UnknownCrsError,
  createProj4Reprojector,
} from "./geo/reproject";
export {
  PARCEL_METADATA_KEY,
  ParcelAlreadyAdoptedError,
  attributionLine,
  findAdoptedPlot,
  parcelProvenance,
  parcelToPlotDraft,
  plotProvenance,
  type AdoptedPlotDraft,
  type AdoptionInput,
  type ParcelProvenance,
} from "./parcel/adoption";
export {
  COUNTRIES_WITH_BBOX,
  DEFAULT_COUNTRY,
  SUPPORTED_COUNTRIES,
  checkPlotCountry,
  detectCountryAtPoint,
  hasCountryBbox,
  normalizeCountryCode,
  pointInCountry,
  plotsBoundingBox,
  resolveCountry,
  resolvePerPlotCountry,
  type CountryCode,
  type CountryResolution,
  type CountrySource,
  type CountryWarning,
  type CountryWithBbox,
  type PlotCountryCheck,
  type PlotGeometry,
} from "./compliance/country-resolution";
// Ri-esportati da `@agrogea/parcel` (pacchetto foglia del contratto): chi
// consuma `@agrogea/core` continua a trovarli qui, dove sono sempre stati.
export {
  ISO_3166_1_ALPHA_2,
  isIsoAlpha2,
  type IsoAlpha2,
} from "@agrogea/parcel";
