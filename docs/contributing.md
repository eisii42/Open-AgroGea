# Contributing

Thanks for your interest in improving AgroGea. This guide covers how to set up
a development environment, the project layout, the local quality gate, and the
pull request workflow. Contributions of all sizes are welcome, from fixing a
typo to adding a new agronomic tool or GIS plugin.

By participating, you agree to keep interactions respectful and constructive.

> AgroGea is a hard fork of [GeoLibre](https://github.com/opengeos/GeoLibre)
> (MIT © Qiusheng Wu): the `@geolibre/*` packages are vendored in as the
> GIS/mapping foundation. This repository is the **Community (Desktop OSS)**
> edition of AgroGea — see [README](../README.md) for an overview of the
> project.

## Ways to contribute

- **Report a bug or request a feature** by opening an
  [issue](https://github.com/eisii42/Open-AgroGea/issues). Include steps to
  reproduce, what you expected, and what happened, plus your OS and whether
  you hit it in the web, desktop, or standalone build.
- **Improve the documentation** under `docs/`.
- **Fix a bug or build a feature** in the app or one of the packages.

If you plan a large change, open an issue first so we can agree on the approach
before you invest time in a pull request.

## Prerequisites

- **Node.js** 22 or newer
- **Rust** toolchain ([rustup](https://rustup.rs/)) for Tauri desktop builds
- Linux only: `webkit2gtk` and `libayatana-appindicator` (see the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

## Set up

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps
```

AgroGea is an npm workspaces monorepo, so a single `npm install` at the root
wires up every package. Use npm; the repository tracks `package-lock.json`.
`--legacy-peer-deps` is required because the internal `@geolibre/*` and
`@agrogea/*` packages are linked via workspaces.

## Run it locally

Cloud edition (web, Vite):

```bash
npm run dev
```

Open <http://localhost:5174>.

Standalone OSS edition (offline, no login):

```bash
npm run dev:standalone
```

Native desktop app (Tauri v2, required for filesystem dialogs, native PGlite
storage, and the Rust sync commands):

```bash
npx tauri dev -w agro-field-suite
```

## Repository layout

```text
apps/agro-field-suite       # React + Tauri v2 app (desktop/mobile/web, both editions)
packages/
  core, map, ui,            # GIS/mapping engine vendored from GeoLibre (MIT)
  plugins, attribute-table
  agro-core                 # Zustand store, PGlite DAL, Hybrid Sync Engine, domain types
  agro-ui                   # Quaderno di Campagna components (shadcn/Tailwind)
plugins/agro-tools           # Pure calculation engines (NDVI/NDRE, FAO 56/66, phenology, soil)
docs/                        # This documentation (plain Markdown)
```

## Development workflow

1. Create a feature branch off `main`. Never commit directly to `main`.

    ```bash
    git switch -c feat/short-description
    ```

2. Make your change, keeping it focused. Match the style of the surrounding
   code rather than introducing new patterns.
3. Run the [quality checks](#quality-checks) and confirm they pass.
4. Commit with a clear message. The history follows a
   [Conventional Commits](https://www.conventionalcommits.org/) style prefix,
   for example `feat:`, `fix:`, `docs:`, `refactor:`, or `chore:`.
5. Push your branch and open a pull request against `main`. Describe what
   changed and why, and link any related issue.

Pull requests are reviewed before merging. Automated reviewers may leave inline
comments; address them or explain why a suggestion does not apply.

## Quality checks

Run from the repository root:

```bash
npm run typecheck   # tsc --noEmit on the app
npm test            # domain/agronomic tests (tests/agro-*.test.ts)
npm run lint         # eslint
npm run check:rust   # cargo check for the Tauri shell
```

You only need the Rust toolchain if you touched `src-tauri`. A docs-only or
frontend-only change does not require it.

### Coding conventions

- Do not edit files in `node_modules`.
- Keep changes scoped to the package they belong to, and prefer reusing the
  shared primitives in `packages/ui` / `packages/agro-ui` and helpers in
  `packages/core` / `packages/agro-core`.
- Match the existing code style (TypeScript, no Prettier/ESLint auto-fix hook
  enforced beyond `npm run lint`).

## License

AgroGea is released under the [GNU AGPLv3](../LICENSE). By contributing, you
agree that your contributions are licensed under the same terms. The vendored
`@geolibre/*` packages remain under their original [MIT License](../packages/core/LICENSE)
(© Qiusheng Wu) — see [NOTICE](../NOTICE).
