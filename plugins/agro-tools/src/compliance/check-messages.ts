/**
 * Catalogo degli id di messaggio del modulo Compliance.
 *
 * È un'UNIONE FINITA e non una stringa libera per una ragione pratica: la UI
 * risolve `t(\`compliance.messages.${id}\`)`, e un'unione di letterali produce
 * un'unione di chiavi che TypeScript verifica contro `en.json`. Una scheda non
 * può quindi introdurre un testo che nessuno ha tradotto, e rinominare una
 * chiave rompe la compilazione invece di svuotare silenziosamente la UI.
 *
 * Nomi in inglese come ogni altro identificatore; i testi (in italiano,
 * inglese, francese e spagnolo) vivono in `i18n/locales/*.json`.
 */

/** Che cosa osserva ciascuna scheda. */
export type SubjectMessageId =
  | "subject.a1AgriculturalActivity"
  | "subject.a2CropCoherence"
  | "subject.a3DeclaredArea"
  | "subject.b1BufferStrips"
  | "subject.b2SlopeTillage"
  | "subject.b3SoilCover"
  | "subject.b4CropRotation"
  | "subject.b5NonProductiveAreas"
  | "subject.b6PermanentGrassland"
  | "subject.b7WetlandsPeatlands"
  | "subject.b8StubbleBurning"
  | "subject.c1OrchardGroundCover"
  | "subject.c2ExtensiveForage"
  | "subject.c3CatchCrops"
  | "subject.d1MowingGrazing"
  | "subject.d2SowingHarvestDates"
  | "subject.d3Deforestation"
  | "subject.d4Irrigation"
  | "subject.organicInputs";

/** Con quale metodo, e perché quel metodo è difendibile. */
export type MethodMessageId =
  | "method.a1AgriculturalActivity"
  | "method.a2CropCoherence"
  | "method.a3DeclaredArea"
  | "method.b1BufferStrips"
  | "method.b2SlopeTillage"
  | "method.b3SoilCover"
  | "method.b4CropRotation"
  | "method.b5NonProductiveAreas"
  | "method.b6PermanentGrassland"
  | "method.b7WetlandsPeatlands"
  | "method.b8StubbleBurning"
  | "method.c1OrchardGroundCover"
  | "method.c2ExtensiveForage"
  | "method.c3CatchCrops"
  | "method.d1MowingGrazing"
  | "method.d2SowingHarvestDates"
  | "method.d3Deforestation"
  | "method.d4Irrigation"
  | "method.organicInputs";

/** Spiegazione dell'esito, una per scheda e per esito. */
export type ExplanationMessageId =
  | "explain.a1Active"
  | "explain.a1Marginal"
  | "explain.a1Abandoned"
  | "explain.a2Coherent"
  | "explain.a2Divergent"
  | "explain.a3Consistent"
  | "explain.a3Overdeclared"
  | "explain.a3VegetatedShortfall"
  | "explain.b1Compliant"
  | "explain.b1TooClose"
  | "explain.b2NoTillageOnSlope"
  | "explain.b2TillageOnSlope"
  | "explain.b3Covered"
  | "explain.b3PartiallyCovered"
  | "explain.b3Bare"
  | "explain.b4Rotated"
  | "explain.b4Monoculture"
  | "explain.b5NotResolvable"
  | "explain.b6Stable"
  | "explain.b6Converted"
  | "explain.b7NoSignal"
  | "explain.b7DrainageSignal"
  | "explain.b8NoBurnSignal"
  | "explain.b8BurnSignal"
  | "explain.c1Covered"
  | "explain.c1Bare"
  | "explain.c2Compatible"
  | "explain.c2Incompatible"
  | "explain.c3Present"
  | "explain.c3Absent"
  | "explain.d1Events"
  | "explain.d1NoEvents"
  | "explain.d2Consistent"
  | "explain.d2Divergent"
  | "explain.d3NoChange"
  | "explain.d3ChangeAfterCutoff"
  | "explain.d4NotObservable"
  | "explain.organicCompliant"
  | "explain.organicAttention"
  | "explain.organicNonCompliant"
  | "explain.undecidable";

