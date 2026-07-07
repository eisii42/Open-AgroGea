// -- Indici spettrali e soil-masking (Modulo 1) --
export {
  applicaSoilMask,
  BANDE_RICHIESTE,
  BANDE_SUOLO,
  calcolaIndice,
  calcolaMsavi2,
  calcolaSavi,
  differenzaNormalizzata,
  frazioneCopertura,
  isIndiceSuolo,
  NDVI_RAMP,
  NDWI_RAMP,
  ndviColor,
  RAMPA_INDICE,
  rampaPerIndice,
  statisticheIndice,
  type IndiceNormalizzato,
  type IndiceStats,
  type IndiceSuolo,
  type IndiceVegetazionale,
} from "./indices";

// -- Overlay raster d'indice sulla mappa (refactor modulo Suolo) --
export {
  coloreDaRampa,
  finestraToCoordinates,
  hexToRgb,
  indiceToRgba,
  type OverlayCoordinates,
  type RampaColore,
} from "./overlay";

// -- Matrici di calibrazione fenologica (Modulo 1) --
export {
  getCalibrazioneFase,
  getMatriceColtura,
  MATRICI_COLTURA,
  sogliaSoilMask,
  type CalibrazioneFase,
  type Coltura,
  type FaseFenologica,
  type MatriceColtura,
} from "./phenology";

// -- Zonazione VRA (Modulo 1) --
export {
  dosiPerClasse,
  zonazioneKMeans,
  type ClasseVigore,
  type LogicaVRA,
  type RisultatoZonazione,
} from "./zoning";

// -- Agrometeo: ET0/ETc/bilancio idrico (Modulo 2) --
export {
  bilancioIdricoFao66,
  coefficienteStressIdrico,
  et0PenmanMonteith,
  etColturale,
  pianoIrriguo,
  riduzioneResaFao66,
  statoIdricoSuolo,
  type BilancioIdricoGiorno,
  type DatiMeteoGiorno,
  type ParametriSuolo,
  type PianoIrriguoGiorno,
  type StatoIdrico,
} from "./agrometeo";

// -- Pedotransfer del suolo: Saxton-Rawls θFC/θPWP (Modulo Suolo) --
export {
  frazioniDaTessitura,
  normalizzaFrazioni,
  parametriSuoloSaxtonRawls,
  saxtonRawls,
  type FrazioniTessitura,
  type OpzioniSaxtonRawls,
} from "./soil";

// -- DSS fitopatologico (Modulo 3) --
export {
  accumuloGradiGiorno,
  alertA01,
  gradiGiornoMediaSoglia,
  gradiGiornoSingleSine,
  normalizzaIndiceRischio,
  regolaTreDieci,
  rischioLivelloA01,
  rischioOcchioPavone,
  rischioOidio,
  type AlertFitopatologico,
  type GiornoOcchioPavone,
  type GiornoOidio,
  type GiornoPeronospora,
  type LivelloRischio,
  type PuntoTermico,
} from "./phytopathology";

// -- Clip raster sul poligono + proiezione UTM (Modulo 1) --
export {
  clipRasterAlPoligono,
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
  bandeRichiestePerIndici,
  buildStacSearchBody,
  cercaSerieScene,
  cercaUltimaScenaNdvi,
  applicaTokenSas,
  estraiSerieScene,
  filtraFinestraDaUltima,
  firmaHrefPlanetaryComputer,
  selezionaMigliorItem,
  SENTINEL2_COLLECTION,
  STAC_API_URL,
  STAC_SIGN_URL,
  STAC_TOKEN_URL,
  tokenPlanetaryComputer,
  type TokenSas,
  type ScenaIndici,
  type ScenaNdvi,
  type StacAsset,
  type StacItem,
  type StacItemCollection,
  type StacSearchParams,
} from "./stac";

// -- Plugin GeoLibre (registro indici headless) --
export {
  AGRO_INDICI_PLUGIN_ID,
  agroIndiciPlugin,
  getAgroIndiciHost,
} from "./plugin";
