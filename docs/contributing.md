# Contributing

Thanks for your interest in improving AgroGea. This guide covers how to set up
a development environment, the project layout, the checks every pull request
goes through, and how dependencies and releases are handled. Contributions of
all sizes are welcome, from fixing a typo to adding a new agronomic tool or
map plugin.

By participating, you agree to keep interactions respectful and constructive.
See the [README](../README.md) for an overview of the project.

## Ways to contribute

- **Report a bug or request a feature** by opening an
  [issue](https://github.com/eisii42/Open-AgroGea/issues). Include steps to
  reproduce, what you expected, and what happened, plus your OS and whether
  you hit it in the desktop app, on a phone or in the web demo.
- **Improve the documentation** under `docs/`.
- **Fix a bug or build a feature** in the app or one of the packages.
- **Report a vulnerability privately** — never in a public issue. See
  [SECURITY.md](../SECURITY.md).

If you plan a large change, open an issue first so we can agree on the approach
before you invest time in a pull request.

## Prerequisites

- **Node.js** 22 or newer
- **Rust** toolchain ([rustup](https://rustup.rs/)) for the native app
- Linux only: WebKitGTK and `libayatana-appindicator` (see the
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

The app in the browser (offline, no login):

```bash
npm run dev:standalone
```

Open <http://localhost:5174>. Resize the window below 768 px (or use the
browser's device toolbar) to get the phone layout.

Native desktop app (Tauri v2, required for filesystem dialogs, the native
tile/parcel fetchers and the Rust sync commands):

```bash
npx tauri dev -w agro-field-suite
```

## Repository layout

```text
apps/agro-field-suite        # React + Tauri v2 app (desktop, mobile, web)
  src/                       # modules/<feature>, components, hooks, lib, i18n, workers
  src-tauri/                 # Rust core: Tauri commands, sync, native fetchers
packages/
  core, map, ui,             # map engine (@geolibre/* namespace, MIT): cartography,
  plugins, attribute-table   #   layer management, map plugins, attribute table
  agro-core                  # Zustand store, PGlite DAL, Sync Engine, domain types
  agro-ui                    # logbook components and UI shell (sheets, panel stack)
  agro-parcel                # Parcel contract and public-source catalogue (zero deps)
plugins/agro-tools           # Pure calculation engines (indices, FAO 56/66, phenology,
                             #   soil, VRA, compliance)
tests/                       # Node test runner suites (tests/agro-*.test.ts)
docs/                        # This documentation (plain Markdown)
  releases/                  # Release notes, one file per tag (vX.Y.Z.md)
.github/                     # CI workflows, Dependabot
.coderabbit.yaml             # automated pull request review
.zap/rules.tsv               # DAST gate (which ZAP findings fail a pull request)
```

Inside the app, domain logic lives in `apps/agro-field-suite/src/modules/<feature>/`
(one folder per functional domain — the "features" layer); `components/` holds
**only** generic, reusable UI. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
full package/feature map, the data flow, the UI shell, the security boundaries
and how to add a feature or crop DSS.

## Development workflow

1. Create a feature branch. Never commit directly to `main`.

    ```bash
    git switch -c feat/short-description
    ```

2. Make your change, keeping it focused. Match the style of the surrounding
   code rather than introducing new patterns. Keep renames and moves in
   separate commits from functional changes.
3. Run the [quality checks](#quality-checks) and confirm they pass.
4. Commit with a clear message. The history follows a
   [Conventional Commits](https://www.conventionalcommits.org/) style prefix,
   for example `feat:`, `fix:`, `docs:`, `refactor:`, `ci:` or `chore:`.
5. Push your branch and open a pull request against `main`. Describe what
   changed and why, and link any related issue. If the change is visible to
   users, update the manuals (`docs/user-guide/`, Italian and English) and add
   a line to the `[Non rilasciato]` section of the [CHANGELOG](../CHANGELOG.md).

## Quality checks

Run from the repository root:

```bash
npm run typecheck   # tsc --noEmit on the app (also checks i18n keys)
npm test            # domain/agronomic tests (tests/agro-*.test.ts)
npm run lint        # eslint
npm run check:rust  # cargo check for the Tauri shell
```

You only need the Rust toolchain if you touched `src-tauri` or its
dependencies. A docs-only or frontend-only change does not require it.

## Pull request checks

Every pull request runs these workflows; they must be green before merging.

| Check | Workflow | What it does |
|---|---|---|
| `check` | `quality.yml` | typecheck, tests, lint |
| `rust` | `quality.yml` | `cargo check --locked` and the Rust unit tests |
| `Secret scanning (gitleaks)` | `sast.yml` | secrets in the commits of the pull request |
| `CodeQL (…)` | `sast.yml` | static analysis, `security-extended` queries, on JavaScript/TypeScript, Rust and GitHub Actions |
| `ZAP baseline` | `dast.yml` | builds the production web bundle and scans it with ZAP |
| `CodeRabbit` | GitHub App | automated review, with four blocking security checks |

`sast.yml` and `dast.yml` run on pull requests to `main`. A pull request with
merge conflicts runs none of the `pull_request` workflows: resolve the conflicts
first.

### Security checks

- **CodeQL.** Findings appear as annotations on the pull request and in
  *Security → Code scanning*. Fix real issues. For a false positive or an
  intentional pattern, use *Dismiss alert* with the right reason (*False
  positive*, *Used in tests*, *Won't fix*) and a one-line justification — the
  repository is public, and the comment is the record of why. The vendored copy
  of the `cookie` crate (`src-tauri/patches/`) is excluded from the analysis.
- **gitleaks.** A real secret must be **revoked or rotated first**: deleting the
  file does not remove it from git history. For a false positive, add its
  fingerprint (shown in the job summary) to a `.gitleaksignore` file at the root.
- **ZAP baseline.** The report is attached to the run as the
  `zap-baseline-report` artifact. Passive rules rated Medium or High fail the
  pull request; the exceptions are listed, with their reason, in
  `.zap/rules.tsv`. Keep `-c .zap/rules.tsv` in `dast.yml`: the action only
  forwards the rules file when it contains an `IGNORE` rule.
- **CodeRabbit.** Its four pre-merge checks (OWASP Top 10, hard-coded secrets,
  weak cryptography, privilege escalation) request changes until they pass.
  Resolve or answer every comment before merging.
- **Untrusted input** (imported files, map services, worker messages, Tauri
  command arguments) must go through the existing boundary helpers listed in
  [ARCHITECTURE.md](ARCHITECTURE.md#security-boundaries) — for example
  `escapeMarkup` / `sanitizeAttribution` before anything reaches an HTML sink.

### Coding conventions

- **Code is English.** File/folder names, variables, functions, types, enums,
  constants, internal object/event keys **and i18n keys/namespaces** are
  English. **UI strings go through i18n** (`src/i18n/locales/*.json`: it, en,
  fr, es), never hard-coded; the Italian catalog is the reference text.
  **Comments keep their current language** (mostly Italian). Use the term
  mapping in [`glossary.md`](glossary.md) for consistency.
- **Casing** follows [`naming-conventions.md`](naming-conventions.md): components
  `PascalCase.tsx`, other files `kebab-case.ts` (hook files `useX.ts`), folders
  `kebab-case`, variables/functions `camelCase`, types/enums `PascalCase`,
  constants `UPPER_SNAKE_CASE`. Enforced (as warnings) by
  `@typescript-eslint/naming-convention` in `npm run lint`.
- **Never anglicize** domain/regulatory terms (`PAN`, `UMA`, `SIAN`, `SIEX`,
  `CUE`, `CUMP`, `BBCH`, `Ky`, `FAO-56`, `FAO-33`, cadastral codes), the
  **persisted PGlite schema** (tables/columns, JSONB keys such as `suolo`),
  string values used as persisted discriminants, or **regulatory export field
  names** — see `CLAUDE.md`.
- **Database migrations are additive and idempotent** (`db/schema.ts`): never
  drop or rename persisted columns — users have real data on their devices.
- Do not edit files in `node_modules` or the vendored `@geolibre/*` packages.
- Keep changes scoped to the package they belong to, and prefer reusing the
  shared primitives in `packages/ui` / `packages/agro-ui` and helpers in
  `packages/core` / `packages/agro-core`. A `.prettierrc.json` documents the
  formatting style.

## Dependency updates

Dependabot opens update pull requests every Monday (npm, Cargo, GitHub Actions),
waiting a few days before proposing a freshly published version.

- **Minor and patch** updates arrive grouped. The **Tauri** packages (`@tauri-apps/*`
  and the `tauri*` crates) and the **MapLibre ecosystem** (MapLibre, its plugins,
  deck.gl) have their own groups: the first must stay in lockstep across npm and
  Cargo, the second is upgraded as one migration.
- **Major** updates arrive one by one and usually need code changes. Comment
  `@dependabot ignore this major version` to close one you are not taking yet.
- **Cargo pull requests**: the `rust` check compiles them; a green check means
  the native app still builds. The offline vault (`argon2` + `aes-gcm`) also has
  a known-answer test on the key derivation and an encrypt/decrypt round trip,
  so an update cannot silently make existing vaults unreadable.
- **`@electric-sql/pglite` is excluded** from automatic updates on purpose: a new
  PGlite major ships a new PostgreSQL major, whose on-disk format cannot open
  the databases already on users' devices. Upgrading it needs a planned data
  migration.
- Unite updates **one at a time**: after each merge Dependabot rebases the
  others and the checks run again.

## Releases

Releases are cut from `main` by the maintainer:

1. Update the [CHANGELOG](../CHANGELOG.md) (Italian) and write the release notes
   in **`docs/releases/vX.Y.Z.md`** (English). Commit both **before** tagging:
   `release.yml` publishes that file as the GitHub Release text and as the
   notes of the in-app update banner.
2. Tag `main` and push the tag:

    ```bash
    git tag -a vX.Y.Z -m "AgroGea X.Y.Z"
    git push origin vX.Y.Z
    ```

3. `release.yml` sets the version from the tag, builds and signs the Windows
   installer and publishes the Release with `latest.json` for the updater.
   Details in [desktop-auto-update.md](technical/desktop-auto-update.md).

## License

AgroGea is released under the [GNU AGPLv3](../LICENSE). By contributing, you
agree that your contributions are licensed under the same terms. The map engine
packages (`packages/core`, `map`, `ui`, `plugins`, `attribute-table`) remain
under their original [MIT License](../packages/core/LICENSE) — see
[NOTICE](../NOTICE).
