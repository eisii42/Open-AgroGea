# Architecture

> **Document version 0.6.1** · updated 4 October 2026 · aligned with **AgroGea 0.6** (local PGlite schema **v25**).

AgroGea is a **local-first** agronomic GIS suite: an npm workspaces
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
  agro-ui                  @agrogea/ui — logbook components and the UI shell
                             primitives (FieldSheet, DrawerSlot + drawer stack,
                             sheet/menu/modal/Esc hooks)
  agro-parcel              @agrogea/parcel — LEAF package, zero runtime deps:
                             the Parcel contract, the source catalogue (JSON,
                             one file per source) and the WFS/OGC API/manual
                             adapters. Never depends on @agrogea/core
plugins/agro-tools         @agrogea/tools — pure calculation engines (spectral
                             indices, FAO 56/66 water balance, phenology,
                             phytopathology, Saxton-Rawls soil, VRA zoning)
docs/                      Contributor & user documentation
tests/                     Node test runner suites (tests/agro-*.test.ts)
```

`@agrogea/parcel` is the only package other repositories are expected to
consume on its own (the DSS/disciplinari plugins read the `Parcel` contract),
which is why it carries no runtime dependencies and why the dependency arrow
only ever points *from* `@agrogea/core` *to* it — never back.

`@agrogea/core` is the **domain + data layer** (the app's `data/` and `domain/`
rolled into a package). `@agrogea/tools` holds **pure, framework-free** math and
is the most heavily unit-tested code. `@geolibre/*` is vendored and English
already — leave it as upstream.

## App structure (`apps/agro-field-suite/src`)

```text
app entry     main.tsx, App.tsx, standalone.ts, edition.ts, index.css
modules/      ONE folder per functional domain (the "features" layer):
                water-balance, warehouse, field-logbook, registry, settings,
                weather, soil, compliance, crops, dss, vra, sian,
                print, colorbar, command-palette, add-data, team,
                analytics (Command Center: composable charts + user-composed
                  KPI cards, persisted per company in localStorage),
                calendar (third top-level view: one month grid over tasks,
                  operations, harvests, DSS risk, water stress + daily weather),
                tasks (task/recipe planning), field-mode (geofencing +
                  low-touch in-field screens), plot-sheet (per-parcel dossier:
                  planned tasks + recorded operations),
                parcel-adoption (search public parcel sources, adopt one
                  at a time), onboarding (first launch: new company or
                  restore from backup), attention ("To do" centre: one list
                  built from the existing completeness/expiry/alert engines)
components/    ONLY generic, reusable UI + map/field infrastructure
              (AppHeader, AccountMenu, HeaderSearch, ModuleSidebar,
               DesktopMapTools/Fabs, MobileMapTools/Fabs, MobileBottomNav,
               MobileAppMenu, MapLayersSheet, DataEntrySheet, …)
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
  data plane exists. The core is **backend-agnostic** — remote services can be
  plugged in through an adapter registered via `registerControlPlane`
  ([`control-plane.ts`](../packages/agro-core/src/control-plane.ts)).
- **DuckDB Spatial (WASM)** reads from PGlite for overlays, spatial joins and
  zoning, entirely on-device.
- Some tables are **local-only and recomputable** — `dss_results`,
  `soil_water_indices`, `field_session_audio`, and (v21) the vegetation-index
  cache `vegetation_index_scenes` / `vegetation_index_rasters`. They never enter
  `sync_outbox`: derived output that the device can rebuild does not belong in a
  mutation queue. The index cache stores the **raster** (scaled Int16, base64)
  rather than the GeoJSON cells — ~2 bytes/pixel instead of ~300 — and
  `rasterToIndexCells` rebuilds the geometry on demand.

- **Adopted parcels carry their provenance** (v22). `plots_registry.source_id`,
  `nuts_code`, `reference_unit_type` and `validity_year` are real columns (a
  unique index on them deduplicates adoptions), while the display-only
  provenance — source name/URL, licence and attribution, original CRS, the
  geometry as published — lives in `metadata.parcel`. The SIAN dossier import
  fills the same columns, so no path produces a plot without queryable origin.
  Network access for sources goes through the native Rust transport
  (`src-tauri/src/parcel_source.rs`: host allow-list built from the catalogue,
  non-public addresses blocked, redirects re-checked).

- **Warehouses are places, lots carry the location** (v23). `warehouses` is a
  synced domain table with an optional `geometry` (a GeoJSON `Point`: present, it
  becomes a clickable POI on the map); the stock lives in `product_lots`, so it
  is the **lot** that holds `warehouse_id`, not the product registry. That is
  what lets the same product sit in two stores with different expiries without
  duplicating the registry, and why deleting a store only unassigns its lots.
  The column is nullable: lots loaded before v23 need no data migration.

- **Certification belongs to the operator, the production regime to the campaign
  year** (v24). `companies.operator_certifications` (jsonb array) holds the
  structured certification issued to the *company* by a control body — scheme,
  operator code, certificate number, validity — while
  `plots_campaign.production_regime` / `regime_since` / `regime_notes` record what
  a *plot* was grown under **in a given year**: on `plots_registry` you could not
  say "organic since 2024" without overwriting the past. `null` stays `null`: no
  module infers "conventional" from silence. The old
  `companies.certifications text[]` is **deprecated but not dropped** (real data on
  device) and nothing writes it any more — see
  [`operator-certification-and-production-regime.md`](technical/operator-certification-and-production-regime.md).

- **Compliance monitoring stores choices, not verdicts** (v25). The regulatory
  cards produce **self-assessment**, never an official verdict — area monitoring
  (AMS, EU Reg. 2021/2116 art. 66) belongs to the Paying Agency. Card *outcomes*
  have no table at all: they are recomputable from the cached scenes and the
  logbook, like `dss_results`. What is persisted and synced is
  `compliance_parameter_overrides` — the thresholds the user moved away from the
  regulatory defaults — because losing those in a restore would silently change
  the outcomes. Pure engines live in
  [`@agrogea/tools/compliance`](../plugins/agro-tools/src/compliance/); see
  [`compliance-monitoring.md`](technical/compliance-monitoring.md).
- **Raster sources** — WMS layers added by URL and user-supplied GeoTIFF
  orthophotos share one loading path in *Add data*; the orthophoto is read once
  and reused by the GAEC 8 card. A WMS added by URL is **saved per company** and
  becomes a basemap option (it replaces the satellite while active), editable
  and deletable from *Add data*. See
  [`raster-sources.md`](technical/raster-sources.md).

The PGlite schema ([`db/schema.ts`](../packages/agro-core/src/db/schema.ts)) is
**English** (tables/columns) and versioned (`AGRO_LOCAL_SCHEMA_VERSION`).
Migrations are **additive and idempotent** — never rename/drop persisted columns
destructively (users have real data on device).

**Rows are normalized on the way out of the DAL**, so the domain types are true:
what you read back is what the type declares. PGlite itself returns `Date` for
`timestamptz`/`date` and `string` for `numeric` — the opposite of what
`TreatmentLog.executed_at: string` and `total_quantity: number` say.
[`db/row-mapping.ts`](../packages/agro-core/src/db/row-mapping.ts) converts by
the driver-reported column OID (not a hand-maintained column list), and
`AgroDalBase` wraps the connection **once** so every read path is covered —
subclasses, `rawQuery`, and `tx.query` inside transactions alike.

> Consequence for tests: a row built in TypeScript already has the right types
> and proves nothing about this. Any test guarding the boundary must assert
> against a row **actually read back from the database**.

## UI shell (0.6)

The same component tree serves phone and desktop; `useNarrowViewport` picks the
layout. What is not obvious from the components alone:

- **Panels are a stack, not a single slot.** On desktop the store runs with
  `panelMode: "floating"`: `openPanels` keeps several ids, each rendered in a
  `DrawerSlot` (`@agrogea/ui`) inside the right-hand dock. `drawer-stack.ts`
  orders them — the latest on top, the others collapsed to their header — and
  re-selecting an open module brings it to the front. On a phone
  `panelMode` stays `"docked"` (one panel at a time, as a bottom sheet).
- **The dock width is a per-device preference**, not domain data:
  `useDrawerResize` keeps it in `localStorage` (`agrogea.drawerWidth`,
  360–560 px). Map controls, overlays and the map padding read the same value,
  so nothing ends up under the dock.
- **Esc has one owner.** `useEscapeDismiss` keeps a shared stack, so Esc closes
  only the topmost element (menu → dialog → panel). Hand-made dialogs go
  through `useModalBehavior` (Esc, focus trap, focus restore), menus through
  `useMenuKeyboard`, sheets through `useSheetDrag` (three snap heights) and
  `useBackDismiss` (Android back button, armed only while a sheet is open).
- **Two reversible choices are constants, not settings**: the desktop icon rail
  (`DESKTOP_MODULE_NAV` in `FieldDashboard`, `"rail"` or `"list"`) and the 12 px
  minimum text size (a rule in `index.css`).
- **The "To do" centre has no engine of its own.** `useAttentionItems` only
  collects what the existing engines already say — logbook and task
  completeness, campaign declarative data, lot expiry, machinery attention,
  missing soil data — so it can never disagree with the badges and map markers
  that use the same engines.
- **Editing a logbook operation updates the same row** (`updateTreatment`); the
  store's `openLogbookOperation(id)` / `consumeLogbookEdit()` let any view (the
  "To do" centre, the plot sheet) open an operation directly in edit mode.
  Warehouse discharges and machine hours are not re-applied on edit.

## Security boundaries

AgroGea has no server of its own, so the trust boundaries are inside the app.
Each one has a single place where untrusted data is handled:

| Untrusted input | Where it is handled |
|---|---|
| Map attributions (WMS service titles from external `GetCapabilities`, remote styles, plugins) | `hooks/useLayerAttributions.ts` + `lib/escape-markup.ts`: company layers are escaped to plain text, every other source is reduced to text and `http(s)` links (`sanitizeAttribution`) before MapLibre renders it as HTML. MapLibre 5.x's own sanitizer is bypassable (CVE-2026-85061). |
| User text in the print layout | `modules/print/print-layout.ts` escapes every value into the SVG; the print window is built with DOM APIs (title as text, layout as an `<img>`), never `document.write`. |
| Messages to the index worker | `workers/soil.worker.ts` ignores foreign origins and accepts only known index names (`isVegetationIndex`) before they become object keys. |
| Tauri commands (anything running in the webview can call them) | `src-tauri/src/agro.rs` `agro_fetch_map_tile`: http(s) only, 30 s timeout, at most 5 redirects, 16 MB cap. `parcel_source.rs`: host allow-list from the catalogue, non-public addresses blocked, redirects re-checked. |
| Private PostgreSQL sync | `normalize_sslmode` in `agro.rs`: libpq semantics (missing `sslmode` = `prefer`), `verify-ca`/`verify-full` really verify the certificate, unknown values are rejected instead of falling back to plaintext. |
| Offline PIN vault | Argon2id (m = 19 MiB, t = 2, p = 1) → AES-256-GCM with a random salt and nonce from the OS RNG. A known-answer test pins the key derivation, so a dependency update cannot make existing vaults unreadable. |

The repository side (CodeQL, gitleaks, ZAP baseline, CodeRabbit, Dependabot) is
described in [`contributing.md`](contributing.md#security-checks) and
[`SECURITY.md`](../SECURITY.md).

## Field Mode (geofencing → logbook)

The low-touch operator flow spans several layers, so the seams matter:

```text
useGeofenceWatch (the ONLY navigator.geolocation watch in the app)
  → advanceGeofence  (pure reducer: dwell debounce, exit hysteresis)
    → store geofenceDetection → FieldDetectionModal (matches planned_tasks)
      → startFieldSession      (atomic: session + task → IN_PROGRESS)
        → InFieldDashboard + useFieldSessionTracking (batched path writes)
        → SessionCompletionSheet (the operator DECLARES the % of the parcel
                                  completed: that is the area quantities and
                                  stock issues are computed on)
          → completeFieldSession (atomic: treatment_logs + lot issues +
                                  session/task → COMPLETED or back to PLANNED
                                  with metadata.completion_percent, idempotent)
            → PostOperationSummary (notification of what was written)
```

Non-obvious constraints, each with a reason:

- **Detection is automatic**: no toggle, no map button, no settings flag. The
  operator entering a field must not have to remember to arm it.
- There must remain **exactly one GPS watch**. Per-sample values stay in local
  React state and reach the in-field screen through a module-level pub/sub
  ([`live-sample-channel.ts`](../apps/agro-field-suite/src/modules/field-mode/live-sample-channel.ts)),
  **never** the Zustand store — samples arrive at ~1 Hz and the store is shared
  with the MapLibre canvas.
- The map's native geolocate control cannot be reused as the sensor:
  `MapController.geolocateControl` is private in vendored `@geolibre/map`.
- Writing to the logbook is **automatic and unconfirmed**, so the closing
  transaction is atomic *and* idempotent (status re-read inside the transaction):
  a half-write or a double tap would corrupt a legally-relevant register with
  nobody watching. Completeness is therefore enforced *upstream*, at planning
  time ([`field/task-completeness.ts`](../packages/agro-core/src/field/task-completeness.ts)).
- Quantities come from the **declared** worked area — `(declared % − already
  recorded %) × parcel area` — not from a GPS estimate. Up to 0.4.0 it was
  `track_length × working_width`; that promised a precision the GPS does not
  have (it depends on the implement's recorded width, inflates on overlapping
  passes, collapses to zero on a poor fix). The track is still recorded, it just
  no longer sizes the register. Falling back to `plots_registry.area_ha` is
  allowed but always **flagged** in the summary.
- **Partial progress does not close the task**: below 100% it returns to
  `PLANNED` carrying `metadata.completion_percent`, so the next entry resumes
  where it stopped and the same hectares are never dosed twice.
- `InFieldDashboard` is the one component that deliberately **ignores the app
  theme** (fixed black/lime palette): it is a sunlight-readable driving
  instrument, not a themed panel.
- **Detection must never fail silently.** A sample discarded for poor accuracy
  is reported back (`advanceGeofence` returns `accepted`) so the UI can say
  "signal too weak" instead of "listening"; a denied permission clears the
  watch so it can actually restart, and the hook re-arms itself through the
  Permissions API. Every dead end has a visible state and a way out.
- **Two scopes, two panels, on purpose.** `plot-sheet` is the per-parcel view
  (its tasks and its operations); the Logbook opened from the module rail is the
  whole-farm register and resets its filters via `logbookScopeToken`. A
  compliance register must not be able to show a subset without saying so, and
  keeping them as one panel with a mode flag made that a one-line mistake away.

## How to add …

### … a new feature

1. Create `apps/agro-field-suite/src/modules/<feature>/` and put the domain
   panel(s) + feature-local logic there. Keep only generic UI in `components/`.
2. Add a `FieldPanel` id if it opens as a panel (`@agrogea/core` `types.ts`), and
   wire it in `ModuleSidebar` (desktop rail flyout and phone module grid) and
   `FieldDashboard` (a `DrawerSlot` in the dock).
3. If it persists data: add the table to `db/schema.ts` (additive migration),
   expose typed CRUD in a `db/dal-*.ts`, add a store action, and add the table
   to the `sync_outbox` allow-list in the sync target.
4. UI strings go through i18n (`src/i18n/locales/*.json`, English keys) — never
   hard-coded.
5. Add a `tests/agro-<feature>.test.ts` suite for any pure logic.

### … a new parcel source (a new country or region)

This must stay **data, not code**. If adding a source ever requires writing a
module, the abstraction is wrong and should be fixed instead.

1. Drop a JSON record in `packages/agro-parcel/src/catalog/<id>.json` (copy an
   existing one; `source.schema.json` next to it drives editor completion) and
   add one `import` line to `catalog.ts`. One file per source so the live
   verification can stamp `lastVerified` on it without rewriting the catalogue.
2. `nuts` lists the nodes covered, and coverage is inherited downwards: `"NL"`
   answers for `"NL32"`. The granularity is the **NUTS node, not the state** —
   real endpoints are sub-national (a German Land, a Spanish comunidad, an
   Italian comune for the cadastre).
3. `attributeMap` is where the differences between portals live. Each field is
   either an attribute name or `{ attribute, pattern }` when the value must be
   extracted — INSPIRE-harmonised services publish the crop code as the last
   segment of a codelist URI, and that is the whole reason the extended form
   exists.
4. `license.attribution` is mandatory and travels with every adopted parcel
   into `plots_registry.metadata` and into the exchange file. It is an
   obligation, not a caption.
5. Leave `lastVerified: null` and run `npm run verify:sources`. It queries the
   real endpoint and checks that the mapped attributes still exist — the only
   check that can catch a portal renaming a column, which breaks nothing at
   compile time and everything on a farmer's device.

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

## Extension point: remote services

AgroGea runs offline by default (`VITE_STANDALONE_MODE=true`,
`LocalOnlySyncTarget`). The core knows no backend: remote services, if ever
needed, plug in from `src/edition.ts` via `registerControlPlane`. The
identifiers keep their historical names; there is a single AgroGea.
