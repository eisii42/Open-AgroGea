/**
 * DDL del database locale PGlite (data plane offline, un'istanza per tenant).
 *
 * Stesso modello logico del data plane remoto, con tre differenze deliberate:
 *   * niente PostGIS: la geometria resta GeoJSON in `jsonb` (MapLibre e
 *     DuckDB-WASM la consumano nativamente; l'area si calcola con @turf/area nel
 *     DAL, non nel DB locale; la colonna PostGIS `geom` esiste solo lato remoto);
 *   * niente RLS: l'isolamento per tenant è dato dall'istanza PGlite dedicata
 *     (un dataDir per tenant_id), sbloccata da PIN/biometria via Tauri;
 *   * in più la coda transazionale `sync_outbox`, drenata dal sync router al
 *     ritorno della connettività.
 *
 * v12 — RISTRUTTURAZIONE EN + NORMALIZZAZIONE COLTURE (clean rewrite).
 *   * tutte le tabelle e le colonne residue passano a un inglese tecnico
 *     standard (GIS/IACS europeo); l'outbox diventa `sync_outbox`;
 *   * la specie/varietà coltivata è ISOLATA nella nuova tabella `crops`
 *     (proprietà di filiera dentro `crop_metadata` JSONB), referenziata da
 *     `plots_campaign.crop_id`: l'appezzamento fisico (`plots_registry`) non
 *     porta più colonne colturali hardcoded (coltura/varieta/vite_*);
 *   * superficie: un'unica colonna `area_ha NUMERIC(10,4)` (eliminati i
 *     duplicati `superficie_ha`/`area_ettari`), autocompilata dal calcolo
 *     geometrico nel DAL.
 *
 * Clean rewrite: niente blocchi `DO $$` di rename incrementale. Le istanze
 * PGlite di sviluppo pre-v12 vanno ricreate (siamo su feature/agrogea-foundation,
 * pre-release). I CREATE TABLE sono idempotenti (`if not exists`); le ALTER
 * additive coprono l'aggiunta di colonne a istanze v12 già create.
 *
 * v13 — additiva: tabella local-only `soil_water_indices` (output giornaliero
 * del bilancio idrico FAO 56/66, ricomputabile) e formati `kml`/`gpx` nel CHECK
 * di `data_transfer_logs.file_format` (filiera import/export universale).
 *
 * v14 — additiva: tabella `scouting_observations` (rilievi GPS multidispositivo
 * sincronizzati via outbox). Foto via URL dello storage remoto dell'edizione.
 * Formato `gpkg` aggiunto al CHECK di `data_transfer_logs.file_format`.
 * Rimozione tipo operazione `survey` dai CHECK di `treatment_logs`.
 *
 * v15 — additiva: tabella `tenant_memberships` (multiutente: posti collaboratore
 * per azienda — owner/manager/viewer). Sincronizzata via outbox come le altre
 * tabelle di dominio; `tenant_memberships` aggiunta al CHECK di `sync_outbox`.
 *
 * v16 — additiva: Magazzino (0.2.0). Tre tabelle sincronizzate:
 *   * `products` — anagrafica prodotti a categorie RIGIDE (agrofarmaci, concimi,
 *     sementi, carburante) con i campi specifici di categoria e il CUMP corrente
 *     (`avg_unit_cost`, media ponderata mobile aggiornata a ogni carico);
 *   * `product_lots` — lotti con scadenza, giacenza corrente e costo di carico.
 *     Il CHECK `quantity_on_hand >= 0` è la guardia ATOMICA dello scarico: uno
 *     scarico che porterebbe la giacenza sotto zero fa fallire l'intera
 *     transazione (nessuno scarico parziale);
 *   * `activity_products` — giunzione attività (`treatment_logs`) ↔ lotto, con
 *     quantità scaricata e costo imputato (CUMP congelato al momento dello
 *     scarico): è la base del costo colturale per campo (0.4.0).
 *   I campi testo libero di `treatment_logs` (`product_name`,
 *   `machinery_equipment`, …) restano INTATTI come fallback per i record non
 *   collegati a un lotto reale.
 *   Rollback logico v16 (se serve annullare gli effetti): le tre tabelle sono
 *   solo-additive e nessuna colonna esistente è cambiata; basta 1) `delete from
 *   sync_outbox where table_name in ('products','product_lots',
 *   'activity_products')`, 2) `drop table activity_products, product_lots,
 *   products` (in quest'ordine per le FK). I dati pre-v16 non sono toccati.
 */

