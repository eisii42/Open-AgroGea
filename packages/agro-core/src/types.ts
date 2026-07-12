import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

// ---------------------------------------------------------------------------
// Claims di licenza
// ---------------------------------------------------------------------------

/**
 * Sessione utente autenticata, in forma minima e indipendente dal provider.
 * L'edizione che possiede un backend di autenticazione può passare il proprio
 * oggetto sessione (strutturalmente compatibile); in standalone resta `null`.
 */
export interface AuthSession {
  user?: {
    id?: string;
    email?: string | null;
  } | null;
}

/** Destinazione dei dati ordinari del workspace. */
export type StorageConfig =
  | {
      /** Data plane gestito dall'edizione (backend remoto dell'adapter). */
      kind: "cloud";
    }
  | {
      kind: "on_premise";
      /**
       * Identificatore del profile di connessione PostgreSQL privato del
       * cliente. La stringa di connessione vera non transita mai nel JS: vive
       * nello store cifrato di Tauri ed è risolta dal comando Rust
       * `agro_push_mutations` a partire da questo id.
       */
      connection_profile: string;
    }
  | {
      /**
       * Edizione standalone/OSS senza control plane: i dati restano solo nel
       * PGlite locale. L'outbox continua a registrare le mutazioni (local-first
       * intatto), ma nessuna push raggiunge un data plane remoto — il router usa
       * il {@link LocalOnlySyncTarget}.
       */
      kind: "local";
    };

/** Claims di licenza del workspace active. */
export interface TenantClaims {
  tenantId: string;
  licenseActive: boolean;
  storageConfig: StorageConfig;
  /** Moduli colturali sbloccati dalla licenza (es. "viticoltura"). */
  modules: string[];
  /**
   * true quando il `tenantId` deriva dall'uid dell'utente (onboarding
   * self-service) anziché da una claim `tenant_id` provisionata nel JWT.
   */
  selfService: boolean;
}

// ---------------------------------------------------------------------------
// Profilo utente & licenza (Control Plane: tabella `user_profiles`)
// ---------------------------------------------------------------------------

/** Stato della licenza manuale gestito in `user_profiles.license_status`. */
export type LicenseStatus = "active" | "inactive";

/**
 * Piano licenza: governa quote di companies e posti collaboratore (lineup unico a
 * 3 livelli: `base` single-user/1 company, `standard` 5 companies+team, `plus`
 * companies illimitate+team ampio). I codici legacy (`free`/`flat_3`/`enterprise`)
 * restano accettati a runtime e ricondotti dal client (`normalizePlan`).
 */
export type LicensePlan = "base" | "standard" | "plus" | (string & {});

/**
 * Preferenze d'interfaccia dell'utente, persistite cross-device su
 * `user_profiles.preferences`.
 */
export interface UserPreferences {
  /** Unità di misura agronomiche (area, resa, apporti idrici). */
  units?: {
    area: "ha" | "ac";
    yield: "q" | "t" | "kg";
    water?: "mm" | "hl";
  };
  /** Lingua dell'interfaccia (codice {@link AppLocale}: "it"|"en"|"es"|"fr"). */
  locale?: string;
}

/**
 * Profilo dell'utente autenticato (`public.user_profiles`), fonte autorevole
 * dello stato di licenza per il gate di onboarding.
 */
