<p align="center">
  <img src="docs/assets/logo.png" alt="AgroGea" width="120" height="120">
</p>

<h1 align="center">AgroGea</h1>

<p align="center">
  <b>The <i>local-first</i> agronomic GIS suite that brings the field — not just the map — onto your device.</b>
</p>

<p align="center">
  <b>🇬🇧 English</b> · <a href="README.md">🇮🇹 Italiano</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL v3" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/releases"><img alt="Release" src="https://img.shields.io/github/v/release/eisii42/Open-AgroGea?include_prereleases&sort=semver"></a>
  <a href="https://github.com/eisii42/Open-AgroGea/actions/workflows/release.yml"><img alt="Release build" src="https://github.com/eisii42/Open-AgroGea/actions/workflows/release.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
</p>

<p align="center">
  <a href="https://eisii42.github.io/Open-AgroGea/"><b>🌐 Try the web demo</b></a> — Standalone edition, runs entirely in your browser
</p>

---

AgroGea is a **local-first** agronomy and land-management suite: GIS map, digital Field Logbook, crop-protection decision models and water balance, soil analysis and variable-rate application — **all working offline**, in the middle of a vineyard with no coverage, with optional synchronization to a company server when you get back online.

<p align="center">
  <img src="docs/assets/Gif_Readme.gif" alt="AgroGea in action" width="100%">
</p>

## Local-first

- **100% functional with no network, in the field.** Draw a parcel, record a treatment, browse the satellite map, compute the yield — everything is already on the device. When you get back within range, AgroGea syncs on its own whatever you entered.
- **Instant speed.** Cadastral overlays, spatial joins, risk indices and area computations run **inside the application** (in-browser DuckDB Spatial), not on a distant server.
- **Confidentiality of farm data.** Production data stays in an isolated store on your device (PGlite, PostgreSQL WASM). For customers who require it, the entire backend can run on-premise: data never leaves the company perimeter.
- **No operational lock-up.** If the central server is unreachable, changes queue up locally (`sync_outbox`) and resume on their own once the connection returns, with exponential backoff.

## Key features

- 🗺️ **Full GIS map** — satellite orthophoto (Esri World Imagery), WMS cadastral overlay, historical *Wayback* imagery to compare the same land across different epochs, drag-and-drop import of Shapefile / GeoJSON / OSM / GeoParquet into the local analysis engine. It is built as a **hard fork** of the [GeoLibre](https://github.com/opengeos/GeoLibre) GIS engine: cartography, vector rendering and spatial-analysis tools are the direct legacy of a professional GIS engine; on top of that foundation AgroGea adds the entire agronomic domain — crop traceability, DSS, exports for regulatory bodies.
- 📒 **Digital Field Logbook** — traceability of crop-protection treatments and fertilizations compliant with **PAN/SIAN** rules, with automatic validation of mandatory fields, re-entry interval and Pre-Harvest Interval computed and under control before delivery.
- 🌾 **Harvest & Analytics** — harvest recording per parcel/season, bar charts and histograms on the fly from the attribute table, Field Calculator with ready-to-use agronomic formulas (plant density, yield t/ha, organic-N ceiling in Nitrate Vulnerable Zones).
- 🌡️ **DSS & Water Balance** — colored risk map (green/yellow/red) per parcel, combining water stress, phytopathological risk, NDVI vigor and soil fertility; day-by-day water balance with **Penman-Monteith (FAO-56)** evapotranspiration and yield-reduction estimation (Ky factor, FAO-33/66).
- 🎯 **Soil analysis and variable-rate application (VRA)** — zoning and variable-rate prescriptions from soil analysis and vegetation indices.
- 📤 **Exports for regulatory bodies** — format chosen automatically based on the farm's country: **SIAN/PAN** (Italy, Excel-ready CSV with UTF-8 BOM), **SIEX/CUE** (Spain, FEGA JSON), a base international format for the other EU countries. Import of the SIAN Farm Dossier with automatic creation of missing parcels. Geometry export to GeoJSON, KML, GPX, CSV, Shapefile.

Full usage guide: [User Manual](docs/user-guide/manual.en.md) · How the agronomic modules work: [Technical documentation](docs/technical/agronomic-modules.en.md).

## Quick start

Requirements: **Node.js 22+**, **Rust** toolchain ([rustup](https://rustup.rs/)) for the native desktop build.

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps

npm run dev:standalone          # OSS desktop edition, in the browser (Vite, port 5174)
npx tauri dev -w agro-field-suite   # native desktop app (Tauri v2)
```

Build native installers (requires Rust/Cargo):

```bash
npm run build:standalone
npm run tauri:build             # produces .msi/.exe (Windows), .dmg/.app (macOS), .AppImage (Linux)
```

Other useful commands:

```bash
npm run typecheck
npm test                        # agronomic-domain tests
npm run lint
```

## Architecture at a glance

- **App**: [`apps/agro-field-suite`](apps/agro-field-suite) — React + TypeScript on Vite, **Tauri v2** shell (native Rust core) for desktop/mobile/web from the same codebase.
- **GIS engine** ([`packages/core`](packages/core), [`map`](packages/map), [`ui`](packages/ui), [`plugins`](packages/plugins), [`attribute-table`](packages/attribute-table)) — vendored from GeoLibre (MIT).
- **Agronomic domain** ([`packages/agro-core`](packages/agro-core), [`agro-ui`](packages/agro-ui), [`plugins/agro-tools`](plugins/agro-tools)) — Zustand store, local per-farm **PGlite** (PostgreSQL WASM) DAL, Sync Engine, pure calculation engines (NDVI/NDRE, FAO 56/66, phenology, soil).
- **In-browser spatial analysis** — **DuckDB Spatial (WASM)** reads transactional data from PGlite for overlays, spatial joins and zoning, without ever leaving the device.
- **Synchronization** — local `sync_outbox` queue: no-op by default (data never leaves the device); optionally drained toward an on-premise PostgreSQL via a native Rust command.

## Automatic updates (desktop)

The desktop app updates itself via **Tauri Updater** + GitHub Releases: a discreet check at startup, a banner with changelog and an "Update now" button, download with a progress bar, no silent updates. Details: [docs/technical/desktop-auto-update.md](docs/technical/desktop-auto-update.md).

## Roadmap

Current status and next steps of the Community edition: [ROADMAP.md](ROADMAP.md).

## Contributing

Bug reports, feature requests and pull requests are welcome — see the [contributing guide](docs/contributing.md). Version history in [CHANGELOG.md](CHANGELOG.md).

## Security

To report a vulnerability **do not open a public issue**: follow the [Security Policy](SECURITY.md).

## License

AgroGea is distributed under the **[GNU AGPLv3](LICENSE)** license © 2026 Andrea Carnasciali.

The vendored GIS engine (`@geolibre/*` packages in `packages/core`, `map`, `ui`, `plugins`, `attribute-table`) remains distributed under the terms of its original license — **[MIT](packages/core/LICENSE)** © Qiusheng Wu — as permitted by that license itself. Attribution details in [NOTICE](NOTICE); licenses of all third-party dependencies in [`apps/agro-field-suite/THIRD_PARTY_LICENSES.txt`](apps/agro-field-suite/THIRD_PARTY_LICENSES.txt).
