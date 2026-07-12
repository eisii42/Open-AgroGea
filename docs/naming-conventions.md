# Naming conventions

These conventions apply to **all AgroGea code** (the `agro-field-suite` app and
the `@agrogea/*` packages). Vendored `@geolibre/*` packages follow upstream and
are out of scope. See also `docs/glossary.md` for the IT→EN term mapping.

## Language

- **Code is English**: file/folder names, variables, functions, classes, types,
  interfaces, enums, constants, internal object keys, internal event/action
  names — all English.
- **UI strings stay Italian** and must go through i18n
  (`apps/agro-field-suite/src/i18n`), never hard-coded.
- **Comments keep their current language** (Italian). Update a comment only when
  a rename makes it inaccurate.
- **Never translate** domain/regulatory terms: `PAN`, `UMA`, `SIAN`, `SIEX`,
  `CUE`, `CUMP`, `BBCH`, `Ky`, `FAO-56`, `FAO-33`, cadastral abbreviations, etc.
- No cryptic Italian abbreviations; prefer explicit English names.

## Files

| Kind | Convention | Example |
|---|---|---|
| React / UI component files | **PascalCase** `.tsx` | `WaterBalancePanel.tsx` |
| Non-component files (utilities, modules, hooks, stores, DAL) | **kebab-case** `.ts` | `weather-series.ts`, `country-resolution.ts` |
| Hook files | **camelCase**, named exactly as the exported hook | `usePlotsLayer.ts` → export `usePlotsLayer` |
| Test files | kebab-case, existing `agro-*.test.ts` pattern | `agro-warehouse.test.ts` |

> **Hook file note (deliberate exception):** hook files are named exactly as the
> hook they export, in camelCase (`useDssOverlayLayer.ts` → `useDssOverlayLayer`).
> This matches the prevailing React convention and the repo's existing hook
> files, and avoids re-casing already-correct English hook files. It is the one
> exception to the kebab-case rule for non-component files.

## Folders

- **kebab-case**: `water-balance`, `field-logbook`, `crops/grapevine`.

## Identifiers

| Kind | Convention | Example |
|---|---|---|
| Variables, functions, parameters | camelCase | `cropForPlot`, `areaHectares` |
| React hooks | camelCase starting with `use` | `usePlotsLayer` |
| Types, interfaces, enums, React components | PascalCase | `Plot`, `DssPlotResult`, `WaterBalancePanel` |
| Global/module constants | UPPER_SNAKE_CASE | `PAN_DOSE_UNITS`, `DEFAULT_LOCALE` |
| Object keys (internal) | camelCase | `{ cropCategory, quantityOnHand }` |

## Enforcement

- ESLint `@typescript-eslint/naming-convention` enforces the **case** rules
  above in CI (added in the Tooling phase). **Note:** ESLint enforces *casing*,
  not *language* — it cannot detect that `coltura` is Italian. Language
  consistency is enforced by review against `docs/glossary.md`.
- Prettier enforces formatting.
- The DB schema (PGlite) and regulatory export field names (SIAN/PAN, SIEX/CUE,
  EU trace) are **out of scope** for renaming — see `CLAUDE.md` §6.