export interface UserProfile {
  id: string;
  email: string;
  license_plan: LicensePlan;
  license_status: LicenseStatus;
  /**
   * Layout della dashboard (visibilità dei moduli): flag booleani per id di
   * {@link DashboardModuleId}. Local-first su localStorage, sincronizzato qui
   * per il cross-device. `null`/assente per i profili pre-v12.
   */
  dashboard_layout_config?: Record<string, boolean> | null;
  /** Altre preferenze d'interfaccia cross-device (unità, lingua). */
  preferences?: UserPreferences | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Dominio agronomico
// ---------------------------------------------------------------------------

/** Categoria colturale per il dispatch dei moduli DSS (derivata da crops.common_name). */
export type CropType =
  | "viticoltura"
  | "cereali"
  | "olivicoltura"
  | "frutticoltura"
  | (string & {});

/** Company agricola (`companies`). */
export interface Company {
  id: string;
  tenant_id: string;
  /** Ragione sociale (ex ragione_sociale). */
  business_name: string;
  /** Identificativo fiscale nazionale dell'azienda (ex CUAA / codice fiscale). */
  national_company_id: string | null;
  /** Partita IVA (ex partita_iva). */
  vat_number: string | null;
  /** Forma giuridica (ex forma_giuridica). */
  legal_form: string | null;
  /** Indirizzo della sede (ex indirizzo). */
  address: string | null;
  /** Comune (ex comune). */
  city: string | null;
  /** Provincia (ex provincia). */
  province: string | null;
  /** Regione (ex regione). */
  region: string | null;
  /** CAP (ex cap). */
  postal_code: string | null;
  /**
   * Paese dell'indirizzo legale (ISO 3166-1 alpha-2: "IT", "ES", "FR", …).
   * Sorgente PRIMARIA del Country Resolution.
   */
  country: string | null;
  email: string | null;
  /** Indirizzo PEC. */
  pec: string | null;
  /** Codice destinatario SDI per la fatturazione elettronica. */
  sdi_code: string | null;
  /** Centroide dell'azienda (jsonb GeoJSON Point). */
  centroid: Point | null;
  /** Certificazioni (ex certificazioni). */
  certifications: string[];
  /** Numero del fascicolo aziendale (ex fascicolo_aziendale). */
  farm_file_id: string | null;
  /** Organismo pagatore di riferimento (ex organismo_pagatore). */
  paying_agency: string | null;
  /** Referente aziendale (ex referente_nome). */
  contact_name: string | null;
  /** Ruolo del referente (ex referente_ruolo). */
  contact_role: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Specie/varietà coltivata (`crops`). Isolata dall'anagrafica fisica
 * dell'appezzamento: le proprietà di filiera (clone, sesto d'impianto,
 * portainnesto…) vivono dentro {@link Crop.crop_metadata}.
 */
export interface Crop {
  id: string;
  tenant_id: string;
  /** Nome comune (es. "Vite", "Olivo"). */
  common_name: string;
  /** Nome scientifico (es. "Vitis vinifera"). */
  scientific_name: string | null;
  /** Varietà/cultivar (es. "Sangiovese", "Leccino"). */
  variety_name: string | null;
  /** Proprietà dinamiche di filiera (clone, sesto d'impianto, ecc.). */
  crop_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Anagrafica FISICA immutabile dell'appezzamento (`plots_registry`, LPIS). */
export interface Plot {
  id: string;
  tenant_id: string;
  /** Company proprietaria (ex azienda_id, FK companies). */
  company_id: string;
  /** Nome libero scelto dall'utente per l'appezzamento (LPIS: user plot name). */
  user_plot_name: string;
  /** Foglio catastale (ex foglio_catastale). */
  cadastral_sheet: string | null;
  /** Particella catastale (ex particella). */
  cadastral_parcel: string | null;
  /**
   * Superficie geodetica in ettari (NUMERIC 10,4): UNICO punto di verità per la
   * area, ricalcolata dal DAL con `@turf/area` a ogni upsert. Fonte
   * autorevole per dosi e quantità totali.
   */
  area_ha: number;
  /** Cache dell'ultimo NDVI medio calcolato dalla pipeline STAC (ex ultimo_ndvi_medio). */
  last_ndvi_mean: number | null;
  geometry: Polygon | MultiPolygon;
  /** Tipo di irrigazione (ex irrigazione). */
  irrigation_type: string | null;
  /** Anno d'impianto (ex anno_impianto). */
  planting_year: number | null;
  /** Note storiche del field come entità FISICA immutabile (ex note_storiche). */
  historical_notes?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Stato BUROCRATICO annuale di un plot per una Campagna Agraria
 * (`plots_campaign`, SIAN/AGEA, LPIS/IACS). Associa un plot fisico a una
 * crop ({@link Crop}) per una determinata annata.
 */
export interface PlotCampaign {
  id: string;
  tenant_id: string;
  plot_id: string;
  /** CropType della campagna (FK crops). */
  crop_id: string;
  /** Anno della campagna agraria (es. 2026). */
  campaign_year: number;
  /** Identificativo Isola SIAN (reference parcel). */
  reference_parcel_external_id: string | null;
  /** Identificativo Plot SIAN (agricultural parcel). */
  agricultural_parcel_external_id: string | null;
  /** Codifica rigida ministeriale della crop. */
  crop_external_code: string | null;
  /** Codifica rigida ministeriale della varietà. */
  variety_external_code: string | null;
  /** Superficie ufficiale dichiarata in ettari (IACS declared area, NUMERIC 10,4). */
  declared_area_ha: number;
  /**
   * Chiusura del ciclo colturale (ISO): il raccolto di un'ANNUALE termina la
   * campagna e il field torna libero (mappa neutra, DSS spento, nuova semina
   * possibile nello stesso anno). `null` = campagna aperta; le perenni non si
   * chiudono mai automaticamente.
   */
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Sintesi dell'ultima operation di campagna su un plot (vista dettaglio). */
export interface LastOperation {
  plot_id: string;
  operation_type: OperationType;
  /** ISO della data di esecuzione (`executed_at`). */
  executed_at: string;
  product_name: string | null;
  /** Etichetta pronta per la UI: "[Operazione] - [Data]". */
  etichetta: string;
}

export type OperationType =
  | "phytosanitary"
  | "fertilization"
  | "irrigation"
  | "tillage"
  | "sowing"
  | "harvest"
  | "sampling";

export type DoseUnit = "kg/ha" | "l/ha" | "kg/hl" | "l/hl" | "g/hl" | "m3";

/** Registro operazioni del Quaderno di Campagna (`treatment_logs`). */
export interface TreatmentLog {
  id: string;
  tenant_id: string;
  company_id: string;
  plot_id: string | null;
  /** Aggancio allo stato di Campagna Agraria del field (FK plots_campaign). */
  plot_campaign_id: string | null;
  operation_type: OperationType;
  product_name: string | null;
  registration_number: string | null;
  dose_value: number | null;
  dose_unit: DoseUnit | null;
  /** dose × area plot, congelata al momento della registrazione. */
  total_quantity: number | null;
  /** Avversità/patogeno bersaglio (ex avversita_target). */
  target_disease: string | null;
  /** Operatore che ha eseguito l'operazione (ex operatore). */
  operator_name: string | null;
  /** Macchina/attrezzatura impiegata (ex mezzo). */
  machinery_equipment: string | null;
  /** Sostanza attiva del fitofarmaco (ex sostanza_attiva). */
  active_substance: string | null;
  /** Volume totale di acqua della botte, in litri (ex acqua_volume_l). */
  water_volume_l: number | null;
  /** Codice fiscale dell'operatore (ex operatore_cf). */
  operator_tax_code: string | null;
  /** Numero del certificato di abilitazione/patentino (ex num_patentino). */
  license_number: string | null;
  /** Tipo di concime (ex tipo_concime). */
  fertilizer_type: string | null;
  /** Titolo N-P-K del concime (ex titolo_npk). */
  npk_ratio: string | null;
  executed_at: string;
  reentry_interval_h: number | null;
  /** Tempo di carenza in giorni (ex carenza_giorni). */
  safety_period_days: number | null;
  /** Condizioni meteo al momento dell'operazione (ex meteo). */
  weather_conditions: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Metrica di stazione meteo (`weather_readings`, Smart IoT / agrometeo). */
export interface WeatherReading {
  id: string;
  tenant_id: string;
  company_id: string;
  station_id: string;
  measured_at: string;
  air_temperature: number | null;
  relative_humidity: number | null;
  rain_mm: number | null;
  leaf_wetness: number | null;
  solar_radiation: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Configurazione meteo & cache DSS (Modulo Meteo, tabelle local-only)
// ---------------------------------------------------------------------------

/** Sorgente dei dati meteo configurata per l'azienda. */
export type WeatherDataSource = "public_api" | "private_station";

/** Metriche meteo che l'utente può scegliere di mostrare a schermo. */
export type WeatherVariable =
  | "temperature"
  | "humidity"
  | "rain"
  | "radiation"
  | "leaf_wetness"
  | "wind";

/**
 * Configurazione della fonte meteo dell'azienda (`weather_config`). Tabella
 * LOCAL-ONLY: non si sincronizza (contiene la `station_api_key`).
 */
export interface CompanyWeatherConfig {
  company_id: string;
  tenant_id: string;
  data_source: WeatherDataSource;
  api_provider: string | null;
  station_model: string | null;
  station_api_key: string | null;
  station_device_id: string | null;
  /** Variabili meteo abilitate nella UI. */
  visible_variables: WeatherVariable[];
  /** Lucchetto orario del WeatherSyncService: ultimo pull riuscito. */
  last_weather_pull_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Livello di rischio sintetico di un DSS (cache `dss_results`). */
export type DssRiskLevel = "low" | "medium" | "high";

/** Riga di cache di un indice DSS calcolato in locale (`dss_results`). */
export interface DssResult {
  id: string;
  plot_id: string | null;
  model_name: string;
  risk_level: DssRiskLevel;
  output_value: number;
  calculated_at: string;
}

/**
 * Riga giornaliera del bilancio idrico FAO 56/66 (`soil_water_indices`).
 * LOCAL-ONLY: ricomputabile dalle readings meteo e dai log irrigui.
 */
export interface SoilWaterIndex {
  id: string;
  plot_campaign_id: string | null;
  /** Giorno di riferimento (ISO "YYYY-MM-DD"). */
  date: string;
  /** Evapotraspirazione di riferimento ET0 (mm). */
  et0: number;
  /** Evapotraspirazione colturale ETc (mm). */
  etc: number;
  rain_mm: number;
  irrigation_mm: number;
  /** Percolazione profonda DP del giorno (mm). */
  deep_percolation_mm: number;
  /** Deplezione radicale Dr,t (mm). */
  depletion_mm: number;
  /** Acqua facilmente available RAW (mm). */
  raw_mm: number;
  /** Acqua available totale AWC (mm). */
  awc_mm: number;
  /** true se Dr,t ≥ RAW. */
  water_stress: boolean;
  calculated_at: string;
}

/** Evento di harvest (`harvest_logs`, Modulo Harvest). */
export interface Harvest {
  id: string;
  tenant_id: string;
  company_id: string;
  plot_id: string | null;
  /** Aggancio allo stato di Campagna Agraria del field (FK plots_campaign). */
  plot_campaign_id: string | null;
  /** Cultivar/varietà harvest (categoria primaria dei grafici). */
  cultivar: string | null;
  /** Destinazione/logistica del product (ex destinazione). */
  destination_logistics: string | null;
  /** Quantità harvest in kg (metrica numerica aggregata: Somma/Media). */
  quantity_kg: number | null;
  harvested_at: string;
  /** Posizione del conferimento; di norma il centroid dell'appezzamento. */
  geometry: import("geojson").Point | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Analisi di laboratorio georeferenziata del soil (`soil_samples`). */
export interface SoilSample {
  id: string;
  tenant_id: string;
  company_id: string;
  plot_id: string | null;
  sampled_at: string;
  sampling_position: import("geojson").Point;
  depth_cm: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  organic_matter: number | null;
  ph: number | null;
  texture: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Infrastruttura aziendale fissa o mobile (`infrastructure_assets`, CAD-GIS). */
export interface InfrastructureAsset {
  id: string;
  tenant_id: string;
  company_id: string;
  asset_type: string;
  category: "fixed" | "mobile";
  name: string | null;
  geometry: import("geojson").Geometry;
  attributes: Record<string, unknown>;
  length_m: number | null;
  area_ha: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Tracciabilità import/export (Modulo Tag I/O)
// ---------------------------------------------------------------------------

/** Verso di un trasferimento dati tracciato. */
export type TransferType = "import" | "export";

/** Formato del file trasferito (mappa spaziale o tabellare). */
export type FileFormat =
  | "csv"
  | "geojson"
  | "isoxml"
  | "shapefile"
  | "gpkg"
  | "kml"
  | "gpx";

/** Voce del registro dei trasferimenti dati (`data_transfer_logs`, LOCAL-ONLY). */
export interface DataTransferLog {
  id: string;
  tenant_id: string;
  operation_type: TransferType;
  file_format: FileFormat;
  file_name: string;
  /** Timestamp ISO del trasferimento. */
  executed_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Cataloghi di stato multiregionali (Modulo 3)
// ---------------------------------------------------------------------------

/** Tipo di voce di catalog ministeriale. */
export type CatalogType = "crop" | "phytosanitary" | "fertilizer" | "variety";

/**
 * Voce dei cataloghi di stato (`product_catalogs`). Reference data LOCAL-ONLY
 * filtrata per `country_code`.
 */
export interface CatalogEntry {
  id: string;
  /** Paese (ISO 3166-1 alpha-2) che governa la disponibilità della voce. */
  country_code: string;
  type: CatalogType;
  /** Codice ministeriale rigido (ex codice). */
  code: string;
  /** Denominazione leggibile da mostrare nei dropdown (ex name). */
  name: string;
  /** Sostanza attiva (per i fitosanitari) (ex sostanza_attiva). */
  active_substance: string | null;
  /** Numero di registrazione nazionale del product (ex numero_registrazione). */
  registration_number: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Magazzino (0.2.0): anagrafica products, lots, issues per attività
// ---------------------------------------------------------------------------

/**
 * Categoria RIGIDA del product di warehouse: determina i campi obbligatori
 * dell'anagrafica (vedi `validateProduct` nel module warehouse). `other` è la
 * categoria residuale (lubrificanti, materiali di consumo) senza campi extra.
 */
export type ProductCategory =
  | "phytosanitary"
  | "fertilizer"
  | "seed"
  | "fuel"
  | "other";

/**
 * Anagrafica product di warehouse (`products`). I campi specifici di categoria
 * sono nullable a schema; l'obbligatorietà per categoria è enforced lato TS:
 * agrofarmaci → {@link Product.registration_number} (registro PAN); concimi →
 * titoli N-P-K; carburante → {@link Product.uma_code} (assegnazione UMA).
 */
export interface Product {
  id: string;
  tenant_id: string;
  company_id: string;
  category: ProductCategory;
  /** Denominazione commerciale. */
  name: string;
  /** Unità di misura della stock (es. "kg", "l"). */
  unit: string;
  /** N. di registrazione ministeriale PAN (obbligatorio per gli agrofarmaci). */
  registration_number: string | null;
  /** Sostanza attiva (agrofarmaci): auto-compila i form del Quaderno. */
  active_substance: string | null;
  /** Titolo N % (obbligatorio per i concimi). */
  npk_n: number | null;
  /** Titolo P % (obbligatorio per i concimi). */
  npk_p: number | null;
  /** Titolo K % (obbligatorio per i concimi). */
  npk_k: number | null;
  /** Codice assegnazione UMA (obbligatorio per il carburante agricolo). */
  uma_code: string | null;
  /** Fornitore abituale (tracciabilità e riordini). */
  supplier: string | null;
  /**
   * CUMP current (Costo Unitario Medio Ponderato): media ponderata mobile
   * sulle giacenze, aggiornata in transazione a ogni carico lot.
   */
  avg_unit_cost: number;
  notes: string | null;
  /**
   * Proprietà estensibili per categoria (JSONB). Chiavi convenzionali:
   * sementi → `species`, `scientific_name`, `variety_name`, `crop_category`
   * ("seminativo"|"orticoltura", alimenta l'auto-assegnazione crop alla
   * semina); agrofarmaci → `safety_period_days`, `reentry_interval_h` (default
   * precompilati nel Quaderno); comune → `min_stock` (soglia di riordino
   * nell'unità del product).
   */
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Lotto di warehouse (`product_lots`): scadenza, stock e costo di carico. */
export interface ProductLot {
  id: string;
  tenant_id: string;
  product_id: string;
  /** Numero lot di produzione. */
  lot_number: string | null;
  /** Data di scadenza (ISO "YYYY-MM-DD"), null se non deperibile. */
  expires_at: string | null;
  /** Quantità caricata all'origine (nell'unità del product). */
  initial_quantity: number;
  /** Giacenza current; il CHECK `>= 0` a DB è la guardia atomica dello issue. */
  quantity_on_hand: number;
  /** Costo unitario di carico (input del CUMP). */
  unit_cost: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Scarico di un lot in un'attività di field (`activity_products`): quantità
 * e costo imputato con CUMP congelato al momento dello issue.
 */
export interface ActivityProduct {
  id: string;
  tenant_id: string;
  treatment_log_id: string;
  product_lot_id: string;
  /** Quantità scaricata (nell'unità del product). */
  quantity: number;
  /** CUMP del product al momento dello issue (congelato). */
  unit_cost: number;
  /** Costo imputato = quantity × unit_cost. */
  total_cost: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Richiesta di issue emessa dal form attività (lot + quantità). */
export interface IssueRequest {
  product_lot_id: string;
  quantity: number;
}

/** Costo vivo dei products imputato a un field (aggregato per il bilancio 0.4.0). */
export interface FieldProductCost {
  /** Plot trattato; null = operazioni "intera azienda". */
  plot_id: string | null;
  total_cost: number;
}

// ---------------------------------------------------------------------------
// Parco macchine (0.3.0): mezzi, attrezzi, contatori, manutenzione, carburante
// ---------------------------------------------------------------------------

/**
 * Stato/disponibilità di un mezzo o attrezzo (`machines.status`/
 * `equipment.status`). Un mezzo non `operational` è segnalato nella selezione
 * del form attività (senza bloccare); i `decommissioned` sono esclusi di default
 * dalle liste di selezione ma restano consultabili nello storico.
 */
export type MachineStatus =
  | "operational"
  | "maintenance"
  | "breakdown"
  | "decommissioned";

/** Categoria di un piano di manutenzione: ordinaria (routine) o straordinaria. */
export type MaintenanceCategory = "routine" | "extraordinary";

/** Criterio di scatto dell'alert di manutenzione: a tempo o a ore di utilizzo. */
export type MaintenanceTriggerType = "time" | "hours";

/**
 * Tipo di documento del mezzo (`machine_documents.type`). Mappa i termini
 * normativi italiani: inspection = revisione macchine agricole, insurance =
 * assicurazione/RCA, road_tax = bollo, certification = collaudo.
 */
export type MachineDocumentType =
  | "inspection"
  | "insurance"
  | "road_tax"
  | "certification"
  | "other";

/**
 * Tipo di rettifica del contaore (`counter_adjustments.type`): lettura iniziale
 * all'inserimento, rettifica manuale, sostituzione motore/reset.
 */
export type CounterAdjustmentType = "initial_reading" | "manual" | "engine_reset";

/**
 * Unità motrice del parco macchine (`machines`, trattori/mietitrebbie…).
 * Tracciata a ORE di lavoro: {@link Machine.hour_counter} è materializzato,
 * incrementato in transazione dalle attività e SETtato dalle rettifiche manuali.
 * I campi `purchase_*`/`useful_life_*`/`residual_value` sono PREDISPOSTI per il
 * costo orario/ammortamento della 0.4.0 (solo struttura, non calcolati qui).
 */
export interface Machine {
  id: string;
  tenant_id: string;
  company_id: string;
  /** Denominazione del mezzo. */
  name: string;
  /** Tipo/categoria (es. "Trattore", "Mietitrebbia"). */
  machine_type: string | null;
  /** Targa. */
  license_plate: string | null;
  /** Numero di telaio. */
  chassis_number: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  /** Contatore ore corrente (materializzato). */
  hour_counter: number;
  status: MachineStatus;
  /** Valore d'acquisto (predisposto 0.4.0). */
  purchase_value: number | null;
  purchase_date: string | null;
  /** Vita utile stimata in ore (predisposto 0.4.0). */
  useful_life_hours: number | null;
  /** Vita utile stimata in anni (predisposto 0.4.0). */
  useful_life_years: number | null;
  residual_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Attrezzo del parco macchine (`equipment`, aratri/botti/seminatrici…). Niente
 * motore proprio: tracciato per USURA ({@link Equipment.usage_counter}) e
 * {@link Equipment.working_width_m} (precompila superfici/VRA nel form attività).
 */
export interface Equipment {
  id: string;
  tenant_id: string;
  company_id: string;
  name: string;
  equipment_type: string | null;
  /** Larghezza di lavoro in metri. */
  working_width_m: number | null;
  /** Indicatore/contatore di usura (accumula le ore d'uso). */
  usage_counter: number;
  status: MachineStatus;
  purchase_value: number | null;
  purchase_date: string | null;
  useful_life_hours: number | null;
  useful_life_years: number | null;
  residual_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Giunzione attività ↔ macchina ↔ attrezzo (`activity_machines`) con le ORE di
 * utilizzo. I riferimenti puntano a record esistenti (nessun testo libero). Il
 * salvataggio incrementa i contatori; modifica/cancellazione li stornano.
 */
export interface ActivityMachine {
  id: string;
  tenant_id: string;
  treatment_log_id: string;
  machine_id: string;
  /** Attrezzo agganciato (opzionale: alcune operazioni usano solo la motrice). */
  equipment_id: string | null;
  /** Ore di utilizzo nell'attività. */
  hours: number;
  operator_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Piano di manutenzione (`maintenance_schedules`), a tempo o a ore. */
export interface MaintenanceSchedule {
  id: string;
  tenant_id: string;
  /** Il piano riguarda una macchina O un attrezzo (uno dei due valorizzato). */
  machine_id: string | null;
  equipment_id: string | null;
  name: string;
  category: MaintenanceCategory;
  trigger_type: MaintenanceTriggerType;
  /** Trigger 'time': intervallo di ricorrenza in giorni. */
  interval_days: number | null;
  /** Trigger 'time': prossima data di scadenza. */
  due_date: string | null;
  /** Trigger 'hours': intervallo di ricorrenza in ore. */
  interval_hours: number | null;
  /** Trigger 'hours': soglia di contaore alla prossima scadenza. */
  due_hours: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Intervento di manutenzione eseguito (`maintenance_logs`). Se
 * {@link MaintenanceLog.product_lot_id} e {@link MaintenanceLog.parts_quantity}
 * sono valorizzati, l'intervento scarica il ricambio dal Magazzino (atomico);
 * altrimenti i ricambi restano in {@link MaintenanceLog.parts} (testo) + costo.
 */
export interface MaintenanceLog {
  id: string;
  tenant_id: string;
  /** Piano riprogrammato da questo intervento (null se straordinario una tantum). */
  schedule_id: string | null;
  machine_id: string | null;
  equipment_id: string | null;
  performed_at: string;
  /** Ore/km del mezzo al momento dell'intervento. */
  counter_hours: number | null;
  description: string | null;
  cost: number | null;
  /** Ricambi come testo libero (fallback senza scarico magazzino). */
  parts: string | null;
  /** Lotto di ricambio scaricato dal Magazzino (opz., scarico atomico). */
  product_lot_id: string | null;
  parts_quantity: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Documento/scadenza di un mezzo (`machine_documents`). */
export interface MachineDocument {
  id: string;
  tenant_id: string;
  machine_id: string | null;
  equipment_id: string | null;
  type: MachineDocumentType;
  /** Numero/riferimento del documento. */
  reference: string | null;
  issued_at: string | null;
  /** Data di scadenza: base dell'alert a soglia e del semaforo. */
  expires_at: string;
  /** Ente/compagnia emittente. */
  issuer: string | null;
  amount: number | null;
  /** Percorso dell'allegato locale (opzionale, 100% offline). */
  attachment_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Rettifica del contaore (`counter_adjustments`, audit trail). */
export interface CounterAdjustment {
  id: string;
  tenant_id: string;
  machine_id: string | null;
  equipment_id: string | null;
  type: CounterAdjustmentType;
  previous_value: number | null;
  new_value: number;
  adjusted_at: string;
  reason: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Rifornimento carburante (`fuel_refills`). Scarica un lot `carburante`
 * (cisterna) dal Magazzino con blocco atomico; tracciato per mezzo con
 * litri/data/contaore/UMA. {@link FuelRefill.full_tank} distingue il pieno
 * (pieno-a-pieno) dal rifornimento parziale per il calcolo del consumo l/h.
 */
export interface FuelRefill {
  id: string;
  tenant_id: string;
  machine_id: string;
  product_lot_id: string;
  liters: number;
  refueled_at: string;
  /** Lettura contaore al rifornimento (opz. ma consigliata per il consumo l/h). */
  counter_hours: number | null;
  operator_name: string | null;
  /** Riferimento assegnazione UMA (derivato dal product carburante). */
  uma_code: string | null;
  full_tank: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Richiesta di aggancio mezzo emessa dal form attività: motrice obbligatoria,
 * attrezzo e ore opzionali. Il DAL crea la giunzione `activity_machines` e
 * incrementa i contatori nella stessa transazione dell'attività.
 */
export interface MachineUsageRequest {
  machine_id: string;
  equipment_id?: string | null;
  hours: number;
  operator_name?: string | null;
}

/** Consumo carburante derivato di un mezzo (l/h) e rilevazione anomalie (§5.6). */
export interface FuelConsumption {
  machine_id: string;
  /** Consumo medio l/h sulla storia del mezzo (null se non calcolabile). */
  avg_liters_per_hour: number | null;
  /** Consumo dell'ultimo intervallo pieno-a-pieno (null se non calcolabile). */
  last_liters_per_hour: number | null;
  /** Numero di intervalli pieno-a-pieno validi usati nel calcolo. */
  sample_count: number;
  /** true se l'ultimo intervallo si discosta oltre soglia dalla media storica. */
  anomaly: boolean;
}

/** Categoria di voce del cruscotto "Richiede attenzione" (§5.8). */
export type AttentionKind =
  | "maintenance_due"
  | "maintenance_overdue"
  | "document_expiring"
  | "document_expired"
  | "fuel_anomaly"
  | "machine_down";

/** Voce actionable del cruscotto "Richiede attenzione", cliccabile al dettaglio. */
export interface MachineAttentionItem {
  kind: AttentionKind;
  machine_id: string | null;
  equipment_id: string | null;
  /** Etichetta del mezzo/attrezzo interessato. */
  subject: string;
  /** Dettaglio pronto per la UI (già tradotto/formattato dal chiamante o grezzo). */
  detail: string;
  /** Riferimento all'entità di origine (schedule/document) per la navigazione. */
  ref_id: string | null;
}

// ---------------------------------------------------------------------------
// Multiutente — posti collaboratore per company (`tenant_memberships`)
// ---------------------------------------------------------------------------

/** Ruolo di un membro all'interno di una singola company. */
export type MemberRole = "OWNER" | "MANAGER" | "VIEWER";

/** Stato del posto: un invito pendente occupa il posto quanto un membro active. */
export type MembershipStatus = "active" | "invited" | "revoked";

/**
 * Appartenenza al team di un'azienda (`tenant_memberships`). Sincronizzata via
 * outbox. Mappa terminologica: la "singola azienda" della specifica multiutente
 * è `company_id` (row di `companies`); il `tenant_id` è il workspace
 * dell'abbonato master. I limiti per ruolo/piano sono enforced lato client
 * (module `subscription-limits`/`MembershipGuard` della field-suite).
 */
export interface TenantMembership {
  id: string;
  tenant_id: string;
  company_id: string;
  email: string;
  role: MemberRole;
  status: MembershipStatus;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Outbox / sync
// ---------------------------------------------------------------------------

export type SyncTable =
  | "companies"
  | "crops"
  | "plots_registry"
  | "plots_campaign"
  | "treatment_logs"
  | "weather_readings"
  | "soil_samples"
  | "infrastructure_assets"
  | "harvest_logs"
  | "scouting_observations"
  | "tenant_memberships"
  | "products"
  | "product_lots"
  | "activity_products"
  | "machines"
  | "equipment"
  | "activity_machines"
  | "maintenance_schedules"
  | "maintenance_logs"
  | "machine_documents"
  | "counter_adjustments"
  | "fuel_refills";

export type MutationOperation = "insert" | "update" | "delete";

export type MutationSyncStatus = "pending" | "in_flight" | "synced" | "error";

/** Una voce della coda transazionale locale (tabella `sync_outbox`). */
export interface OutboxMutation {
  mutation_id: string;
  table_name: SyncTable;
  row_id: string;
  operation: MutationOperation;
  /** Riga completa serializzata, come accettata da `agro_apply_mutations`. */
  payload: Record<string, unknown> | null;
  /** Timestamp client ad alta precisione: base della risoluzione LWW. */
  mutated_at: string;
  device_id: string;
  sync_status: MutationSyncStatus;
  attempts: number;
  last_error: string | null;
}

export type SyncConnectionState = "offline" | "online" | "syncing" | "error";

export interface SyncSnapshot {
  state: SyncConnectionState;
  pendingCount: number;
  lastSyncedAt: string | null;
  /** Ultimo pull riuscito dal data plane remoto (idratazione del locale). */
  lastPulledAt: string | null;
  lastError: string | null;
  /** Dove sta riversando i dati: 'cloud' | 'on_premise' | 'local'. */
  target: StorageConfig["kind"] | null;
}

/** Esito di un drain dell'outbox verso il data plane. */
export interface SyncPushResult {
  applied: number;
  skipped_lww: number;
  duplicates: number;
}

// ---------------------------------------------------------------------------
// UI condivisa
// ---------------------------------------------------------------------------

export type PanelMode = "floating" | "docked";

export type FieldPanel =
  | "quaderno"
  | "raccolta"
  | "magazzino"
  | "geoeditor"
  | "registro"
  | "ndvi"
  | "coltura"
  | "coltura-dss"
  | "acqua"
  | "vra"
  | "stampa"
  | "dss"
  | "layers"
  | "sync"
  | "account"
  | "anagrafica"
  | "impostazioni"
  | "geocompliance"
  | "profile"
  | "scouting";

/** Rilievo GPS in field, sincronizzato via outbox come le altre tabelle. */
export interface ScoutingObservation {
  id: string;
  tenant_id: string;
  company_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  note: string | null;
  capture_count: number | null;
  observation_date: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type PlotsFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  {
    id: string;
    user_plot_name: string;
    area_ha: number;
    last_ndvi_mean: number | null;
    /**
     * CropType associata nella Campagna Agraria attiva (`plots_campaign` →
     * `crops`), pronta per il tooltip hover. `null` se l'appezzamento non ha una
     * crop associata per l'annata current.
     */
    crop: string | null;
    /**
     * Specie (name comune, senza varietà) della crop associata: chiave per la
     * mappatura colore/icona (`cropStyle`). `null` se senza crop.
     */
    crop_kind: string | null;
    /**
     * Colore di riempimento per-feature (simplestyle-spec `fill`): grigio neutro
     * se l'appezzamento non ha crop, colore ad hoc della specie altrimenti.
     * Onorato dal renderer quando `simpleStyleEnabled` è active sul layer.
     */
    fill: string;
    /** Colore del bordo per-feature (simplestyle-spec `stroke`). */
    stroke: string;
    /**
     * Opacità del riempimento e spessore del bordo per-feature. OBBLIGATORI con
     * `simpleStyleEnabled`: il renderer li legge via `to-number(["get",…], base)`
     * e in MapLibre `to-number(null)` vale 0 (non il fallback) — senza queste
     * proprietà i poligoni sarebbero trasparenti e senza bordo.
     */
    "fill-opacity": number;
    "stroke-width": number;
  }
>;

/**
 * Layer delle harvests: punti (o feature senza geometria) le cui properties
 * alimentano i grafici del Modulo Harvest nella tabella attributi.
 */
export type HarvestsFeatureCollection = FeatureCollection<
  Point,
  {
    id: string;
    plot_id: string | null;
    cultivar: string | null;
    destination_logistics: string | null;
    quantity_kg: number | null;
    harvested_at: string;
  }
>;
