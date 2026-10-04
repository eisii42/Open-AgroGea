<p align="center">
  <img src="docs/assets/logo.png" alt="AgroGea" width="120" height="120">
</p>

<h1 align="center">AgroGea</h1>

<p align="center">
  <b>The <i>local-first</i> agronomic GIS suite that brings the field — not just the map — onto your device.</b>
</p>

<p align="center">
  <b>🇬🇧 English</b> · <a href="README.it.md">🇮🇹 Italiano</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL v3" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/releases"><img alt="Release" src="https://img.shields.io/github/v/release/eisii42/Open-AgroGea?include_prereleases&sort=semver"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/quality.yml/badge.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/sast.yml"><img alt="Security scan" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/sast.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
</p>

<p align="center">
  <a href="https://eisii42.github.io/Open-AgroGea/"><b>🌐 Try the web demo</b></a> — runs entirely in your browser; nothing you enter leaves it
</p>

---

AgroGea is a **local-first** agronomy and land-management suite: GIS map, digital Field Logbook, crop-protection decision models and water balance, soil analysis and variable-rate application, CAP and organic self-assessment — **all working offline**, in the middle of a vineyard with no coverage.

<p align="center">
  <img src="docs/assets/Gif_Readme.gif" alt="AgroGea in action" width="100%">
</p>

## Local-first

- **100% functional with no network, in the field.** Draw a plot, record a treatment, browse the map, compute the yield — everything is already on the device. The network is needed only for online services — satellite imagery and indices, weather, web map services — and for updates.
- **Instant speed.** Cadastral overlays, spatial joins, risk indices and area computations run **inside the application** (in-browser DuckDB Spatial), not on a distant server.
- **Your farm data stays yours.** Each farm lives in an isolated store on your device (PGlite, PostgreSQL WASM). Nothing is sent anywhere unless you choose to.
- **Optional sync to your own server.** If you want a shared copy, AgroGea can sync to a PostgreSQL server you run yourself, over TLS. Changes queue up locally (`sync_outbox`) and resume on their own when the server is reachable again.

## Key features

- 📱 **Built for the field, on phone and desktop** — on the phone, a bottom navigation bar, sheets you drag with one thumb and the weather always in sight; on the desktop, an icon rail for the modules and several modules open side by side in a resizable column. **Tap the logo** for one list of everything that needs fixing in the farm: incomplete records, campaign data, expiring lots, machinery deadlines, plots without soil data.
- 🗺️ **Full GIS map** — satellite orthophoto (Esri World Imagery), WMS cadastral overlay, historical *Wayback* imagery to compare the same land across different epochs, drag-and-drop import of Shapefile / GeoJSON / OSM / GeoParquet into the local analysis engine. **Any WMS service** can be added by address and saved as the map background, and your own **GeoTIFF orthophotos** work offline.
- 🧭 **Parcels already published, not redrawn** — across much of Europe agricultural parcels are already digitised and published as open data. Pick the official source, search the area you are looking at, see them appear on the map with their details on hover, and adopt one with a click: hand drawing stays as correction and fallback, not the main flow. Every adopted parcel keeps **where it comes from, which year it refers to and under which licence** — the attribution travels with the data all the way to export. Today the Netherlands (BRP/PDOK) and France (RPG/IGN), verified against the live services; adding a country means adding a JSON record to the catalogue, not writing code.
- 📒 **Digital Field Logbook** — traceability of crop-protection treatments and fertilizations compliant with **PAN/SIAN** rules, with automatic validation of mandatory fields, re-entry interval and Pre-Harvest Interval computed and under control before delivery. Operations can be **edited in place**, and every record shows the fields it still needs to be compliant.
- 🌾 **Harvest & Analytics** — harvest recording per plot/season, bar charts and histograms on the fly from the attribute table, Field Calculator with ready-to-use agronomic formulas (plant density, yield t/ha, organic-N ceiling in Nitrate Vulnerable Zones), and KPI cards you compose yourself.
- 🌡️ **DSS & Water Balance** — colored risk map (green/yellow/red) per plot, combining water stress, phytopathological risk, NDVI vigor and soil fertility; day-by-day water balance with **Penman-Monteith (FAO-56)** evapotranspiration and yield-reduction estimation (Ky factor, FAO-33/66).
- 🎯 **Soil analysis and variable-rate application (VRA)** — zoning and variable-rate prescriptions from soil analysis and Sentinel-2 vegetation indices.
- 🚜 **Geofencing and Field Mode** — plan the job at the desk, then touch nothing in the tractor: on entering the plot the **GPS recognises the field** and offers the planned task, a very-high-contrast screen shows speed, elapsed time and what you are doing (with geotagged voice notes), and at the end you only declare **how much you worked** for the job to **record itself in the logbook**, with quantities recomputed on that area and the warehouse stock issued. Below 100% the task stays open and resumes the next day. Automatic warning when a treatment **re-entry interval** is still open on that field.
- ⚖️ **Compliance: CAP and organic self-assessment** — plot by plot, how you would fare at an inspection: eligibility, conditionality (GAEC), eco-schemes and organic, with four outcomes (including *undecidable*), the satellite scenes actually used, the confidence and the factors limiting it, and editable thresholds with the legal reference next to them. Slope from Copernicus DEM, water network from OpenStreetMap, your own orthophotos for non-productive features. It is a self-assessment, and says so everywhere.
- 📦 **Warehouse and machinery** — several georeferenced stores as points on the map, lots with expiry and stock per store, real stock issue and weighted-average cost charged to the field; vehicles and implements with hour counters, maintenance and refuelling.
- 📅 **Farm calendar** — a monthly grid with everything that has a date: tasks to do, recorded operations, harvests, day-by-day weather, DSS high-risk days and water-stress days. From there you plan a task or record an operation **on the day you opened**.
- 📤 **Exports for regulatory bodies** — format chosen automatically based on the farm's country: **SIAN/PAN** (Italy, Excel-ready CSV with UTF-8 BOM), **SIEX/CUE** (Spain, FEGA JSON), a base international format for the other EU countries. Import of the SIAN Farm Dossier with automatic creation of missing plots. Geometry export to GeoJSON, KML, GPX, CSV, Shapefile. Full or selective backup (period and sections) in extended GeoJSON, restorable right from the first launch.