/** Osservazioni dei fattori di incertezza. */
export type FactorMessageId =
  | "factor.sceneCount"
  | "factor.temporalGap"
  | "factor.cloudCover"
  | "factor.purePixels"
  | "factor.resolutionFit"
  | "factor.declaredData"
  | "factor.archiveDepth";

/** Dati mancanti e come completarli. */
export type MissingMessageId =
  | "missing.noUsableScenes"
  | "missing.noUsableScenesFix"
  | "missing.tooFewPurePixels"
  | "missing.tooFewPurePixelsFix"
  | "missing.archiveTooShort"
  | "missing.archiveTooShortFix"
  | "missing.indexNotInPipeline"
  | "missing.indexNotInPipelineFix"
  | "missing.campaign"
  | "missing.campaignFix"
  | "missing.crop"
  | "missing.cropFix"
  | "missing.declaredArea"
  | "missing.declaredAreaFix"
  | "missing.operations"
  | "missing.operationsFix"
  | "missing.productionRegime"
  | "missing.productionRegimeFix"
  | "missing.issues"
  | "missing.issuesFix"
  | "missing.terrain"
  | "missing.terrainFix"
  | "missing.layer"
  | "missing.layerFix"
  | "missing.copperContent"
  | "missing.copperContentFix"
  | "missing.nitrogenContent"
  | "missing.nitrogenContentFix"
  | "missing.regimeSince"
  | "missing.regimeSinceFix"
  | "missing.resolutionTooCoarse"
  | "missing.resolutionTooCoarseFix"
  | "missing.sensorNotAvailable"
  | "missing.sensorNotAvailableFix";

/** Descrizione dei parametri (che cosa cambia muovendo la soglia). */
export type ParameterMessageId =
  | "parameter.activityNdviThreshold"
  | "parameter.activityMinEvents"
  | "parameter.coverNdviThreshold"
  | "parameter.coverMinDaysShare"
  | "parameter.coverWindowStart"
  | "parameter.coverWindowEnd"
  | "parameter.cloudCoverMax"
  | "parameter.areaTolerancePct"
  | "parameter.mowingDropDelta"
  | "parameter.mowingMinEvents"
  | "parameter.mowingRecoveryDays"
  | "parameter.slopeThresholdDeg"
  | "parameter.tillageNdviDrop"
  | "parameter.bufferWidthM"
  | "parameter.rotationSimilarityMax"
  | "parameter.grasslandConversionDrop"
  | "parameter.burnNbrDrop"
  | "parameter.catchCropMinDays"
  | "parameter.phenologyToleranceDays"
  | "parameter.deforestationNdviDrop"
  | "parameter.copperLimitKgHa"
  | "parameter.copperWindowYears"
  | "parameter.nitrogenLimitKgHa"
  | "parameter.conversionMonthsAnnual"
  | "parameter.conversionMonthsPerennial"
  | "parameter.coherenceTolerance"
  | "parameter.vegetatedNdviThreshold"
  | "parameter.featureWidthM"
  | "parameter.nonProductiveSharePct"
  | "parameter.bareSoilNdvi"
  | "parameter.drainageNdmiDrop"
  | "parameter.rowSpacingM"
  | "parameter.forageCoverThreshold"
  | "parameter.forageMinCoverShare"
  | "parameter.catchCropNdviThreshold"
  | "parameter.harvestDropDelta"
  | "parameter.cutOffYear";

/** Esiti del motore biologico, che non è satellitare. */
export type OrganicMessageId =
  | "organic.substanceAllowed"
  | "organic.substanceNotAllowed"
  | "organic.substanceUnknown"
  | "organic.copperWithinLimit"
  | "organic.copperNearLimit"
  | "organic.copperOverLimit"
  | "organic.copperUndecidable"
  | "organic.nitrogenWithinLimit"
  | "organic.nitrogenOverLimit"
  | "organic.nitrogenUndecidable"
  | "organic.conversionOngoing"
  | "organic.conversionComplete"
  | "organic.conversionUnknown"
  | "organic.incompleteOperations";

export type ComplianceMessageId =
  | SubjectMessageId
  | MethodMessageId
  | ExplanationMessageId
  | FactorMessageId
  | MissingMessageId
  | ParameterMessageId
  | OrganicMessageId;