export const AGRO_LOCAL_SCHEMA_VERSION = 16;

export const AGRO_LOCAL_SCHEMA_SQL = `
create table if not exists agro_meta (
  key   text primary key,
  value text not null
);

-- companies — anagrafica legale/fiscale/agricola dell'azienda (ex aziende).
create table if not exists companies (
  id                  uuid primary key,
  tenant_id           uuid not null,
  business_name       text not null,
  national_company_id text,
  vat_number          text,
  legal_form          varchar(100),
  address             text,
  city                text,
  province            text,
  region              text,
  postal_code         varchar(20),
  country             varchar(2),
  email               varchar(255),
  pec                 varchar(255),
  sdi_code            varchar(20),
  centroid            jsonb,
  certifications      text[] not null default '{}',
  farm_file_id        varchar(100),
  paying_agency       varchar(100),
  contact_name        varchar(255),
  contact_role        varchar(255),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- crops — specie/varietà coltivata, isolata dall'anagrafica fisica. Le
-- proprietà di filiera (clone, sesto d'impianto, portainnesto…) vivono dentro
-- crop_metadata (JSONB dinamico), non come colonne hardcoded.
create table if not exists crops (
  id              uuid primary key,
  tenant_id       uuid not null,
  common_name     text not null,
  scientific_name text,
  variety_name    text,
  crop_metadata   jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Migrazione additiva per istanze v12 già create senza i timestamp di sync
-- (crops è una tabella sincronizzata: serve updated_at per outbox/LWW).
alter table crops add column if not exists created_at timestamptz not null default now();
alter table crops add column if not exists updated_at timestamptz not null default now();
alter table crops add column if not exists deleted_at timestamptz;

create index if not exists crops_tenant_idx on crops (tenant_id);

-- plots_registry — anagrafica FISICA immutabile dell'appezzamento (LPIS). Niente
-- attributi colturali (vivono in crops/plots_campaign) né duplicati di superficie.
create table if not exists plots_registry (
  id               uuid primary key,
  tenant_id        uuid not null,
  company_id       uuid not null references companies (id),
  user_plot_name   text not null,
  cadastral_sheet  text,
  cadastral_parcel text,
  geometry         jsonb not null,
  irrigation_type  text,
  planting_year    smallint,
  -- unico punto di verità per la superficie, ricalcolata dal DAL (@turf/area).
  area_ha          numeric(10, 4) not null,
  -- cache dell'ultimo NDVI medio della pipeline STAC (consultabile offline).
  last_ndvi_mean   numeric,
  historical_notes text,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists plots_registry_company_idx
  on plots_registry (company_id);

-- plots_campaign — stato BUROCRATICO annuale del campo per Campagna Agraria,
-- LPIS/IACS compliant. Associa un appezzamento fisico a una coltura (crops) per
-- una determinata annata; relazione 1:N su (plot_id, campaign_year).
create table if not exists plots_campaign (
  id                              uuid primary key default gen_random_uuid(),
  tenant_id                       uuid not null,
  plot_id                         uuid not null references plots_registry (id) on delete cascade,
  crop_id                         uuid not null references crops (id) on delete restrict,
  campaign_year                   integer not null,
  reference_parcel_external_id    varchar(50),
  agricultural_parcel_external_id varchar(50),
  crop_external_code              varchar(30),
  variety_external_code           varchar(30),
  declared_area_ha                numeric(10, 4) not null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  deleted_at                      timestamptz,
  constraint unique_plot_per_campaign unique (plot_id, campaign_year)
);

create index if not exists plots_campaign_year_idx
  on plots_campaign (tenant_id, campaign_year);
create index if not exists plots_campaign_plot_idx
  on plots_campaign (plot_id, campaign_year);
create index if not exists plots_campaign_crop_idx
  on plots_campaign (crop_id);

-- treatment_logs — registro operazioni del Quaderno di Campagna (unificato:
-- fitosanitari, fertilizzazioni, irrigazioni, lavorazioni, semine, raccolte,
-- campionamenti, rilievi; discriminati da operation_type).
create table if not exists treatment_logs (
  id                  uuid primary key,
  tenant_id           uuid not null,
  company_id          uuid not null references companies (id),
  plot_id             uuid references plots_registry (id),
  plot_campaign_id    uuid references plots_campaign (id),
  operation_type      text not null check (
    operation_type in (
      'phytosanitary', 'fertilization', 'irrigation',
      'tillage', 'sowing', 'harvest', 'sampling', 'survey'
    )
  ),
  product_name        text,
  registration_number text,
  active_substance    text,
  dose_value          double precision,
  dose_unit           text,
  total_quantity      double precision,
  water_volume_l      integer,
  target_disease      text,
  fertilizer_type     text,
  npk_ratio           text,
  operator_name       text,
  operator_tax_code   text,
  license_number      text,
  machinery_equipment text,
  executed_at         timestamptz not null,
  reentry_interval_h  smallint,
  safety_period_days  smallint,
  weather_conditions  jsonb,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists treatment_logs_company_idx
  on treatment_logs (company_id, executed_at desc);

-- weather_readings — metriche orarie/giornaliere di stazione (Smart IoT / agrometeo).
create table if not exists weather_readings (
  id                uuid primary key,
  tenant_id         uuid not null,
  company_id        uuid not null references companies (id),
  station_id        text not null,
  measured_at       timestamptz not null,
  air_temperature   double precision,
  relative_humidity double precision,
  rain_mm           double precision,
  leaf_wetness      double precision,
  solar_radiation   double precision,
  wind_speed        double precision,
  wind_direction    double precision,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists weather_readings_station_idx
  on weather_readings (company_id, station_id, measured_at desc);

-- soil_samples — analisi di laboratorio georeferenziate del suolo.
create table if not exists soil_samples (
  id                uuid primary key,
  tenant_id         uuid not null,
  company_id        uuid not null references companies (id),
  plot_id           uuid references plots_registry (id),
  sampled_at        timestamptz not null,
  sampling_position jsonb not null,
  depth_cm          smallint,
  nitrogen          double precision,
  phosphorus        double precision,
  potassium         double precision,
  organic_matter    double precision,
  ph                double precision,
  texture           text,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists soil_samples_company_idx
  on soil_samples (company_id, sampled_at desc);

-- infrastructure_assets — infrastrutture fisse e mobili dell'azienda (CAD-GIS).
create table if not exists infrastructure_assets (
  id          uuid primary key,
  tenant_id   uuid not null,
  company_id  uuid not null references companies (id),
  asset_type  text not null,
  category    text not null check (category in ('fixed', 'mobile')),
  name        text,
  geometry    jsonb not null,
  attributes  jsonb not null default '{}',
  length_m    double precision,
  area_ha     double precision,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists infrastructure_assets_company_idx
  on infrastructure_assets (company_id, category);

-- harvest_logs — eventi di raccolto/conferimento per appezzamento (Modulo Raccolta).
create table if not exists harvest_logs (
  id                   uuid primary key,
  tenant_id            uuid not null,
  company_id           uuid not null references companies (id),
  plot_id              uuid references plots_registry (id),
  plot_campaign_id     uuid references plots_campaign (id),
  cultivar             text,
  destination_logistics text,
  quantity_kg          double precision,
  harvested_at         timestamptz not null,
  geometry             jsonb,
  notes                text,
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists harvest_logs_company_idx
  on harvest_logs (company_id, harvested_at desc);

-- sync_outbox — coda transazionale locale delle mutazioni di dominio, drenata
-- dal sync router verso il data plane remoto (ex outbox_mutazioni).
create table if not exists sync_outbox (
  mutation_id uuid primary key,
  -- Nessun CHECK enumerato sul nome tabella: i valori sono prodotti SOLO dal DAL
  -- (tipizzati lato TS) e l'enumerazione richiedeva una migrazione fragile a ogni
  -- nuova tabella sincronizzata (un batch di schema interrotto lasciava il vincolo
  -- stantio → violazioni al boot). La validazione vive a valle nel sync target.
  table_name  text not null,
  row_id      uuid not null,
  operation   text not null check (operation in ('insert', 'update', 'delete')),
  payload     jsonb,
  mutated_at  timestamptz not null,
  device_id   text not null,
  sync_status text not null default 'pending' check (
    sync_status in ('pending', 'in_flight', 'synced', 'error')
  ),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now()
);

create index if not exists sync_outbox_pending_idx
  on sync_outbox (sync_status, created_at)
  where sync_status in ('pending', 'error');

-- weather_config — configurazione per-azienda della fonte meteo. Tabella
-- LOCAL-ONLY: non transita dall'outbox (la api_key non lascia il device, ed è
-- stato di installazione). Una riga per azienda.
create table if not exists weather_config (
  company_id           uuid primary key references companies (id) on delete cascade,
  tenant_id            uuid not null,
  data_source          varchar(50) not null default 'public_api'
    check (data_source in ('public_api', 'private_station')),
  api_provider         varchar(50) default 'open-meteo',
  station_model        varchar(100),
  station_api_key      text,
  station_device_id    varchar(100),
  visible_variables    jsonb not null
    default '["temperature", "humidity", "rain"]'::jsonb,
  last_weather_pull_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- dss_results — cache degli indici di rischio calcolati dai DSS. LOCAL-ONLY:
-- interamente ricomputabile dalle letture meteo, non si sincronizza.
create table if not exists dss_results (
  id           uuid primary key default gen_random_uuid(),
  plot_id      uuid references plots_registry (id) on delete cascade,
  model_name   varchar(100) not null,
  risk_level   varchar(20) not null
    check (risk_level in ('low', 'medium', 'high')),
  output_value numeric(8, 2) not null,
  calculated_at timestamptz not null default now()
);

create index if not exists dss_results_plot_idx
  on dss_results (plot_id, calculated_at desc);

-- soil_water_indices — output giornaliero del bilancio idrico FAO 56/66 per
-- campagna del campo. LOCAL-ONLY: interamente ricomputabile dalle letture meteo
-- e dai log irrigui, non si sincronizza (come dss_results).
create table if not exists soil_water_indices (
  id                  uuid primary key default gen_random_uuid(),
  plot_campaign_id    uuid references plots_campaign (id) on delete cascade,
  date                date not null,
  et0                 numeric(8, 3) not null default 0,
  etc                 numeric(8, 3) not null default 0,
  rain_mm             numeric(8, 3) not null default 0,
  irrigation_mm       numeric(8, 3) not null default 0,
  deep_percolation_mm numeric(8, 3) not null default 0,
  depletion_mm        numeric(8, 3) not null default 0,
  raw_mm              numeric(8, 3) not null default 0,
  awc_mm              numeric(8, 3) not null default 0,
  water_stress        boolean not null default false,
  calculated_at       timestamptz not null default now()
);

create index if not exists soil_water_indices_campaign_idx
  on soil_water_indices (plot_campaign_id, date);

-- data_transfer_logs — giornale dei trasferimenti dati (import/export). LOCAL-ONLY.
create table if not exists data_transfer_logs (
  id             uuid primary key,
  tenant_id      uuid not null,
  operation_type text not null check (operation_type in ('import', 'export')),
  file_format    text not null
    check (file_format in ('csv', 'geojson', 'isoxml', 'shapefile', 'kml', 'gpx')),
  file_name      text not null,
  executed_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists data_transfer_logs_tenant_idx
  on data_transfer_logs (tenant_id, executed_at desc);

-- Allinea il CHECK di file_format anche su istanze pre-v13 già create (il
-- vincolo inline non si aggiorna da solo): drop+add idempotente del nome
-- auto-generato da Postgres per il check di colonna.
alter table data_transfer_logs
  drop constraint if exists data_transfer_logs_file_format_check;
alter table data_transfer_logs
  add constraint data_transfer_logs_file_format_check
  check (file_format in ('csv', 'geojson', 'isoxml', 'shapefile', 'gpkg', 'kml', 'gpx'));

-- v14: rimuove 'survey' dal CHECK di treatment_logs (ora gestito da scouting_observations).
alter table treatment_logs
  drop constraint if exists treatment_logs_operation_type_check;
alter table treatment_logs
  add constraint treatment_logs_operation_type_check
  check (operation_type in ('phytosanitary','fertilization','irrigation','tillage','sowing','harvest','sampling'));

-- v14: tabella rilievi GPS multidispositivo.
create table if not exists scouting_observations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  company_id       uuid not null,
  lat              numeric(10,7) not null,
  lng              numeric(10,7) not null,
  accuracy_m       numeric(8,2),
  note             text,
  capture_count    integer,
  observation_date date,
  photo_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists scouting_observations_tenant_idx
  on scouting_observations (tenant_id, company_id, created_at desc);

-- Rimozione del vecchio CHECK enumerato su sync_outbox.table_name (drop
-- idempotente): ripulisce le istanze già create che lo avevano. Il vincolo non
-- viene più ricreato (vedi nota sulla definizione della tabella).
alter table sync_outbox
  drop constraint if exists sync_outbox_table_name_check;

-- tenant_memberships — multiutente: posti collaboratore per singola azienda
-- (company_id). Una riga = un membro (per email) con un ruolo. Sincronizzata via
-- outbox come le altre tabelle di dominio (LWW su updated_at). I limiti per
-- ruolo/piano sono enforced lato client (subscription-limits/MembershipGuard).
create table if not exists tenant_memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  company_id  uuid not null references companies (id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('OWNER', 'MANAGER', 'VIEWER')),
  status      text not null default 'invited'
    check (status in ('active', 'invited', 'revoked')),
  invited_at  timestamptz,
  joined_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint tenant_memberships_company_email_unq unique (company_id, email)
);

create index if not exists tenant_memberships_company_idx
  on tenant_memberships (company_id, role);

-- product_catalogs — cataloghi di stato MULTIREGIONALI (Modulo 3). Reference data
-- LOCAL-ONLY: cataloghi ministeriali per paese filtrati a runtime dal country_code.
create table if not exists product_catalogs (
  id                  uuid primary key default gen_random_uuid(),
  country_code        varchar(2) not null,
  type                varchar(20) not null
    check (type in ('crop', 'phytosanitary', 'fertilizer', 'variety')),
  code                varchar(50) not null,
  name                text not null,
  active_substance    text,
  registration_number text,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint product_catalogs_unq unique (country_code, type, code)
);

create index if not exists product_catalogs_country_idx
  on product_catalogs (country_code, type);

-- v16 — Magazzino (0.2.0) ----------------------------------------------------

-- products — anagrafica prodotti di magazzino a categorie RIGIDE. La categoria
-- determina i campi obbligatori (enforced lato TS in validateProdotto, come
-- la validazione PAN; qui le colonne restano nullable per non irrigidire le
-- migrazioni): agrofarmaci → registration_number (registro PAN); concimi →
-- titoli N-P-K; carburante → codice assegnazione UMA. avg_unit_cost è il
-- CUMP corrente (Costo Unitario Medio Ponderato, media ponderata mobile),
-- aggiornato in transazione a ogni carico lotto.
create table if not exists products (
  id                  uuid primary key,
  tenant_id           uuid not null,
  company_id          uuid not null references companies (id),
  category            text not null check (
    category in ('phytosanitary', 'fertilizer', 'seed', 'fuel', 'other')
  ),
  name                text not null,
  unit                text not null default 'kg',
  registration_number text,
  active_substance    text,
  npk_n               numeric(5, 2),
  npk_p               numeric(5, 2),
  npk_k               numeric(5, 2),
  uma_code            text,
  supplier            text,
  avg_unit_cost       numeric(12, 4) not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- Allineamento additivo per le istanze v16 create prima dell'estensione
-- dell'anagrafica (sostanza attiva per gli agrofarmaci, fornitore comune,
-- categoria residuale 'other' per lubrificanti/materiali di consumo).
alter table products add column if not exists active_substance text;
alter table products add column if not exists supplier text;
alter table products
  drop constraint if exists products_category_check;
alter table products
  add constraint products_category_check
  check (category in ('phytosanitary', 'fertilizer', 'seed', 'fuel', 'other'));

create index if not exists products_company_idx
  on products (company_id, category);

-- product_lots — lotti di magazzino: numero lotto, scadenza, giacenza corrente
-- e costo unitario di carico (input del CUMP). Il CHECK "quantity_on_hand >= 0"
-- è la guardia ATOMICA dello scarico: la transazione che porterebbe la giacenza
-- sotto zero fallisce per intero (nessuno stato parziale/inconsistente).
create table if not exists product_lots (
  id               uuid primary key,
  tenant_id        uuid not null,
  product_id       uuid not null references products (id),
  lot_number       text,
  expires_at       date,
  initial_quantity numeric(12, 3) not null default 0,
  quantity_on_hand numeric(12, 3) not null default 0
    check (quantity_on_hand >= 0),
  unit_cost        numeric(12, 4) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists product_lots_product_idx
  on product_lots (product_id, expires_at);

-- activity_products — giunzione attività ↔ lotto: quantità scaricata e costo
-- imputato, con unit_cost = CUMP del prodotto CONGELATO al momento dello
-- scarico (il CUMP successivo non riscrive la storia). Il costo confluisce sul
-- campo trattato via treatment_logs.plot_id (bilancio di campo 0.4.0).
create table if not exists activity_products (
  id               uuid primary key,
  tenant_id        uuid not null,
  treatment_log_id uuid not null references treatment_logs (id),
  product_lot_id   uuid not null references product_lots (id),
  quantity         numeric(12, 3) not null check (quantity > 0),
  unit_cost        numeric(12, 4) not null default 0,
  total_cost       numeric(14, 4) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists activity_products_treatment_idx
  on activity_products (treatment_log_id);
create index if not exists activity_products_lot_idx
  on activity_products (product_lot_id);
`;
