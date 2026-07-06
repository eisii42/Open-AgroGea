# AgroGea — User Manual: from first launch to daily use

> [🇮🇹 Italiano](./manuale.md) · 🇬🇧 English

> **Step-by-step** guide to the Open Source Desktop edition. It starts from the freshly installed app and walks you through the complete workflow:
> **Farm data → Parcels → Crops** and then the use of **all the suite's modules**.
>
> To understand *how* the agronomic modules work at a scientific level (satellite indices, VRA maps, water balance), see the [Technical documentation of the modules](../technical/agronomic-modules.en.md).

---

## Table of contents

1. [Before you start](#1-before-you-start)
2. [How the screen is laid out](#2-how-the-screen-is-laid-out)
3. [The basic workflow (3 steps)](#3-the-basic-workflow-3-steps)
   - [Step 1 — Enter the farm data](#step-1--enter-the-farm-data)
   - [Step 2 — Draw a parcel](#step-2--draw-a-parcel)
   - [Step 3 — Assign the crop to the parcel](#step-3--assign-the-crop-to-the-parcel)
4. [Using the modules](#4-using-the-modules)
   - [4.1 Field Logbook — recording operations](#41-field-logbook--recording-operations)
   - [4.2 Harvest](#42-harvest)
   - [4.3 Soil module — satellite indices (NDVI and others)](#43-soil-module--satellite-indices-ndvi-and-others)
   - [4.4 Variable-rate application maps (VRA)](#44-variable-rate-application-maps-vra)
   - [4.5 Water — Water balance (FAO 56/66)](#45-water--water-balance-fao-5666)
   - [4.6 Crop · DSS — the risk map](#46-crop--dss--the-risk-map)
   - [4.7 Drawing — infrastructure, POI, management and printing](#47-drawing--infrastructure-poi-management-and-printing)
   - [4.8 Add Data — importing your layers](#48-add-data--importing-your-layers)
   - [4.9 Attribute table, Field Calculator and charts](#49-attribute-table-field-calculator-and-charts)
   - [4.10 Data Command Center — the analytics dashboard](#410-data-command-center--the-analytics-dashboard)
   - [4.11 Official exports and backup](#411-official-exports-and-backup)
   - [4.12 Settings: weather, theme, profile](#412-settings-weather-theme-profile)
   - [4.13 Warehouse — products, lots and stock](#413-warehouse--products-lots-and-stock)
5. [Shortcuts and productivity](#5-shortcuts-and-productivity)
6. [The recommended flow of a season](#6-the-recommended-flow-of-a-season)

---

## 1. Before you start

The Open Source Desktop edition works **right away, with no login and no connection**: it opens on **a single local farm** already ready to use. There is nothing to configure to begin — all data lives on your device.

To work at your best, keep two things in mind from the start:

- **The connection is only needed for the satellite map and for updates.** Drawing parcels, the Logbook, calculations and exports run offline. If you're in the field with no network, the orthophoto may not load but everything else works.
- **There is no "save the project".** Every piece of data you enter is written immediately to the local store. There is no "Save all" button: you save form by form.

> **Tip:** the workflow is meant to be followed **in order** the first time (farm → parcels → crops). Once the base data is in, the modules can be used in whatever order you prefer.

---

## 2. How the screen is laid out

The interface is **geocentric**: the map fills the whole screen and every function opens as a **side panel** over the map (which is never reloaded).

**The top bar (header):**

- **AgroGea logo** and, next to it, the **name of the active farm** (shows `-` until you fill it in Step 1).
- **Add Data** — to drag/import external files (see §4.8).
- **Weather card** — today's conditions and a 4-day forecast.
- **View switcher** — two buttons: **Map** (fieldwork) and **Command Center** (the analytics dashboard, §4.10).
- On the right: **status LED** (in the local edition data always stays on the device), **theme selector** (Light / Dark / Green), **Help menu** (`?`) and **profile menu**.

**The module sidebar:**

It opens from the **handle** on the edge of the map and gathers all the tools, grouped into expandable modules:

| Module | Tools |
|---|---|
| **Soil** | Index analysis (NDVI…), VRA maps |
| **Crop** | Crop data, DSS models |
| **Water** | Water balance |
| **Drawing** | Draw parcel, Draw infrastructure, Draw POI, Manage, Print |
| **Logbook (QDC)** | Operations, Harvest, SIAN export |
| **Settings** | Farm registry, Weather |

Clicking a tool opens the corresponding panel; clicking it again closes it.

**The season (Agrarian Campaign):** many modules work on a **campaign year**. You set it inside the Crop module with the **− / +** buttons next to the year: it is the shared temporal context (crops, DSS, exports).

---

## 3. The basic workflow (3 steps)

This is the heart of the manual: the three steps that turn the empty app into a mapped farm ready for analysis.

### Step 1 — Enter the farm data

First we give the farm an identity: it will be used to head the registers and to choose the **correct export format based on the country**.

1. Open the sidebar → **Settings** module → **Farm registry** (building icon 🏢).
2. The panel is divided into **four sections**, selectable from the left-hand column:
   - **Identity** — Business name, legal form, national farm code, VAT number.
   - **Codes** — SDI code, PEC, Farm Dossier ID, Paying Agency.
   - **Location** — Address, ZIP, Municipality, Province, Region, **Country**, email.
   - **Contact** — Name and role of the farm contact.
3. Fill in the fields you need (the **Business name** is the recommended minimum: it will appear in the header).
4. Press **Save**.

> **Why the Country matters:** it determines the proposed national catalogs (species, varieties, products) and the format of the official registers. For example, with `Italy` you get the **SIAN/PAN** export; with `Spain` the **SIEX/CUE**. You can still change it later.

From this moment the farm name appears in the top bar: you are ready to map the territory.

### Step 2 — Draw a parcel

A **parcel** is the physical cultivated plot, defined by a geometry on the map. You draw it directly on the orthophoto.

1. (Recommended) Activate the **Satellite** basemap to see the terrain: use the **basemap switch** on the map. In Italy you can also overlay the **Cadastre** layer to align with cadastral parcels.
2. Open the sidebar → **Drawing** module → **Draw parcel**.
3. On the map, **click vertex after vertex** to trace the field perimeter; **double-click** (or close on the first vertex) to finish the polygon.
4. As soon as you close the shape, the **data card of the new parcel** opens automatically:
   - The **geodetic area** (ha) is already computed and shown read-only.
   - **Parcel name** — give it a recognizable name (e.g., "Upper vineyard", "West arable").
   - **Irrigation type** — optional (e.g., drip, sprinkler).
5. Press **Save**: the parcel enters the local store and appears colored on the map.

**Editing an already-created parcel:** click the field on the map to open its **detail card**. From here you can:

- rename it or change the irrigation;
- press **Edit geometry** to drag the vertices (the area is recomputed on save);
- enter the **Soil composition** (textural class or sand/silt/clay percentages, organic matter, pH, N-P-K): these are the data that feed the water balance and the DSS;
- delete the element (protected deletion: you must type the exact name).

> Repeat Step 2 for all the farm's fields. You don't have to do them all at once: you can add more at any time.

### Step 3 — Assign the crop to the parcel

Every parcel carries a **crop per season**. This is the data that "switches on" the agronomic modules: without a crop, the DSS and water balance don't know which crop coefficient to use.

1. Open the sidebar → **Crop** module → **Crop data**.
2. At the top choose the **season** (Agrarian Campaign) with **− / +**.
3. Select the **parcel** from the dropdown (it shows the name and any crop already present).
4. (If available) Use the **quick-pick from the national register** to choose the species: it automatically fills common name, scientific name and ministerial code.
5. Choose the **crop type** from the tiles: **Vine, Olive, Orchard, Arable, Horticulture**. Each type shows the relevant supply-chain fields:
   - *Perennials* (vine/olive/orchard): variety, clone, rootstock, planting layout, planting year…
   - *Annuals* (arable/horticulture): variety, cycle, and the **sowing/transplant date** (which you read from the Logbook).
6. Fill in the **species identity** (common name required; variety and scientific name recommended) and the **supply-chain fields**.
7. In the **Campaign declaration data** section indicate the **declared area** (pre-set to the geodetic area) and, if you have them, the parcel/crop codes for the Dossier.
8. Press **Save crop**.

> **Copy from the previous year:** if you record a new season on a perennial parcel that already had a crop, the form **pre-fills** the values from the last available year (still creating new rows for the season, without touching the history). You just need to review and save.

Done: you have a farm with its fields and their respective crops. **All the following modules now work.**

---

## 4. Using the modules

From here on the order is free: use the module you need. Many panels share the same logic — **you select one or more parcels** and launch the calculation.

### 4.1 Field Logbook — recording operations

The Logbook gathers the **traceability** of everything you do in the field, compliant with **PAN/SIAN** rules.

1. Open the sidebar → **Logbook (QDC)** → **Operations**.
2. Press **＋ Record operation** and choose the **type**:
   - **Crop-protection treatment** — product and registration number, active substance, target pest, dose and unit (kg/ha, l/ha, kg/hl…), operator and license, re-entry interval, **pre-harvest interval**.
   - **Fertilization** — fertilizer type, **N-P-K** grade (format `n-n-n`), quantity.
   - **Irrigation** — volume/duration (also feeds the water balance).
   - **Tillage** — mechanical operations on the soil.
   - **Sowing / Transplant** — the date that acts as the reference for annual crops and for the phenological models.
   - **Soil sampling** — georeferenced analysis (pH, organic matter, N-P-K), saved as a point on the map.
3. Select the **parcel**, fill the fields and **save**. With crop-protection and fertilizations AgroGea runs the **PAN validation**: it clearly flags missing mandatory fields.

**Reviewing and filtering:** the list filters by **date range** and by **parcel**. You can also turn on **Show on map** to project the filtered operations as georeferenced symbols. Click an entry to see its detail; the trash bin deletes it (with confirmation).

> **Shortcut from the field:** click a parcel on the map and open the Logbook **already filtered** on that field — recording a new operation stays one tap away.

### 4.2 Harvest

To record deliveries and feed the yield analyses:

1. Sidebar → **Logbook (QDC)** → **Harvest**.
2. For each harvest indicate **parcel, cultivar, quantity (kg), destination/logistics and date**. The harvest is tied to the field's Agrarian Campaign.

This data becomes the yield charts in the Command Center and in the attribute table (§4.9–4.10).

### 4.3 Soil module — satellite indices (NDVI and others)

Computes vegetative vigor from satellite imagery (Sentinel-2 via STAC).

1. Sidebar → **Soil** → **Index analysis**.
2. Tick the **indices** to compute: **NDVI, NDRE, MSAVI2, SAVI, NDWI**. Mark one of them as the **overlay** (that will be the one colored on the map).
3. Select **one or more parcels**.
4. Adjust the **cloud cover** filter (% slider) and the **temporal strategy**: latest image, last 15/30 days, or a **custom range** (max 60 days, with a trend chart).
5. Press **Compute**. You get the most recent averages per parcel/index, the **raster overlay** on the map and — if you have a series with multiple dates — the trend chart.

At the bottom of the panel you also find the **NDVI ↔ soil chemistry scatter** (pH, organic matter, N-P-K), with the correlation coefficient: useful to see whether vigor follows fertility.

### 4.4 Variable-rate application maps (VRA)

Generates variable-dose prescriptions for tractor terminals.

1. Sidebar → **Soil** → **VRA maps**.
2. Choose **parcel**, **base index** (e.g., NDVI), **operation type** (top-dressing, fertilization, treatment, sowing, irrigation).
3. Set the **number of zones** (2 to 5) and the cell **resolution**; assign the **rate** (quantity) of each zone.
4. **Generate**: the map is zoned via K-means. Then **export** it for the field terminals (**ISO-XML** / **GeoJSON**).

### 4.5 Water — Water balance (FAO 56/66)

Computes the water requirement day by day and tells you when the field enters stress.

1. Sidebar → **Water** → **Water balance**.
2. Select **one or more parcels** (they must have an assigned **crop**: the crop coefficient Kc is required).
3. (Optional) If you have imported a **soil map** via Add Data, you can indicate it as the source of the hydro-pedological parameters.
4. Press **Compute balance**. For each field you get:
   - the **root-zone depletion Dr** relative to the **RAW** threshold, the available water (AWC), the mm irrigated in the period and the **days of autonomy**;
   - the **water status** (adequate / in stress);
   - a chart with depletion, rainfall and irrigations of the last ~75 days;
   - the **export of the moisture history** (GeoJSON / Shapefile / CSV).
5. Turn on **Show risk on map** for the choropleth overlay.

> The quality of the calculation improves with the data you provide: the parcel's **soil composition** (Step 2), **samplings** and **irrigations** recorded in the Logbook.

### 4.6 Crop · DSS — the risk map

The Decision Support System synthesizes water stress, phytopathological risk, vigor (NDVI) and fertility into a **colored score** per field.

1. Sidebar → **Crop** → **DSS models**.
2. Tick the **parcels** (they must have a crop with a vertical module: vine/olive/orchard/cereals/horticulture).
3. Press **Compute models**. Each field receives a **risk card**:
   - 🟢 **Green** — optimal;
   - 🟡 **Yellow** — alert, to be monitored;
   - 🔴 **Red** — critical, intervention recommended.

The weights are calibrated per crop (tree crops weight vigor and diseases more, arable crops weight water stress more).

### 4.7 Drawing — infrastructure, POI, management and printing

Beyond parcels, the **Drawing** module manages the rest of the territorial elements:

- **Draw infrastructure** (line) — pipelines, fences, anti-hail nets, roads. On closing you enter type, name and status; the **length** is computed.
- **Draw POI** (point) — wells, traps, IoT sensors, gates, buildings.
- **Manage** — opens the **geometry registry**: exit drawing mode and a tap on the map **selects** elements to edit or delete them.
- **Print** — open the **print composer** to generate a laid-out map of the farm (e.g., for technicians, consortia, authorities).

### 4.8 Add Data — importing your layers

To bring external data onto the map:

1. Header → **Add Data** (or **drag** the file into the window).
2. Supported formats: **Shapefile** (with `.dbf`/`.shx`/`.prj`), **GeoJSON**, **OSM** extracts, **GeoParquet**.
3. The file is loaded into the local analysis engine and shown as a new overlayable layer (also useful as a **soil map** for the water balance, §4.5).

You can also activate the **"Esri Wayback" historical timeline** to compare the same land across different epochs.

### 4.9 Attribute table, Field Calculator and charts

The built-in **attribute table** turns your data into an analyzable sheet. The available tables are **Harvests**, **Operations register** and **Parcels**.

- **Charts Panel** — generates charts on the fly (bars on yield by variety, histograms of NDVI vigor…).
- **Field Calculator** — derives new fields with ready formulas (clickable chips):
  - **Plant density** = `plant_count / area_ha`
  - **Yield (t/ha)** = `(yield_kg / 1000) / area_ha`
  - **Max organic N (NVZ)** = `area_ha × 170`

  It only adds **new** fields: the original data stays intact.
- The table can be **detached to a separate window** (second screen).

### 4.10 Data Command Center — the analytics dashboard

From the **Command Center** button in the header you switch from the map to the **dashboard**: farm KPIs, operations calendar, customizable dashboards and a management report. It is the overview of everything you have recorded.

### 4.11 Official exports and backup

**Registers for inspections** — AgroGea chooses the format based on the farm's **Country**:

- **Italy — SIAN/PAN:** from **Logbook (QDC) → SIAN export**. CSV optimized for Italian Excel (separator `;`, UTF-8 BOM), with ministerial Island/Parcel codes.
- **Spain — SIEX/CUE:** *Cuaderno Digital* in JSON (FEGA).
- **Other EU countries / France:** international CSV (separator `,`, ISO dates).

**SIAN Dossier import** — you can import the Farm Dossier: AgroGea creates the missing parcels from the geometries, normalizes the crops and populates the season's Campaign, recognizing already-present fields without duplicates.

**Geometry export** — parcels and layers in **GeoJSON, KML, GPX, CSV, Shapefile**.

**Full backup** — a snapshot of the entire farm (registry, parcels, crops, Logbook, harvests, infrastructure) in a single **Extended GeoJSON** file, plus the related **import/restore**.

> Every import/export is logged in a local **transfer journal**: you always have the history of what came in and out.

### 4.12 Settings: weather, theme, profile

- **Weather** (Settings → Weather) — configure the weather station/source that feeds the water balance and the DSS.
- **Theme** — Light / Dark / Green, from the selector in the header.
- **Profile** — from the user menu top-right: app preferences and settings.

### 4.13 Warehouse — products, lots and stock

The Warehouse keeps the **product registry** and their **lots** with expiry, stock and cost, and links everything to the logbook activities.

1. Sidebar → **Warehouse** → **Products and lots**.
2. **＋ New product** and pick the **category** (rigid — it determines the required fields):
   - **Plant protection product** — requires the **PAN registration number**;
   - **Fertilizer** — requires the **N-P-K contents** (percentages);
   - **Seed** — only name and unit of measure;
   - **Fuel** — requires the agricultural fuel (**UMA**) allocation code.
3. Open a product and **Load lot**: lot number, **expiry**, quantity and **unit purchase cost**. Every load updates the product's **weighted average cost (WAC/CUMP)** over the current stock.

**Withdrawing from activities:** the logbook form (treatments, fertilizations, sowing) shows a **Warehouse withdrawal** section: pick product → lot → quantity. On save the stock is withdrawn **for real**, in a single transaction with the activity: if the quantity exceeds availability, **the whole registration fails** (no partial withdrawal) with a clear message. The product cost (quantity × WAC at withdrawal time) is **charged to the treated field** and will feed the field balance.

**Expiry:** **expired** lots are highlighted and their use in activities is **blocked** (not selectable); lots **expiring** within the configurable threshold (default 30 days) raise an alert in the panel.

> **Compatibility:** existing records with free-text products/machinery remain valid; the warehouse withdrawal is optional and coexists with free text until you link a real lot. Deleting an operation with withdrawals **restores** the stock automatically.

---

## 5. Shortcuts and productivity

- **Command Palette** — from the **Help (`?`)** menu open the palette to jump to any action or panel by typing its name.
- **Click on a field** — opens its card; from there you quickly reach the filtered Logbook, detail and edit.
- **Help menu** — Command Palette, list of shortcuts, diagnostics, feedback, updates and information.
- **Automatic updates** — at startup the app checks for new versions and shows a banner with the release notes; no download starts without your consent.

---

## 6. The recommended flow of a season

A practical outline that lines up the modules in the typical order of a campaign:

1. **Setup** (one-off): Farm registry → drawing of all parcels → soil composition where available.
2. **Season start:** set the **season** and assign the **crop** to each parcel (Step 3). Record **sowing/transplant** in the Logbook for annuals.
3. **During the season:**
   - record treatments, fertilizations, irrigations and tillage in the **Logbook**;
   - monitor vigor with **Index analysis** (NDVI…);
   - plan irrigations with the **Water balance** and keep an eye on the **DSS map**;
   - generate **VRA maps** for variable-dose operations.
4. **Harvest:** record deliveries in the **Harvest** module; analyze yields and vigor in the **Attribute table** and **Command Center**.
5. **End of season / inspections:** export the official registers (**SIAN/PAN** or equivalent) and make a full **GeoJSON backup** of the farm.

---

> For the scientific explanation of the modules (satellite indices, VRA, water balance, DSS) see the [Technical documentation of the modules](../technical/agronomic-modules.en.md); for automatic updates the [Desktop Auto-Update](../technical/desktop-auto-update.md) document.
