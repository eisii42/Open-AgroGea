# Glossary IT → EN

This glossary is the **single source of truth** for anglicizing AgroGea's code
during the English-restructure effort. It maps recurring Italian terms to the
English identifiers/paths to use **consistently** everywhere in code (file and
folder names, variables, functions, types, object keys).

Scope and rules (see `CLAUDE.md` §2–§3):

- **Code only.** UI strings shown to the farmer stay in Italian and go through
  i18n (`apps/agro-field-suite/src/i18n`). Comments are **not** translated.
- **Domain/regulatory terms are never translated** and never appear in the
  "Italian" column below: `PAN`, `UMA`, `SIAN`, `SIEX`, `CUE`, `CUMP`, `BBCH`,
  `Ky`, `FAO-56`, `FAO-33`, cadastral abbreviations, etc.
- **Align to the persisted DB names.** The PGlite schema is already in English
  and is the tie-breaker: e.g. the schema uses `plots_registry`/`plot_id`, so
  *appezzamento → **plot*** (not "field"); `companies`, so *azienda → **company***;
  `harvest_logs`, so *raccolta → **harvest***; `treatment_logs`, so
  *trattamento → **treatment***.

## Domain nouns

| Italian | English | Notes / DB anchor |
|---|---|---|
| appezzamento / appezzamenti | plot / plots | `plots_registry`, `plot_id` (not "field") |
| coltura / colture | crop / crops | `crops` table |
| categoria coltura | crop category | |
| azienda / aziende | company / companies | `companies` |
| operazione | operation | `operation_type` |
| trattamento | treatment | `treatment_logs` |
| raccolta / raccolte | harvest / harvests | `harvest_logs` |
| magazzino | warehouse | |
| prodotto / prodotti | product / products | `products` |
| lotto | lot | `product_lots` |
| giacenza | stock / quantity on hand | `quantity_on_hand` |
| scadenza | expiry | `expires_at` |
| carico (di magazzino) | inbound / receipt | keep `CUMP` token |
| scarico (di magazzino) | issue / outbound | |
| bilancio (idrico) | (water) balance | |
| suolo | soil | merge `modules/suolo` → `modules/soil` |
| geometria | geometry | |
| area (ettari) | area (hectares) | `area_ha` |
| lunghezza (metri) | length (meters) | `length_m` |
| centroide | centroid | `centroid` |
| meteo | weather | `weather_readings` |
| calcolo | calculation | |
| sintesi | summary | |
| storico | history | |
| umidità | moisture | |
| sorgente | source | |
| anagrafica | registry | `plots_registry` |
| impostazioni | settings | |
| quaderno (di campagna) | logbook | "field logbook" |
| registro | registry / log | |
| dichiarativo | declarative | keep `SIAN` token |
| fascicolo (aziendale) | (farm) dossier | |
| esito | outcome | |
| risultato | result | |
| fenologia | phenology | |
| fitopatologia | phytopathology / plant pathology | |
| zonazione | zoning | |
| indici | indices | |
| nuova azienda | new company | |
| modulo (variabile) | module | |
| categoria | category | |

## Crop-family folders (`modules/crops/*`)

| Italian | English |
|---|---|
| cereali | cereals |
| frutta | fruit |
| olivo | olive |
| orticoltura | vegetables |
| vite | grapevine |
| shared | shared |

## Representative identifier renames

These are the recurring public/cross-package identifiers (many exported by
`@agrogea/core`) and their target names. Apply the same patterns to their
variants.

