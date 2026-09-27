# AgroGea — User Manual: from first launch to daily use

> [🇮🇹 Italiano](./manuale.md) · 🇬🇧 English

> **Document version 0.5.0** · updated 27 September 2026 · describes **AgroGea 0.5.0**. If your app shows a different version (**?** menu → *About*), the differences are listed in the [CHANGELOG](../../CHANGELOG.md).
>
> What is new in 0.5.0 and described here: **guided first launch** (§1), **parcels from public sources** (Step 2), **certifications** and **production regime** (Steps 1 and 3), **map zoom limits** and **attention markers** (§2), **raster maps** (§4.8), **selective backup** (§4.12), **multiple georeferenced warehouses** (§4.14) and the **Compliance** module (§4.17).

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
   - [Step 2 — Add the parcels](#step-2--add-the-parcels)
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
   - [4.11 Farm calendar](#411-farm-calendar)
   - [4.12 Official exports and backup](#412-official-exports-and-backup)
   - [4.13 Settings: weather, theme, profile](#413-settings-weather-theme-profile)
   - [4.14 Warehouse — stores, products, lots and stock](#414-warehouse--stores-products-lots-and-stock)
   - [4.15 Machinery — vehicles, maintenance and fuel](#415-machinery--vehicles-maintenance-and-fuel)
   - [4.16 Task planning and Field Mode — the no-typing flow](#416-task-planning-and-field-mode--the-no-typing-flow)
   - [4.17 Compliance — CAP and organic self-assessment](#417-compliance--cap-and-organic-self-assessment)
5. [Shortcuts and productivity](#5-shortcuts-and-productivity)
6. [The recommended flow of a season](#6-the-recommended-flow-of-a-season)

---

## 1. Before you start

AgroGea works **with no login and no connection**: all data lives on your device.

**First launch.** The first time you open the app you get the **Welcome to AgroGea** screen, with two paths:

- **New farm** — only the **farm name** and the **Country** are required; municipality/locality and VAT number are optional (the municipality is only used to frame the map: your fields can be anywhere, including across a border). Press **Start**.
- **Restore from a backup** — choose an AgroGea GeoJSON file (§4.12). Backups from earlier versions are upgraded automatically.

> **Why the Country is asked straight away:** it decides which **official parcel sources** are offered (Step 2), which **Compliance** rules apply (§4.17) and the format of the official registers. AgroGea does not choose it for you. If you are upgrading from an earlier version you will not see this screen: your farm opens as usual.

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
- **View switcher** — three buttons: **Map** (fieldwork), **Calendar** (everything that has a date, §4.11) and **Command Center** (the analytics dashboard, §4.10). All three views stay mounted: switching between them does not reload the map or redo the calculations.
- On the right: **status LED** (in the local edition data always stays on the device), **theme selector** (Light / Dark / Green), **Help menu** (`?`) and **profile menu**.

**The module sidebar:**

It opens from the **handle** on the edge of the map and gathers all the tools, grouped into expandable modules:

| Module | Tools |
|---|---|
| **Soil** | Plot list, Index analysis (NDVI…), VRA maps |
| **Crop** | Crop data, DSS models |
| **Water** | Water balance |
| **Draw element** | **Public parcels**, Plot (polygon), Infrastructure (line), POI (point), Print |
| **Task Planning** | Tasks & Recipes |
| **Field logbook** | Operations, Harvest, SIAN export |
| **Warehouse** | Products and lots (including the **Warehouses** registry), Machinery |
| **Company settings** | Company profile, Weather |
| **Compliance** | Eligibility, Conditionality (GAEC), Eco-schemes, Cross-cutting, Organic, GeoCompliance (binding layers) |

Clicking a tool opens the corresponding panel; clicking it again closes it.

**The map controls** sit in the right-hand column and are the mapping engine's native ones, **translated into the app's language**: zoom **＋ / −**, **compass** (drag to rotate, click to put north back on top — when the map is already facing north the button shows a small **N**), **fullscreen**, **find my location**, **3D terrain**, **ruler** (measure distances and areas, with selectable units), **layer manager** (visibility, opacity, order, style) and **🔍 Search place** for gazetteer search.

> **How far you can zoom.** The field map moves **only between zoom 13 and 17**: below 13 you would be looking at a region, above 17 you oversample orthophoto pixels that do not exist — in between sits every bit of agronomic work, from the district down to the vine row. These are the **absolute bounds**: in Profile settings you can *narrow* the range (e.g. 14–16), never widen it. As a side note, the Esri orthophoto has guaranteed coverage up to zoom 18, so with these limits you never run into empty tiles.

**Symbols on the map.** Besides the parcels coloured by crop, the map shows on its own:

- 🏬 the **warehouse POIs** that have a position (indigo tile, icon per type, badge counting the lots in stock): a tap opens that warehouse's sheet (§4.14);
- **!** a blue dot on fields with **planned work** (scheduled or in-progress tasks): a tap opens the parcel sheet, where those tasks are started;
- **⚠** an amber triangle on fields with **missing data** — soil texture, campaign declaration data (SIAN/SIEX), incomplete logbook rows. The tap takes you straight to where the most urgent one is filled in. It appears **only** where there is genuinely something to fix: a symbol on every field would signal nothing.

**The season (Agrarian Campaign):** many modules work on a **campaign year**. You set it inside the Crop module with the **− / +** buttons next to the year: it is the shared temporal context (crops, DSS, exports).

---

## 3. The basic workflow (3 steps)

This is the heart of the manual: the three steps that turn the empty app into a mapped farm ready for analysis.

### Step 1 — Enter the farm data

You already gave the farm name and Country at first launch (§1). Here you complete the farm's identity: it will be used to head the registers and to choose the **correct export format based on the country**.

1. Open the sidebar → **Settings** module → **Farm registry** (building icon 🏢).
2. The panel is divided into **five sections**, selectable from the left-hand column:
   - **Identity** — Business name, legal form, national farm code, VAT number.
   - **Codes** — SDI code, PEC, Farm Dossier ID, Paying Agency.
   - **Location** — Address, ZIP, Municipality, Province, Region, **Country**, email.
   - **Contact** — Name and role of the farm contact.
   - **Certifications** — for **organic farming**: control body, operator code, certificate number and validity (from/until). This is the **farm's** certification; each parcel's regime is declared per season in the crop sheet (Step 3), and that is what the *Organic* card of the Compliance module reads.
3. Fill in the fields you need (the **Business name** is the recommended minimum: it will appear in the header).
4. Press **Save**.

> **Why the Country matters:** it determines the proposed national catalogs (species, varieties, products) and the format of the official registers. For example, with `Italy` you get the **SIAN/PAN** export; with `Spain` the **SIEX/CUE**. You can still change it later.

From this moment the farm name appears in the top bar: you are ready to map the territory.

### Step 2 — Add the parcels

A **parcel** is the physical cultivated plot, defined by a geometry on the map. There are three ways to add one, fastest first:

- **adopt it from a public source**, if your country publishes its agricultural parcels as open data (below);
- **import the Farm Dossier** (§4.8 and §4.12);
- **draw it by hand** on the orthophoto: the fallback when there is no source, and the way to correct a geometry.

#### Adopting parcels from a public source

Across much of Europe agricultural parcels are already digitised and published by the authorities. Available today: the **Netherlands** (BRP Gewaspercelen, RVO/PDOK) and **France** (RPG, IGN).

1. Open the sidebar → **Draw element** → **Public parcels**.
2. Choose the **Source** (the ones for your farm's Country are offered). The data attribution and licence are shown underneath.
3. Frame the area of your fields and press **Search this area**, or **Click a point** and tap the map over the field. Searching works between **zoom 13 and 17**: if you are too far out or too close, the panel asks you to zoom in or out.
4. The parcels found appear on the map: **hover** one to see its details (identifier, declared area, crop code), **click** it to select it.
5. Read the **unit type** the panel shows: a cadastral parcel or a physical block may hold more than one crop, an agricultural parcel is already a single cropped unit. Better to know it *before* adopting.
6. Give it a **Plot name** and press **Add to the farm**.

Nothing is added until you choose it: parcels are adopted **one at a time**. If a parcel is already in the farm the panel says so instead of duplicating it. Every adopted parcel keeps its **source, year and licence**, which travel with the data into the backup.

> For a country not yet in the catalogue the flow is: draw (or correct) the geometry and type the reference codes in the crop sheet, with your country's generic labels.

#### Drawing a parcel by hand

1. (Recommended) Activate the **Satellite** basemap to see the terrain: use the **basemap switch** on the map. In Italy you can also overlay the **Cadastre** layer to align with cadastral parcels.
2. Open the sidebar → **Draw element** → **Plot (polygon)**.
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
7. In the **Campaign declaration data** section indicate the **declared area** (pre-set to the geodetic area) and, if you have them, the parcel/crop codes for the Dossier. The code labels follow your Country (Island/Parcel in Italy, generic terms where there is no national declaration system).
8. (Optional) Under **Production regime** declare the season's regime (*Conventional*, *In conversion*, *Organic*, *Integrated production*) with the **Under this regime since** date and any notes. It applies to that season: changing it does not rewrite the past. The date is the one from which the 24 months (annual crops) or 36 months (perennials) of organic conversion are counted.
9. Press **Save crop**.

> **Copy from the previous year:** if you record a new season on a perennial parcel that already had a crop, the form **pre-fills** the values from the last available year (still creating new rows for the season, without touching the history). You just need to review and save.

Done: you have a farm with its fields and their respective crops. **All the following modules now work.**

---

## 4. Using the modules

From here on the order is free: use the module you need. Many panels share the same logic — **you select one or more parcels** and launch the calculation.

### 4.1 Field Logbook — recording operations

The Logbook gathers the **traceability** of everything you do in the field, compliant with **PAN/SIAN** rules.

> **Opened from the sidebar it always shows the whole farm.** That is a guarantee, not a coincidence: a compliance register must never silently show the subset of a single parcel left over from an earlier lookup. If you want one field's operations, use the **Parcel** filter inside, or tap the field on the map and open its sheet.

1. Open the sidebar → **Logbook (QDC)** → **Operations**.
2. Press **＋ Record operation** and choose the **type**:
   - **Crop-protection treatment** — product and registration number, active substance, target pest, dose and unit (kg/ha, l/ha, kg/hl…), operator and license, re-entry interval, **pre-harvest interval**.
   - **Fertilization** — fertilizer type, **N-P-K** grade (format `n-n-n`), quantity.
   - **Irrigation** — volume/duration (also feeds the water balance).
   - **Tillage** — mechanical operations on the soil.
   - **Sowing / Transplant** — the date that acts as the reference for annual crops and for the phenological models.
   - **Soil sampling** — georeferenced analysis (pH, organic matter, N-P-K), saved as a point on the map.
3. Select the **parcel**, fill the fields and **save**. With crop-protection and fertilizations AgroGea runs the **PAN validation**: it clearly flags missing mandatory fields.

**Warehouse withdrawal (0.2.0):** for treatments, fertilizations and sowing, a dedicated section withdraws real lots. The quantity **automatically follows** the total computed from the dose; if you edit it manually you see the **effective dose** and any deviation. The lot is preselected in **FEFO** order (nearest expiry), expired lots are blocked and, if one lot is not enough, one click **splits the withdrawal across lots**. Picking the product prefills registration number, active substance and — if set in the registry — default PHI and re-entry.

**Smart sowing:** sowing a **warehouse seed** on a field without a crop, the operation offers to **automatically assign the crop to the field** (crop sheet + campaign, density derived from the dose). Declaratory data (SIAN codes) still needs completing in Crop data.

**Reviewing and filtering:** the list filters by **date range** and by **parcel**. You can also turn on **Show on map** to project the filtered operations as georeferenced symbols. Click an entry to see its detail; the trash bin deletes it (with confirmation); the **copy** icon repeats it with a prefilled form dated today (operator and license are remembered between operations).

> **Shortcut from the field:** click a parcel on the map to open its **sheet** (§4.16) — the operations already recorded on that field are there, together with the planned tasks, and from there you open the Logbook or start the job.

### 4.2 Harvest

To record deliveries and feed the yield analyses:

1. Sidebar → **Logbook (QDC)** → **Harvest**.
2. For each harvest indicate **parcel, cultivar, quantity (kg), destination/logistics and date**. The cultivar prefills from the field's campaign crop; the harvest is tied to the **open** Agrarian Campaign.

**Closing the crop cycle:** for **annual** crops (arable/horticulture) the harvest offers — pre-ticked — to **close the campaign**: the field becomes free again (neutral map, DSS off) and a new sowing can start even in the same year (second harvest). Perennials stay open.

**SIAN/SIEX compliance:** if the field's campaign has incomplete declaratory data (crop code, reference parcel/SIGPAC, agricultural parcel/recinto), the form flags it with a banner and a "SIAN ✗" badge (or "SIEX ✗" in Spain) in the selector: you can **complete it right away** from Crop data or save anyway with an explicit tick.

This data becomes the yield charts in the Command Center and in the attribute table (§4.9–4.10).

### 4.3 Soil module — satellite indices (NDVI and others)

Computes vegetative vigor from satellite imagery (Sentinel-2 via STAC).

1. Sidebar → **Soil** → **Index analysis**.
2. Tick the **indices** to compute: **NDVI** (vigor), **NDRE** (nitrogen status), **MSAVI2** and **SAVI** (soil-adjusted), **NDWI** (open water) and **NDMI** (crop moisture, the water-stress indicator). Mark one of them as the **primary index**: that is the one colored on the map.
3. Select **one or more parcels**.
4. Adjust the **cloud cover** filter (% slider) and the **temporal strategy**: latest image, last 15/30 days, or a **custom range** (max 60 days, with a trend chart).
5. Press **Compute**. You get the most recent averages per parcel/index, the **grid of colored cells** on the map and — if you have a series with multiple dates — the trend chart.

> **The color scale is relative to the field, not absolute.** Colors are spread over the values actually present in the computed fields (discarding 2% at each end), not over the theoretical −1..1 range. That is what makes the variability *inside* the parcel emerge — the very thing VRA zoning needs — instead of a uniformly green blob. The absolute value stays readable in the colorbar and in the panel's averages.

At the bottom of the panel you also find the **NDVI ↔ soil chemistry scatter** (pH, organic matter, N-P-K), with the correlation coefficient: useful to see whether vigor follows fertility.

**Time slider — browsing dates on the map.** After a computation a **time bar** appears at the bottom of the map with every satellite scene available for the selected parcel: move from one date to another and the map redraws, or press **▶** to run the series as an animation. It stays usable even with the Soil panel closed; the **Show / Hide time slider** button at the bottom of the panel makes it disappear and come back.

- Every scene shows its **cloud cover** and whether it is **already computed** (cached, instant redraw) or **to be computed** (processed on the fly when you move onto it).
- On the same day the satellite may deposit several images: AgroGea keeps **the least cloudy one** and hides the others as *duplicates of the day*, shown with one click if you want to compare them.
- If a scene is no longer processable (assets expired on the satellite side) it says so, and re-running the analysis is enough.

**Images already computed stay on the device.** Every processed scene is kept locally for **36 months** — three seasons, so year-on-year comparisons and the crop-rotation check (§4.17) stay possible — and redraws **with no network** when you reopen the app. At startup, no more than **once every 12 hours**, AgroGea checks in the background whether the satellite deposited new imagery and computes its NDVI: by the time you open the module, the work is often already done. It is recomputable data: it takes no space in the sync backups and can be rebuilt at any time by re-running the analysis.

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

Beyond parcels (Step 2: public parcels or hand drawing), the **Draw element** module manages the rest of the territorial elements:

- **Draw infrastructure** (line) — pipelines, fences, anti-hail nets, roads. On closing you enter type, name and status; the **length** is computed.
- **Draw POI** (point) — wells, traps, IoT sensors, gates, buildings.
- **Plot list** (in the sidebar it sits under **Soil**, because its sheet is where soil parameters are read) — the list of everything you have drawn (parcels, infrastructure, POIs). Tapping an entry **frames** the element on the map and opens its sheet: soil parameters, metadata, geometry editing, protected deletion. Opening it leaves drawing mode, so a tap on the map goes back to **selecting** instead of tracing.
- **Print** — open the **print composer** to generate a laid-out map of the farm (e.g., for technicians, consortia, authorities).

### 4.8 Add Data — importing your layers

To bring external data onto the map:

1. Header → **Add Data** (or **drag** the file into the window).
2. Supported formats: **Shapefile** (with `.dbf`/`.shx`/`.prj`), **GeoJSON**, **OSM** extracts, **GeoParquet**.
3. The file is loaded into the local analysis engine and shown as a new overlayable layer (also useful as a **soil map** for the water balance, §4.5).

**Raster maps** (at the bottom of the panel) add images instead of geometries, in two ways:

- **WMS service**: paste the service address and press *Read the available layers*. AgroGea queries the service and lists its layers by their **readable title**, so you do not need to know the technical code. Choose one and add it. The layer stays on the publisher's server: always up to date, but it needs the network.
- **Orthophoto (.tif)**: a georeferenced GeoTIFF from your computer. It stays on the device and **works offline**. On the map it is downscaled so it can be drawn; the GAEC 8 card of the Compliance module (§4.17) can still measure on it at full resolution, **without asking you to load it again**.

> The orthophoto must be in **UTM or WGS84**. With any other reference system AgroGea refuses to load it and tells you which one it is: better than drawing it a few hundred metres off, which would look like it works.

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

From the **Command Center** button in the header you switch from the map to the **dashboard**, split into **two pages**:

- **Crops and fields** — the agronomic analysis: season → crop → field filters, **custom indicators**, composable charts and management report.
- **Company** — the general overview: season area/operations/harvest, **Warehouse status** (stock value at WAC, expired/expiring lots, products below minimum stock), **product cost by field** and backup/restore. A clickable alert flags campaigns with incomplete declaratory (SIAN/SIEX) data.

#### Custom indicators (KPI cards)

Instead of the old grid of fixed indicators, you **compose** the KPI cards yourself. **＋ Add indicator**, then choose, in this order:

1. **Data source** — Parcels, Operations (Logbook), Harvests, Water balance, Weather, DSS.
2. **Function** — Count, Sum, Average, Min, Max or **Ratio (A / B)** — and the **measure** to apply it to (e.g. total quantity, kg harvested, mm of rain, area).
3. **Period** — the current season, the **last N days**, or the whole history.

Optional but useful: a **filter** on one dimension (e.g. plant protection treatments only), the **unit** and decimals to display, the **trend** (sparkline + change versus the previous period) and the **color thresholds**, with the direction of the alarm — *above the threshold* for an indicator that worsens as it rises (stress days), *below* for one that worsens as it falls (mean NDVI).

Cards can be **dragged to reorder** and edited or deleted from the card itself. They are **display preferences**, stored per company on the device: they are not domain data and are never synchronized. On first opening you get three examples (area in scope, operations of the season, rain over the last 30 days): change or delete them freely.

> The **operations calendar** no longer lives in here: it has become a view of its own, reachable from the header (§4.11).

### 4.11 Farm calendar

The **Calendar** button in the header opens a **monthly grid with everything that has a date**, in one place:

| Color | What it shows |
|---|---|
| **Planned tasks** | what still has to be done (dashed: it is in the future) |
| **Operations** | the Field Logbook records |
| **Harvests** | the harvests recorded |
| **DSS risk** | the high-risk days of the phytopathological models |
| **Water stress** | the days when the water balance says it is time to irrigate |

Each cell also carries the **weather of the day** — icon, high/low and millimetres — for both the past and the forecast. It is contextual data: offline the cells simply have no weather and the calendar works all the same.

**What you can do:**

- move between months with **‹ ›** or jump back to **Today**; filter by **parcel** or look at the whole farm; switch individual categories on and off from the **legend**;
- **click a day** to open its detail: what happened (or will happen) on that date, the weather, and two entry points — **Plan task** and **Record operation**, both **on the day you opened**, never on "today" by mistake;
- reload DSS risk and water balance with the **⟳** button.

> **The calendar consults the register, it does not rewrite it.** Operations and harvests open in their read-only sheet: corrections and deletions stay where the record lives (Logbook, Harvest module), because a legally-relevant register must not have two editing doors with different rules. Only **tasks** — which are planning, not recording — remain editable and cancellable.
>
> DSS and water stress appear **as soon as the respective calculations are run** (from the map or the Command Center): the calendar reads them, it does not recompute them.

### 4.12 Official exports and backup

**Registers for inspections** — AgroGea chooses the format based on the farm's **Country**:

- **Italy — SIAN/PAN:** from **Logbook (QDC) → SIAN export**. CSV optimized for Italian Excel (separator `;`, UTF-8 BOM), with ministerial Island/Parcel codes.
- **Spain — SIEX/CUE:** *Cuaderno Digital* in JSON (FEGA).
- **Other EU countries / France:** international CSV (separator `,`, ISO dates).

The CSV export covers the **whole Field Logbook (QDCA)**: it includes both treatments and **harvests** (a «Harvest» row with quantity in kg and destination). The operation type is written **in your language**, not as internal codes. The **SIAN/SIEX codes** appear even if filled in the crop sheet after recording the operation: they are resolved by parcel and season, so you only need to complete them once in Crop data. Columns, order, separator and filters (dates, fields, crops, types) remain fully configurable.

**SIAN Dossier import** — you can import the Farm Dossier: AgroGea creates the missing parcels from the geometries, normalizes the crops and populates the season's Campaign, recognizing already-present fields without duplicates.

**Geometry export** — parcels and layers in **GeoJSON, KML, GPX, CSV, Shapefile**.

**Full backup** — a snapshot of the entire farm in a single **Extended GeoJSON** file, plus the related **import/restore**. Before generating it you choose **what goes into the backup**: the dialog opens on *complete backup* (every section, the whole history), and anyone who wants an extract can narrow the **reference period** (current year, last 12 months, free dates) and drop the sections they do not need — Logbook, harvests, soil analyses, scouting, infrastructure, **warehouse**, **machinery fleet**, **planning and Field Mode**, **regulatory monitoring** (the thresholds you changed; outcomes are not exported, they are recomputed). Parcels, crops and campaigns always stay in the file: everything else hangs from them, and without them it could not be restored.

The period filters **dated** records (operations, harvests, analyses, scouting, maintenance, refuelling, sessions); registries and warehouse stock are always kept in full. The file states its own scope, so even a year later an *empty* warehouse is still distinguishable from a warehouse that was *not included in the backup*. Backups created with earlier versions restore without any action on your part: they are upgraded to the current format during import.

> Every import/export is logged in a local **transfer journal**: you always have the history of what came in and out.

### 4.13 Settings: weather, theme, profile

- **Weather** (Settings → Weather) — configure the weather station/source that feeds the water balance and the DSS.
- **Theme** — Light / Dark / Green, from the selector in the header.
- **Profile** — from the user menu top-right: app preferences and settings. Besides visible modules, language and units, this is where **Map view** lives: the allowed *minimum zoom* and *maximum zoom*, selectable between 13 and 17 (see §2). It fixes your working scale: someone always working row by row can narrow it to 16–17 and stop losing the framing.

### 4.14 Warehouse — stores, products, lots and stock

The Warehouse keeps three linked things: the **stores** (where the goods physically are), the **product registry**, and their **lots** with expiry, stock and cost. Logbook activities withdraw from here.

> **Stock lives in the lot, not in the product.** It is the individual lot that has a location, which is why the same product can sit in two stores with different expiry dates and quantities without duplicating the registry entry.

#### The stores

A farm can have as many as it needs: the main shed, the locked plant-protection store, the diesel tank, the seed silo.

1. Sidebar → **Warehouse** → **Products and lots** → **Warehouses** button, at the top of the panel next to the selector.
2. **＋ New warehouse**: give it a **name** ("North shed", "Plant protection store") and pick the **type** — *General, Plant protection store, Fertiliser store, Seed store, Fuel tank, Machinery shed*. The type enforces no rules: it picks the **icon** the store gets on the map and helps you tell them apart in the list.
3. **Position on the map** (optional): press **Tap the map**, then tap where the store is. From then on the warehouse is a **clickable POI** — an indigo tile with its type icon and a **badge** counting the lots in stock. A warehouse with no position stays perfectly valid: it is a "logical" store, reachable only from the module.
4. Optional: **address** and **notes**. The ✏️ edits an existing store, if only to move its point.

**Opening a warehouse from the map:** tap its POI. The module opens already **pointed at that store**, whatever screen you had left open before (another product, the store registry, a form): whoever taps a warehouse on the map expects to see what is inside it, not to find their way back.

**Filtering by store:** the **Warehouse** selector at the top of the panel switches between *All warehouses* — the aggregate view, with the full registry including products at zero stock — and a single store, which shows **only what is inside it**. With a store selected, stock figures, expiry alerts and below-minimum badges are computed **on that store**.

**Deleting a warehouse does not delete the goods:** its lots become **"unassigned"** and keep counting towards the farm's overall stock. Closing a store is a logistics fact, not the destruction of supplies.

#### Products and lots

1. Sidebar → **Warehouse** → **Products and lots**.
2. **＋ New product** and pick the **category** (rigid — it determines the required fields):
   - **Plant protection product** — requires the **PAN registration number**; plus active substance and **default PHI/re-entry** (prefilled later in the Logbook);
   - **Fertilizer** — requires the **N-P-K contents** (percentages);
   - **Seed** — with its **crop identity** (species, scientific name, variety, crop type): this is what enables the automatic crop assignment at sowing;
   - **Fuel** — requires the agricultural fuel (**UMA**) allocation code;
   - **Other / supplies** — lubricants and consumables, no extra fields.

   The form includes the **initial load** (destination warehouse, production lot, expiry, **mandatory quantity** and cost): a product is born with its stock, and already placed. Optional for all categories: supplier and **minimum stock** (below the threshold a reorder badge appears).
3. From the product detail, **Load lot** adds further loads, each with its own **destination warehouse**. Every load updates the product's **weighted average cost (WAC/CUMP)** over the current stock — the WAC is **per product**, not per store: it is the average cost of the goods, not of the place they rest in. In the lot list, each row shows the store it sits in.
4. **Import CSV** — to populate the registry in one go (e.g. the consortium price list or the export from your previous software), with no network.

> **The destination warehouse is optional.** The selector offers *Unassigned*, and that is the right choice until you have defined your stores: the stock is real and usable all the same, it simply has no location. If you have a single warehouse it is preselected on its own, and if you are working inside a store, that one is preselected.

**How to prepare the products CSV file:**

- **Header row required**; the separator (`;` or `,`) is detected on its own, so a CSV saved by Excel in an Italian locale works too.
- **Required columns:** `category`, `name`, `unit`.
- **Optional:** `registration_number`, `active_substance`, `npk_n`, `npk_p`, `npk_k`, `uma_code`, `supplier`, `notes`, `min_stock`, `safety_period_days`, `reentry_interval_h`, `species`, `scientific_name`, `variety_name`, `crop_category` and — for the initial load — `lot_number`, `expires_at`, `initial_quantity`, `unit_cost`.
- `category` accepts both the codes (`phytosanitary`, `fertilizer`, `seed`, `fuel`, `other`) and the Italian names (`agrofarmaco`, `concime`, `semente`, `carburante`, `altro`).
- **The same rules as the form apply**, this is not a shortcut: plant protection products → registration number, fertilizers → N-P-K contents between 0 and 100, fuel → UMA code.
- The **initial load is optional**: with `initial_quantity` and `unit_cost` the lot is created too and the WAC moves; without them, only the registry entry enters, at zero stock. Expiry must be written as `YYYY-MM-DD`.

The **Download template** button gives you a ready-made CSV with one example row per category. Before anything is written you get a **preview** with how many rows are valid and, for each one, the exact error (unknown category, missing registration number, product already in the warehouse…): valid rows are imported anyway, the others stay out and you fix them calmly in the file.

> **Where imported lots land:** in the **store the module is pointed at** when you run the import. If the selector is on *All warehouses*, the loads enter with no location. The CSV file has no column for the warehouse: select the store first, then import.

**Withdrawing from activities:** the logbook form (treatments, fertilizations, sowing) shows a **Warehouse withdrawal** section: pick product → lot → quantity. On save the stock is withdrawn **for real**, in a single transaction with the activity: if the quantity exceeds availability, **the whole registration fails** (no partial withdrawal) with a clear message. The product cost (quantity × WAC at withdrawal time) is **charged to the treated field** and will feed the field balance.

**Expiry:** **expired** lots are highlighted and their use in activities is **blocked** (not selectable); lots **expiring** within the configurable threshold (default 30 days) raise an alert in the panel.

> **Compatibility:** existing records with free-text products/machinery remain valid; the warehouse withdrawal is optional and coexists with free text until you link a real lot. Deleting an operation with withdrawals **restores** the stock automatically. Lots loaded **before** multiple stores were introduced show as *unassigned*: no data changed, they keep counting towards stock and stay usable in activities. The location is chosen **at load time**: an existing lot is not moved between stores (to place old supplies, load them into the right store as they come back in).

---

### 4.15 Machinery — vehicles, maintenance and fuel

The Machinery module manages **vehicles** (power units) and **implements**, links them to field operations with **automatic hour counters**, keeps the **maintenance** and **document** schedules, and tracks fuel **refills**.

**Registry (Sidebar → Warehouse → Machinery):**

1. **＋ New vehicle** (tractor, combine…) or **＋ New implement** (plough, sprayer…). Vehicles are tracked by **working hours**, implements by **wear** and **working width**. On creation you can enter the **initial reading** of the hour meter. The **status** (operational / under maintenance / broken down / decommissioned) has a traffic light; **decommissioned** vehicles stay in the history but disappear from the selection lists.
2. **CSV import** — populate the fleet quickly from a file (name, type, plate, year, initial hour meter) with **preview and validation**: invalid rows are flagged and skipped, partial import is allowed. All local, no network.
3. From the **vehicle detail** you manage: the **counter** (with tracked manual adjustments — initial reading, engine replacement), **documents** with traffic lights, the **maintenance schedule** and **l/h consumption**.

**Automatic counters:** when recording an operation in the Logbook (treatment, fertilization, sowing, tillage, irrigation) a **Vehicle** section appears: pick the vehicle (and optionally the implement) **from the list** — no free text — and the hours. On save the counters are **incremented** automatically; editing or deleting the operation **recalculates** them without drift. The form suggests the **last combination** used and warns you if the chosen vehicle **is not operational** (without blocking). If the vehicle does not exist, **＋ New vehicle** creates it on the spot and selects it.

**Maintenance:** create **routine** or **extraordinary** plans due by **time** (every N days / a date) or by **hours** (hour-meter threshold). Approaching or crossing the threshold raises the **alert**. **Record job** notes date, hours, description, cost and spare parts; linking a warehouse lot **issues** the part from stock (atomic block). The job automatically **reschedules** the recurring plan.

**Documents:** roadworthiness test, insurance, road tax, inspection. Every document has a **traffic light** (valid / expiring / expired) and raises a threshold alert on its expiry date; you can attach a local file.

**Fuel refill (quick button on the map):** below the **geotagged notes** button (controls column, top-left of the map) you find the **⛽ Refill** button. Open it at the field: the form is **prefilled** (today's date, last vehicle, tank with the most stock). Enter **litres** and the **tank** (a lot in the *fuel* category), with the optional **hour-meter reading**; you save in one tap. The refill **issues** the tank from the warehouse (atomic block if the stock is not enough) and derives the **UMA** reference from the product. The same panel lists refills, filterable by vehicle and by tank.

**Consumption and anomalies:** in the vehicle detail, the **average l/h** and the last interval are computed **tank-to-tank** (litres ÷ hours between two full tanks with an hour-meter reading). A consumption that deviates beyond the threshold from the historical average is flagged as an **anomaly** (a possible sign of a fault or a wrong reading): it is a warning, not a block.

**Needs attention:** at the top of the Machinery tab a dashboard aggregates, with no extra clicks, what is **actionable** — maintenance due/overdue, documents expiring/expired, abnormal consumption and vehicles standing still. Every entry leads to the vehicle detail.

> **Enabling it:** the **Machinery** sections and the **Refill** button are shown/hidden from **Profile settings → Modules**. Refill is **detached** from the rest of the Warehouse: it is reached only from the quick button on the map.

---

### 4.16 Task planning and Field Mode — the no-typing flow

The idea is simple: **decide at the desk, touch nothing in the tractor**. You prepare the job the evening before, and when you drive into the field the next day the rest happens by itself, all the way to the logbook entry.

#### Before: prepare the task (Sidebar → Task Planning → Tasks & Recipes)

1. **＋ New Recipe** — a **reusable mix** ("Standard powdery-mildew spray", "NPK foliar feed"): give it a name, add the products with their **dose per hectare** and unit. Picking the product from the **Warehouse** copies across the registration number, active substance and — for fertilizers — type and N-P-K ratio by itself: these are exactly the fields the logbook will demand, and this is where you fill them in once and for all.
2. **＋ New Task** — the **planned job card**. Pick the **operation type first**: it decides which fields appear, exactly the ones the logbook would ask for that job.

   | Type | What it additionally asks | 
   |---|---|
   | Crop-protection treatment | recipe, **target pest** (from the same list as the logbook, not free text), licence no. |
   | Fertilization | recipe |
   | Tillage | tillage type |
   | Irrigation | amount in mm or hl |
   | Sowing | seed from the Warehouse + rate |
   | Harvest, Sampling | nothing: parcel, date and operator are enough |

   The **recipe exists only** for treatments and fertilizations: the other jobs have no mix to preset, and their data is entered just as in the logbook. The **licence number** is set once and remembered on the device for every form.
3. If something is missing, a warning tells you **precisely which fields would make the record non-compliant**. You can still save: planning stays fast, and incomplete tasks remain flagged.

> **Why it insists on mandatory fields:** the entry at the end of the job is automatic, so there is no moment when someone re-reads and completes it. What is missing now would be missing in the register. That is why the sidebar shows a **⚠** counter on *Task Planning* and *Field Logbook*, with the list of records to complete.

#### In the field: detection is automatic

There is no button to press and no setting to enable. With the app open, once you have **stayed inside the parcel for 15 seconds** a **card** appears in the centre of the screen — large, but not full-screen: the map stays visible around it, so you can see where you are while deciding.

The card says **"You are in field: [name]"** and shows:

- the **planned tasks** for that field as selectable rows, with the most urgent one **already selected** (with only one task you need not touch anything);
- or, if you planned nothing, a selector — **Treatment**, **Fertilization**, **Tillage**, **Other** — and the recipe choice.

At the bottom, always in the same place, **two actions only**: **START** runs what is selected, **LATER** postpones.

Those 15 seconds are not dead time: they stop a pass along a headland or a service track from being read as "I have started working here". By the same token, a signal wobble near the boundary does not make the app believe you have left.

> ⚠️ **Re-entry interval.** If a treatment was applied to that field and its re-entry interval **has not yet elapsed**, the card shows a warning with the product and the hours remaining, and **START** stays disabled until you tick the acknowledgement. It is not a hard block — whoever applied the treatment may re-enter with PPE — but it guarantees that **another operator does not walk in unaware**.

**If you plan a task while already inside the field**, the card comes back by itself: no need to leave and re-enter.

#### During: Field Mode

Once the job starts the screen turns **black with giant lime-green figures**: it is built to be read in direct sunlight from the seat, not to look elegant. It deliberately ignores the app theme.

- **Speed** and **elapsed time**, live, the **total area of the parcel** and — at a glance — **what you are doing**: recipe, products and doses taken from the task. If the task had already been started on another day, you also see **"Already done: N%"**.
- **PAUSE / RESUME** and **FINISH**, with touch targets over 88 px: they work with gloves on. While paused the clock freezes.

> **You no longer see the worked hectares ticking up.** They were an estimate (track length × working width) promising a precision the GPS does not have: it depended on the width recorded on the implement, inflated the figure over overlapping passes and collapsed to zero on a poor signal. You now declare the area yourself at the end, in one tap.
- **Voice note**: one tap starts, one tap stops. The recording is **geotagged** with where you are and stays on the device; you can play it back from the list.
- If you started by mistake, **Cancel session** (with confirmation) undoes everything and puts the task back among those to do.

The track is saved in small blocks as you work: if the phone dies or the app closes you lose at most the last stretch, not the day. Reopening the app resumes the session where it was.

#### At the end: one question, then it records itself

Tapping **FINISH** brings up **a single question: "How much did you work?"** — the share of the parcel you completed, with quick steps at **25 / 50 / 75 / 100%** (100% is preselected, because the normal case is "I'm done"). Product quantities and the warehouse issue are computed on that percentage, so it is worth declaring honestly. The screen shows you the **matching hectares** as you move the slider and — if you had left the task half-done on another day — how much was **already recorded**, so the same work is never counted twice.

- **Below 100% the task stays planned**, with the progress saved: tomorrow geofencing offers it again and you resume where you stopped. Today's work is recorded regardless.
- **At 100% the task closes** and leaves the to-do list.

Once confirmed, the job **is in the Field Logbook**: there is nothing else to confirm. The summary tells you what was saved:

- the **area worked** that you declared (if none is usable, the cadastral area is used and it says so);
- the **active duration**, excluding pauses;
- for each product in the recipe, the **total quantity recomputed** over that area (`dose × hectares worked`);
- the voice notes recorded;
- if you sowed on a field still free for the season, the **crop automatically assigned** to the parcel — just as a sowing recorded by hand in the logbook would. A crop already in progress is never overwritten.

If the recipe used products held in the Warehouse, **stock is issued** from the lot with the nearest expiry, with the cost charged to the field. If anything needs your attention — an expired lot, insufficient stock, a product not linked to the registry, the area falling back to the cadastral one, or mandatory fields still missing — it says so, with a shortcut to open the logbook and fix it. **The job is recorded either way**: stock to correct is a smaller problem than a job never written down.

#### If GPS will not cooperate, or you dismissed by mistake

Automatic detection is a convenience, not the only road. **Tap the parcel on the map** and its **sheet** opens: area, crop, the tasks planned for that field and the operations already recorded — all in one place. The **Start** button lives there.

It is not a shortcut that skips the checks: it opens the very same card as automatic detection, so the re-entry warning and its acknowledgement are identical. Use it when GPS is missing or imprecise, when you tapped **LATER** and changed your mind, or simply when pointing at the field with a finger beats waiting.

> **Detection status.** The header of the *Task Planning* panel always states what is happening — worth a look when no card arrives:
>
> | What you read | What it means |
> |---|---|
> | *Field detection active* | all good, it is listening |
> | *You are inside a plot* | recognised; the dwell timer is running |
> | *Weak GPS signal (±N m)* | fixes arrive but are too imprecise: **no entry will fire** until it improves |
> | *GPS permission denied* | grant it in the device settings; detection **restarts by itself** as soon as you do |
> | *Insecure connection* | the page is not on HTTPS and the browser blocks GPS: no setting can fix it, open the app from the desktop |
> | *No plot to watch* | no parcels drawn |
>
> If you read **±800 m or more**, the device is not using GPS but network positioning: on iOS check *Precise Location*, on Android *Use precise location* in the browser permissions. Next to the error message a **Retry** restarts detection by hand.

The map still shows your position through its usual GPS control, top right: that is independent of detection.

---

### 4.17 Compliance — CAP and organic self-assessment

The **Compliance** module tells you, parcel by parcel, how you would fare if an inspection came. It is a module of its own in the sidebar, with one entry per family: **Eligibility**, **Conditionality (GAEC)**, **Eco-schemes**, **Cross-cutting**, **Organic** and **GeoCompliance** (the binding layers).

> **It is not an official check.** The check is the Paying Agency's area monitoring system (AMS, EU Reg. 2021/2116 art. 66); for organic farming it is your control body. What you get here is a **self-assessment** based on public data, and it says so at the top of the panel, on every card and inside the report you export.

**How to use it**

1. Open a family from the sidebar.
2. Choose the **parcel and crop** from the menu at the top: the choice is made here, not on the map (tapping the map still opens the Logbook).
3. Each card shows *first* what it observes, how observable it is and what it needs. Press **Assess this card** when you want: assessments never start on their own.
4. If a card says images are missing, press **Check scenes**: AgroGea queries the satellite catalogue — free, without downloading anything — and tells you how many scenes exist for that card, how many you already have and how many megabytes are needed. Then you decide whether to download them.

**Four outcomes, not three**

Compliant · Needs a look · Non-compliant · **Undecidable**. The last one is not an error: it means the data is not enough to tell, and the card explains *what* is missing and *where* to complete it. Some cards are "undecidable" almost always, and that is useful information — knowing which check the satellite cannot anticipate is worth as much as knowing the others.

**The thresholds are yours**

Every number that decides an outcome — the soil-cover threshold, your region's sensitive period, the copper ceiling — is an **editable parameter**, with the legal reference next to it. If you change it, that card re-assesses itself and your value travels in the backup: you do not lose it on restore.

**What you need, and what AgroGea fetches by itself**

| Card | Data needed | Where it comes from |
|---|---|---|
| GAEC 4 — buffer strips | water network | **OpenStreetMap**, by pressing *Fetch* (or a regional layer of yours, which takes precedence) |
| GAEC 5 — slope | terrain model | **Copernicus DEM**, by pressing *Fetch* |
| GAEC 8 — non-productive features | high-resolution orthophoto | you load it (§4.8); at least ~67 cm is needed for a 2 m hedge |
| Organic | Logbook and warehouse | your own registers: no satellite needed here |

**Organic cannot be verified from a satellite**

An organic field and a conventional one look the same from above. The **Organic** card reads what you actually applied — the lots issued from the warehouse, not the planned doses — and checks permitted substances, copper (28 kg/ha over 7 years), organic nitrogen (170 kg/ha/year) and the conversion period. A substance not on our list is **not** declared forbidden: the list is partial and the outcome is "undecidable", with a prompt to check it against the legal act.

**Report and clean-up**

*Export the report* gives you a file with every assessed card, the scenes used, the thresholds applied and the disclaimer: it is meant to be attached and re-read two years from now. At the bottom of the panel there is the **scene cache clean-up**, which you can empty without worry — scenes are downloaded again — when you change thresholds, redraw a parcel or run out of space on the device.

## 5. Shortcuts and productivity

- **Command Palette** — from the **Help (`?`)** menu open the palette to jump to any action or panel by typing its name (including **Open Calendar** and **Open Command Center**).
- **← / → arrows** — cycle the three views in the order **Map → Calendar → Command Center**. They do nothing while you are typing in a text field or when the focus is on the map (there the arrows pan the view).
- **Click on a field** — opens its **sheet**: planned tasks (startable) and operations recorded on that parcel, with shortcuts to plan or open the logbook.
- **Help menu** — Command Palette, list of shortcuts, diagnostics, feedback, updates and information.
- **Automatic updates** — at startup the app checks for new versions and shows a banner with the release notes; no download starts without your consent.

---

## 6. The recommended flow of a season

A practical outline that lines up the modules in the typical order of a campaign:

1. **Setup** (one-off): first launch (farm and Country) → Farm registry and certifications → parcels adopted from **Public parcels** (or imported from the Dossier, or drawn) → **Warehouse** stores → soil composition where available.
2. **Season start:** set the **season** and assign the **crop** to each parcel (Step 3). Record **sowing/transplant** in the Logbook for annuals.
3. **During the season:**
   - use the **Calendar** as the starting point of the day: tasks to do, operations recorded, weather, DSS risk and water stress on the same grid (§4.11);
   - record treatments, fertilizations, irrigations and tillage in the **Logbook**;
   - monitor vigor with **Index analysis** (NDVI…);
   - plan irrigations with the **Water balance** and keep an eye on the **DSS map**;
   - generate **VRA maps** for variable-dose operations;
   - check the cards that concern you in the **Compliance** module (GAEC, eco-schemes, organic) before the application deadlines (§4.17).
4. **Harvest:** record deliveries in the **Harvest** module; analyze yields and vigor in the **Attribute table** and **Command Center**.
5. **End of season / inspections:** export the official registers (**SIAN/PAN** or equivalent), attach the **Compliance report** if you need it, and make a full **GeoJSON backup** of the farm.

---

> For the scientific explanation of the modules (satellite indices, VRA, water balance, DSS) see the [Technical documentation of the modules](../technical/agronomic-modules.en.md); for automatic updates the [Desktop Auto-Update](../technical/desktop-auto-update.md) document.
