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