| Italian identifier | English identifier |
|---|---|
| `Appezzamento` (type) | `Plot` |
| `AppezzamentoDrawAttrs` | `PlotDrawAttrs` |
| `NuovaAziendaInput` | `NewCompanyInput` |
| `colturaPerAppezzamento` | `cropForPlot` |
| `appezzamentiToFeatureCollection` | `plotsToFeatureCollection` |
| `raccolteToFeatureCollection` | `harvestsToFeatureCollection` |
| `trattamentiToFeatureCollection` | `treatmentsToFeatureCollection` |
| `cropModulePerColtura` | `cropModuleForCrop` |
| `categoriaPerOperazione` | `categoryForOperation` |
| `cumpDopoCarico` | `cumpAfterInbound` |
| `lottoScaduto` | `lotExpired` |
| `statoScadenza` | `expiryStatus` |
| `StatoScadenzaLotto` | `LotExpiryStatus` |
| `validateProdotto` | `validateProduct` |
| `ProdottoDraft` | `ProductDraft` |
| `ProdottoValidationError` | `ProductValidationError` |
| `areaEttari` | `areaHectares` |
| `lunghezzaMetri` | `lengthMeters` |
| `centroide` | `centroid` |
| `classificaGeometria` | `classifyGeometry` |
| `normalizzaGeometria` | `normalizeGeometry` |
| `geometriaHaCoordinate` | `geometryHasCoordinates` |
| `GeometriaDisegnata` | `DrawnGeometry` |
| `dichiarativiMancanti` | `missingDeclarative` |
| `sianCompleta` | `sianComplete` |
| `sianMancanti` | `missingSian` |
| `sistemaDichiarativo` | `declarativeSystem` |
| `CampoDichiarativoMancante` | `MissingDeclarativeField` |
| `CampoSianMancante` | `MissingSianField` |
| `SistemaDichiarativo` | `DeclarativeSystem` |
| `useDssCalcolo` | `useDssCalculation` |
| `RisultatoDssPlot` | `DssPlotResult` |
| `SintesiCampo` | `FieldSummary` |
| `sintetizzaRischioCampo` | `summarizeFieldRisk` |
| `calibrazioneSintesi` | `summaryCalibration` |
| `costruisciStoricoUmiditaFc` | `buildMoistureHistoryFc` |
| `RigaStoricoUmidita` | `MoistureHistoryRow` |
| `FormatoStoricoUmidita` | `MoistureHistoryFormat` |
| `serializzaStoricoUmidita` | `serializeMoistureHistory` |
| `SorgenteSuolo` | `SoilSource` |
| `scaricaArtifact` | `downloadArtifact` |
| `bilancioIdricoColtura` | `cropWaterBalance` |
| `costruisciSerieDss` | `buildDssSeries` |
| `eseguiDssModulo` | `runDssModule` |
| `esitiToRisultatiDss` | `outcomesToDssResults` |
| `EsitoDss` | `DssOutcome` |
| `BilancioColturaInput` / `...Output` | `CropBalanceInput` / `...Output` |
| `CategoriaColtura` | `CropCategory` |
| `ContestoDss` | `DssContext` |
| `MeteoGiornoDss` | `DssWeatherDay` |
| `cerealiModule` / `fruttaModule` / `olivoModule` / `orticolturaModule` / `viteModule` | `cerealsModule` / `fruitModule` / `oliveModule` / `vegetablesModule` / `grapevineModule` |
| `categorie` / `categoria` (obj keys) | `categories` / `category` |
| `modulo` (loop var) | `module` |

## File / folder renames (indicative)

| From | To |
|---|---|
| `components/AnagraficaPanel.tsx` | `RegistryPanel.tsx` |
| `components/BilancioIdricoPanel.tsx` | `WaterBalancePanel.tsx` |
| `components/ImpostazioniPanel.tsx` | `SettingsPanel.tsx` |
| `components/MagazzinoPanel.tsx` | `WarehousePanel.tsx` |
| `components/QuadernoPanel.tsx` | `LogbookPanel.tsx` |
| `components/SuoloPanel.tsx` | `SoilPanel.tsx` |
| `components/OperazioneForm.tsx` | `OperationForm.tsx` |
| `components/OperazioneDettaglioCard.tsx` | `OperationDetailCard.tsx` |
| `components/ConfirmDeleteOperazione.tsx` | `ConfirmDeleteOperation.tsx` |
| `components/RaccoltaPanel.tsx` | `HarvestPanel.tsx` |
| `components/RaccoltaDettaglioCard.tsx` | `HarvestDetailCard.tsx` |
| `components/RegistroGeometrie.tsx` | `GeometryRegistry.tsx` |
| `modules/crops/ColturaPanel.tsx` | `CropPanel.tsx` |
| `modules/crops/shared/bilancio.ts` | `shared/balance.ts` |
| `modules/crops/shared/dssComuni.ts` | `shared/dss-common.ts` |
| `modules/crops/shared/serieMeteo.ts` | `shared/weather-series.ts` |
| `modules/crops/{cereali,frutta,olivo,orticoltura,vite}` | `{cereals,fruit,olive,vegetables,grapevine}` |
| `modules/suolo/suolo-analytics.ts` | `modules/soil/soil-analytics.ts` |
| `modules/sian/importaFascicolo.ts` | `modules/sian/import-dossier.ts` |
| `hooks/useAppezzamentiLayer.ts` | `hooks/usePlotsLayer.ts` |
| `hooks/useDssCalcolo.ts` | `hooks/useDssCalculation.ts` |
| `hooks/useSuoloPipeline.ts` | `hooks/useSoilPipeline.ts` |
| `lib/meteoCodici.ts` | `lib/weather-codes.ts` |
| `packages/agro-ui/src/components/TrattamentoForm.tsx` | `TreatmentForm.tsx` |
