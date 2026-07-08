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

## Convenzioni di codice (lingua & naming) — OBBLIGATORIE

Il repository è stato anglicizzato e ristrutturato per l'apertura OSS. **Ogni
nuovo contributo deve nascere già in inglese** e allinearsi alle strutture
esistenti. Riferimenti canonici: [`docs/glossary.md`](docs/glossary.md),
[`docs/naming-conventions.md`](docs/naming-conventions.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Lingua**
- **Codice in inglese fin da subito**: nomi di file/cartelle, variabili,
  funzioni, classi, tipi, interfacce, enum, costanti, chiavi di oggetti/eventi/
  azioni interne. Usa i termini di `docs/glossary.md` (es. `appezzamento→plot`,
  `azienda→company`, `raccolta→harvest`, `trattamento→treatment`,
  `magazzino→warehouse`, `prodotto→product`, `suolo→soil`). Niente nuovi
  identificatori italiani.
- **Stringhe UI in italiano, SEMPRE via i18n** (`apps/agro-field-suite/src/i18n/
  locales/*.json`): mai hard-coded nei componenti.
- **Commenti**: la lingua attuale (italiano) va bene; non è richiesto tradurli.

**Naming/casing** (enforced come warning da `@typescript-eslint/naming-convention`)
- Componenti React → `PascalCase.tsx`; altri file → `kebab-case.ts`; **file hook
  → `useX.ts`** (camelCase = nome dell'hook); cartelle → `kebab-case`.
- Variabili/funzioni `camelCase`; tipi/interfacce/enum/componenti `PascalCase`;
  costanti globali `UPPER_SNAKE_CASE`.

**Struttura** (vedi ARCHITECTURE.md)
- La logica di dominio vive in `apps/agro-field-suite/src/modules/<feature>/`.
  `components/` contiene **solo** UI generica/riusabile: un pannello di dominio
  (es. `WaterBalancePanel`) va nel suo modulo, mai in `components/`.
- Il layer dominio+dati è il pacchetto `@agrogea/core`; gli engine di calcolo
  puri stanno in `@agrogea/tools` (framework-free, testati). `@geolibre/*` è
  vendorizzato: NON modificarlo, è già inglese/upstream.

**NON tradurre / NON rinominare** (eccezioni deliberate, inglese-nel-codice non
si applica):
- Termini normativi/di dominio: `PAN`, `UMA`, `SIAN`, `SIEX`, `CUE`, `CUMP`,
  `BBCH`, `Ky`, `FAO-56`, `FAO-33`, sigle catastali.
- **Schema PGlite persistito** (tabelle/colonne, es. `plots_registry`,
  `area_ha`, `business_name`) e **chiavi metadata JSONB persistite** (es. la
  chiave `suolo` in `plots_registry.metadata`): sui device ci sono dati reali.
  Migrazioni solo **additive/idempotenti** in `db/schema.ts`; mai drop/rename
  distruttivi. Le variabili destrutturate da righe DB restano snake_case.
- **Chiavi i18n** (namespace in `locales/*.json`) e **valori-stringa
  discriminanti/enum interni** (es. `SelectableKind` `"appezzamento"`,
  `FieldPanel` `"quaderno"`/`"raccolta"`, `RiskLevel` `"basso"/"alto"`,
  `CropType` `"viticoltura"`): sono valori accoppiati a UI/persistenza, restano
  come sono (l'identificatore inglese avvolge il valore, il valore no).
- **Nomi dei campi degli export normativi** (SIAN/PAN, SIEX/CUE, tracciato UE):
  invariati come da standard.

**Gate**: prima di ogni PR devono passare `npm run typecheck`, `npm test`,
`npm run lint` (CI: `.github/workflows/quality.yml`). Behavior-preserving:
rinomine/spostamenti separati dalle modifiche funzionali.
