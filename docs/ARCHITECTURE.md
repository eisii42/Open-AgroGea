# Architecture

AgroGea Community is a **local-first** agronomic GIS suite: an npm workspaces
monorepo (Node 22+) with a single Tauri v2 app and a set of internal packages.
This document maps the packages and features, the data flow, and where to add
new code. See also [`glossary.md`](glossary.md) and
[`naming-conventions.md`](naming-conventions.md).

## Packages

```text
apps/agro-field-suite      React + Tauri v2 app (desktop/mobile/web)
packages/
  core, map, ui,           GIS/mapping engine — vendored from GeoLibre (MIT),
  plugins, attribute-table   the @geolibre/* namespace; treat as upstream
  agro-core                @agrogea/core — domain: types, Zustand store, PGlite
                             DAL, Sync Engine, control-plane adapter
  agro-ui                  @agrogea/ui — Quaderno di Campagna components
plugins/agro-tools         @agrogea/tools — pure calculation engines (spectral
                             indices, FAO 56/66 water balance, phenology,
                             phytopathology, Saxton-Rawls soil, VRA zoning)
docs/                      Contributor & user documentation
tests/                     Node test runner suites (tests/agro-*.test.ts)
```

`@agrogea/core` is the **domain + data layer** (the app's `data/` and `domain/`
rolled into a package). `@agrogea/tools` holds **pure, framework-free** math and
is the most heavily unit-tested code. `@geolibre/*` is vendored and English
already — leave it as upstream.

## App structure (`apps/agro-field-suite/src`)

```text
app entry     main.tsx, App.tsx, standalone.ts, edition.ts, index.css
modules/      ONE folder per functional domain (the "features" layer):
                water-balance, warehouse, field-logbook, registry, settings,
                weather, soil, compliance, crops, dss, vra, analytics, sian,
                print, colorbar, command-palette, add-data, team
components/    ONLY generic, reusable UI + map/field infrastructure
              (BottomSheet, AppHeader, MapControls, DataEntrySheet, …)
hooks/        shared React hooks
lib/ services/ cross-cutting helpers and GIS services
i18n/         react-i18next catalogs (it/en/es/fr); UI strings live here
screens/      top-level screens (FieldDashboard, CommandCenter, …)
workers/      web workers (soil pipeline)
```

**Rule:** domain logic lives in `modules/<feature>/`. `components/` holds only
generic UI — a domain panel (e.g. `WaterBalancePanel`) belongs in its feature
module, not in `components/`.

## Data flow (local-first)

```text
UI (modules/*, components/*)
  → Zustand store (@agrogea/core store/*)        reactive domain state
    → DAL (@agrogea/core db/dal*.ts)             typed CRUD, computes area, etc.
      → PGlite (Postgres WASM, one instance/company)   the source of truth
        → sync_outbox                            transactional mutation queue
          → Sync Engine (sync/targets.ts)
              LocalOnlySyncTarget  (standalone default: no-op, data stays local)
              OnPremiseSyncTarget  (optional: Rust/tokio-postgres → private PG)
```

- Every company has an **isolated PGlite instance**. Geometry is GeoJSON in a
  `jsonb` column (no PostGIS in PGlite); area is computed in the DAL with
  `@turf/area`.
- Mutations accumulate in `sync_outbox`; the target drains it when/if a remote
  data plane exists. The core is **backend-agnostic** — an edition with remote
  services registers an adapter via `registerControlPlane`
  ([`control-plane.ts`](../packages/agro-core/src/control-plane.ts)).
- **DuckDB Spatial (WASM)** reads from PGlite for overlays, spatial joins and
  zoning, entirely on-device.

The PGlite schema ([`db/schema.ts`](../packages/agro-core/src/db/schema.ts)) is
**English** (tables/columns) and versioned (`AGRO_LOCAL_SCHEMA_VERSION`).
Migrations are **additive and idempotent** — never rename/drop persisted columns
destructively (users have real data on device).

## How to add …

### … a new feature

1. Create `apps/agro-field-suite/src/modules/<feature>/` and put the domain
   panel(s) + feature-local logic there. Keep only generic UI in `components/`.
2. Add a `FieldPanel` id if it opens as a panel (`@agrogea/core` `types.ts`), and
   wire it in the sidebar / `FieldDashboard`.
3. If it persists data: add the table to `db/schema.ts` (additive migration),
   expose typed CRUD in a `db/dal-*.ts`, add a store action, and add the table
   to the `sync_outbox` allow-list in the sync target.
4. UI strings go through i18n (`src/i18n/locales/*.json`) — never hard-coded.
5. Add a `tests/agro-<feature>.test.ts` suite for any pure logic.

### … a new crop DSS module

Crops are registered in
[`modules/crops/index.ts`](../apps/agro-field-suite/src/modules/crops/index.ts).

1. Create `modules/crops/<crop>/` with `index.ts` (the `CropModule`), `dss.ts`
   (compose the pure engines from `@agrogea/tools`), and `balance.ts` if it has a
   crop-specific water balance.
2. Register the module in `CROP_MODULES` in `crops/index.ts`.
3. Keep the calculation **in `@agrogea/tools`** (pure, tested) — the crop module
   only declares what is crop-specific (its phytopathology DSS, the reference
   phenological species, detail widgets).

## Editions

The Community edition is standalone/offline (`VITE_STANDALONE_MODE=true`,
`LocalOnlySyncTarget`). The core knows no backend; another edition plugs remote
services in through its own `src/edition.ts` via `registerControlPlane`.
