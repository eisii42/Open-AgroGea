# CLAUDE.md - Guida per lo Sviluppo di AgroGea

Questo file fornisce le linee guida e le convenzioni di contesto per Claude Code e altri agenti IA operanti in questa repository. AgroGea è un **hard fork** di GeoLibre (MIT, © Qiusheng Wu): i pacchetti `@geolibre/*` sono **vendorizzati** come fondamenta del prodotto. Il remote `upstream → opengeos/GeoLibre` è mantenuto solo per eventuali `git cherry-pick`, non per merge automatici.

## Repository Shape & Architecture

Monorepo npm workspaces (Node 22+). Contiene **solo** l'edizione Community (standalone) di AgroGea:

### App
- `apps/agro-field-suite/`: unica applicazione (React + Tauri v2), desktop/mobile/web. Build standalone via flag `VITE_STANDALONE_MODE=true` (vedi `apps/agro-field-suite/src/standalone.ts`): sessione locale fissa, nessun login, tutti i moduli agronomici, import/export dati ed export per gli enti di controllo.

### Pacchetti GeoLibre vendorizzati (engine GIS/cartografico, MIT)
- `packages/core/`, `packages/map/`, `packages/ui/`, `packages/plugins/`, `packages/attribute-table/`.

### Pacchetti AgroGea (logica custom)
- `packages/agro-core/`: business logic, store Zustand, DAL **PGlite**, Sync Engine, tipi di dominio.
- `packages/agro-ui/`: componenti del Quaderno di Campagna (shadcn/Tailwind).
- `plugins/agro-tools/`: engine di calcolo **puri** (indici NDVI/NDRE, FAO 56/66, fenologia, suolo).

> Nota: `apps/geolibre-desktop`, `backend/`, `workers/`, `python/`, `e2e/` e i test GeoLibre sono stati **rimossi** nell'hard fork. Non assumerne l'esistenza.

## Architettura dati (local-first)

1. **Storage locale:** ogni azienda ha un'istanza **PGlite** (Postgres WASM) isolata; le modifiche si accumulano in una coda *outbox* (`sync_outbox`). La geometria è GeoJSON in `jsonb` (niente PostGIS in PGlite).
2. **Sync Engine** (`@agrogea/core` `sync/targets.ts`):
   - **Local (standalone, default):** `LocalOnlySyncTarget` no-op — l'outbox resta locale, i dati non lasciano mai il dispositivo.
   - **On-Premise (opzionale):** comando Rust Tauri (`tokio-postgres`) verso un PostgreSQL privato del cliente.
3. **Estensioni di edizione:** il core non conosce alcun backend; un'eventuale edizione con servizi remoti registra un adapter via `registerControlPlane` (`packages/agro-core/src/control-plane.ts`) dal proprio `src/edition.ts`.

## Comandi Principali

Esegui sempre dalla radice del monorepo:

```bash
npm install --legacy-peer-deps                  # i pacchetti interni si linkano via workspace

# Sviluppo
npm run dev:standalone                          # edizione OSS (Vite, porta 5174)
npx tauri dev -w agro-field-suite               # app desktop nativa (Tauri v2)

# Build
npm run build:standalone                        # frontend OSS (.env.standalone)
npm run tauri:build                             # installer nativi (.msi/.exe) — richiede Rust/Cargo

# Qualità
npm run typecheck                               # tsc --noEmit sull'app
npm test                                        # test del dominio agronomico (tests/agro-*.test.ts)
npm run lint
npm run check:rust                              # cargo check sul crate Tauri
```
