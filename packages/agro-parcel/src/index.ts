/**
 * `@agrogea/parcel` — il contratto delle unità di riferimento territoriale e il
 * vocabolario del catalogo delle fonti pubbliche europee.
 *
 * Pacchetto FOGLIA: zero dipendenze runtime, nessun accesso a DB, rete o DOM.
 * Lo importano `@agrogea/core` (adozione e persistenza) e i plugin distribuiti a
 * parte, che devono poter leggere il contratto senza tirarsi dietro PGlite.
 * Per questo non dipende, e non deve mai dipendere, da `@agrogea/core`.
 */
export {
  PARCEL_SCHEMA_VERSION,
  REFERENCE_UNIT_TYPES,
  isManualParcel,
  isReferenceUnitType,
  isSourcedParcel,
  parcelGeometry,
  type ManualParcel,
  type Parcel,
  type ParcelBase,
  type ParcelLicense,
  type ReferenceUnitType,
  type SourcedParcel,
  type SourcedReferenceUnitType,
} from "./parcel";
export {
  ISO_3166_1_ALPHA_2,
  isIsoAlpha2,
  type IsoAlpha2,
} from "./iso-3166";
export {
  PARCEL_SOURCE_ACCESS_TYPES,
  PARCEL_SOURCE_UPDATE_CADENCES,
  nutsCountryToIso,
  validateCatalog,
  validateSourceRecord,
  type ParcelAttributeMapping,
  type ParcelSourceAccessType,
  type ParcelSourceAttributeMap,
  type ParcelSourceIssue,
  type ParcelSourceRecord,
  type ParcelSourceUpdateCadence,
} from "./source-record";
export {
  PARCEL_SOURCE_CATALOG,
  nutsCovers,
  sourceById,
  sourcesCovering,
} from "./catalog";
export {
  DEFAULT_MAX_FEATURES,
  DEFAULT_PAGE_SIZE,
  POINT_QUERY_EPSILON_DEG,
  bboxAroundPoint,
  isPolygonal,
  type BBox,
  type LngLat,
  type ParcelFetch,
  type ParcelPrefetchProgress,
  type ParcelQueryOptions,
  type ParcelSource,
  type ParcelSourceDeps,
  type Position2D,
  type Reprojector,
} from "./source";
export {
  featureToParcel,
  normalizeFeatureCollection,
  reprojectGeometry,
  resolveMapping,
  type NormalizeDeps,
  type NormalizeResult,
} from "./normalize";
export { buildWfsUrl, createWfsSource, epsgToUrn } from "./wfs-source";
export {
  buildOgcApiUrl,
  createOgcApiSource,
  epsgToOgcUri,
  nextPageUrl,
} from "./ogcapi-source";
export {
  MANUAL_SOURCE_ID,
  createManualParcel,
  createManualSource,
  type ManualParcelDeps,
  type ManualParcelInput,
} from "./manual-source";
export {
  UnsupportedAccessTypeError,
  createParcelSource,
} from "./source-factory";