Full usage guide: [User Manual](docs/user-guide/manual.en.md) · How the agronomic modules work: [Technical documentation](docs/technical/agronomic-modules.en.md) · What changed in each version: [CHANGELOG](CHANGELOG.md).

## Install

Download the installer from [GitHub Releases](https://github.com/eisii42/Open-AgroGea/releases): prebuilt installers are published for **Windows**, and the desktop app then updates itself. macOS and Linux build from source with the commands below.

## Quick start (from source)

Requirements: **Node.js 22+** and the **Rust** toolchain ([rustup](https://rustup.rs/)) for the native app. On Linux, also the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebKitGTK).

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps

npm run dev:standalone              # the app in the browser (Vite, port 5174)
npx tauri dev -w agro-field-suite   # native desktop app (Tauri v2)
```

Build native installers (requires Rust/Cargo):

```bash
npm run build:standalone
npm run tauri:build             # .msi/.exe (Windows), .dmg/.app (macOS), .AppImage (Linux)
```

Quality checks:

```bash
npm run typecheck
npm test                        # agronomic-domain tests
npm run lint
npm run check:rust              # cargo check of the native app
```

## Architecture at a glance

- **App**: [`apps/agro-field-suite`](apps/agro-field-suite) — React + TypeScript on Vite, **Tauri v2** shell (native Rust core) for desktop, mobile and web from the same codebase.
- **Map engine** ([`packages/core`](packages/core), [`map`](packages/map), [`ui`](packages/ui), [`plugins`](packages/plugins), [`attribute-table`](packages/attribute-table)) — MapLibre-based cartography, layer management, map plugins and the attribute table.
- **Parcel contract** ([`packages/agro-parcel`](packages/agro-parcel)) — zero-dependency leaf package: the `Parcel` type, the catalogue of public sources (one JSON per source) and the WFS/OGC API adapters. Consumable on its own, including from other repositories.
- **Agronomic domain** ([`packages/agro-core`](packages/agro-core), [`agro-ui`](packages/agro-ui), [`plugins/agro-tools`](plugins/agro-tools)) — Zustand store, local per-farm **PGlite** (PostgreSQL WASM) DAL, Sync Engine, pure calculation engines (NDVI/NDRE, FAO 56/66, phenology, soil, compliance).
- **In-browser spatial analysis** — **DuckDB Spatial (WASM)** reads transactional data from PGlite for overlays, spatial joins and zoning, without ever leaving the device.
- **Synchronization** — local `sync_outbox` queue: no-op by default (data never leaves the device); optionally drained toward a private PostgreSQL server via a native Rust command.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Automatic updates (desktop)

The desktop app updates itself via **Tauri Updater** + GitHub Releases: a discreet check at startup, a banner with the release notes and an "Update now" button, download with a progress bar, no silent updates. Details: [docs/technical/desktop-auto-update.md](docs/technical/desktop-auto-update.md).

## Roadmap

Current status and next steps: [ROADMAP.md](ROADMAP.md).

## Contributing

Bug reports, feature requests and pull requests are welcome — see the [contributing guide](docs/contributing.md).

## Security

To report a vulnerability **do not open a public issue**: follow the [Security Policy](SECURITY.md). Every pull request goes through static analysis (CodeQL), secret scanning (gitleaks), a dynamic scan of the web build (ZAP) and an automated security review; dependencies are monitored weekly.

## License

AgroGea is distributed under the **[GNU AGPLv3](LICENSE)** license © 2026 Andrea Carnasciali.

Some bundled components keep their original licenses (MIT and others): attribution details in [NOTICE](NOTICE), licenses of all third-party dependencies in [`apps/agro-field-suite/THIRD_PARTY_LICENSES.txt`](apps/agro-field-suite/THIRD_PARTY_LICENSES.txt).
