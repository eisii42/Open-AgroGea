# AgroGea Desktop — Auto-Update (Tauri v2 Updater)

> **Versione documento 0.6.1** · aggiornato il 4 ottobre 2026 · allineato ad **AgroGea 0.6**. Le modifiche versione per versione sono nel [CHANGELOG](../../CHANGELOG.md).

L'app desktop open source si aggiorna da sola tramite il **Tauri Updater v2**, con
gli installer ospitati su **GitHub Releases** e un endpoint JSON statico
(`updater.json`) come canale di controllo. Questo documento descrive la
configurazione e il flusso di rilascio.

> **Solo desktop.** Updater e relaunch esistono solo su Windows/macOS/Linux. Su
> Android/iOS gli aggiornamenti passano dagli store: il plugin è perciò compilato
> e registrato unicamente in target desktop (gating in `Cargo.toml`, `lib.rs` e
> nella capability `desktop.json`), così il build mobile non si rompe.

## 1. Componenti

| Livello | File | Ruolo |
|---|---|---|
| Rust | `src-tauri/src/lib.rs` | registra `tauri_plugin_updater` + `tauri_plugin_process` dentro `#[cfg(desktop)]` |
| Rust | `src-tauri/Cargo.toml` | dipendenze gated `cfg(not(any(target_os="android",target_os="ios")))` |
| Config | `src-tauri/tauri.conf.json` | `bundle.createUpdaterArtifacts: true` + `plugins.updater` (endpoints, pubkey) |
| Permessi | `src-tauri/capabilities/desktop.json` | `updater:default` + `process:default`, `platforms` desktop |
| Frontend | `src/hooks/useAppUpdater.ts` | check al boot, download con avanzamento, install + relaunch |
| Frontend | `src/components/UpdateNotice.tsx` | banner discreto con changelog e "Aggiorna ora" |
| Canale | `latest.json` | generato **automaticamente** da `tauri-action` ad ogni release e allegato alla GitHub Release (nessuna pubblicazione manuale) |
| CI | `scripts/set-version.mjs` | inietta la versione dal tag git in `tauri.conf.json`/`package.json`/`Cargo.toml` prima della build (vedi § 6) |
| CI | `.github/workflows/release.yml` | build + firma + pubblicazione release al push di un tag `vX.Y.Z` |

## 2. Chiavi di firma (una tantum)

Il updater **rifiuta** i pacchetti non firmati con la chiave attesa. Generare la
coppia una sola volta:

```bash
npx tauri signer generate -w ~/.tauri/agrogea-updater.key
```

- **Chiave pubblica** (stampata a video): incollarla in
  `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (sostituisce
  `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`).
- **Chiave privata** (`~/.tauri/agrogea-updater.key`) e la sua **password**:
  conservarle in un gestore di segreti / GitHub Actions Secrets. **Non
  committarle mai.**

## 3. Build firmata

Esportare la chiave privata come variabili d'ambiente, poi buildare:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/agrogea-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
npm run build:standalone -w agro-field-suite   # bundle OSS
npx tauri build                                 # installer + file .sig
```

Con `createUpdaterArtifacts: true`, accanto a ogni installer viene prodotto un
file `.sig` (firma minisign del pacchetto).

## 4. Pubblicazione di una release

Il workflow [`release.yml`](../../.github/workflows/release.yml) fa tutto da
solo al push di un tag `vX.Y.Z`:

1. Subito dopo `setup-node`, lo step "Set version from git tag" esegue
   `scripts/set-version.mjs` con il nome del tag (passato tramite variabile
   d'ambiente, mai interpolato nello script), che scrive la versione in
   `tauri.conf.json`, nei due `package.json` e in `Cargo.toml` (dettagli in
   § 6) — **prima** che `tauri-action` builda.
2. Lo step "Release notes" legge **`docs/releases/<tag>.md`** (es.
   `docs/releases/v0.6.0.md`) e lo passa a `tauri-action` come testo della
   Release; se il file manca usa un testo generico. Le note vanno quindi
   scritte e committate **prima** di creare il tag. Dalla v1 `tauri-action`
   riscrive titolo e testo di una Release già esistente: modificarli a mano su
   GitHub prima della fine della build non serve, vengono sovrascritti.
3. Buildare con `tauri-action`, che con `bundle.createUpdaterArtifacts: true`
   firma gli installer (usando i secret `TAURI_SIGNING_PRIVATE_KEY` /
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) e genera `latest.json` con la
   versione appena iniettata e, come `notes`, lo stesso testo della Release:
   è ciò che mostra il banner di aggiornamento nell'app.
4. Crea/aggiorna automaticamente la **GitHub Release** con tag `vX.Y.Z` e vi
   allega tutti gli installer, i file `.sig` **e** `latest.json`.
5. L'endpoint in `tauri.conf.json`
   (`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`)
   risolve a quell'asset — **nessun passaggio manuale**.

> **Attenzione:** l'endpoint `.../releases/latest/download/...` di GitHub
> risolve solo all'ultima release **non marcata prerelease**. Il workflow
> pubblica con `prerelease: false`: mantenerlo così per le release destinate
> agli utenti, altrimenti l'updater non le vedrà mai.

Schema `latest.json` generato (Tauri v2):

```json
{
  "version": "1.0.1",
  "notes": "Changelog mostrato nel banner.",
  "pub_date": "2026-06-30T12:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "<contenuto .sig>", "url": "https://github.com/OWNER/REPO/releases/download/v1.0.1/AgroGea-Suite_1.0.1_x64-setup.exe" }
  }
}
```

## 5. Esperienza utente

All'avvio l'hook `useAppUpdater` chiama `check()` in modo **non intrusivo**: se
il controllo fallisce (offline, updater non configurato) resta silenzioso. Se
trova una versione nuova mostra `UpdateNotice` — un banner con la versione, le
note di rilascio espandibili e il pulsante **Aggiorna ora**. Al clic parte il
download con **barra di avanzamento**; a fine installazione l'app si **riavvia**
automaticamente sulla nuova versione. Nessun download silente.

Non esiste un controllo manuale: la voce «Verifica aggiornamenti» è stata tolta
dal menu Aiuto e dalla finestra Informazioni nella 0.6, perché duplicava il
controllo all'avvio.

> **Piattaforme.** Il job di `release.yml` gira su `windows-latest`: la CI
> produce oggi l'installer **Windows** (e il relativo `latest.json`). Le build
> macOS e Linux si fanno in locale con `npm run tauri:build`; aggiungerle alla
> CI significa estendere il job a una matrice di runner.

## 6. Versionamento

L'updater confronta la `version` di `tauri.conf.json` con quella di
`latest.json`. Il bump di versione è **automatico**: la CI inietta la
versione dal tag git in tutti i file coinvolti, PRIMA che `tauri-action`
builda, tramite [`scripts/set-version.mjs`](../../scripts/set-version.mjs)
(eseguito come step in `release.yml` subito dopo `setup-node`, prima del
build/firma).

Il dev non deve più modificare a mano nessun file di versione: basta creare
e pushare il tag `vX.Y.Z` (semver, es. `v0.3.0`, `v1.0.0-beta.1`).

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Lo script legge la versione dall'argomento CLI (o da `GITHUB_REF_NAME` in
CI), rimuove l'eventuale prefisso `v`, valida che sia semver e la scrive in:

- `apps/agro-field-suite/src-tauri/tauri.conf.json` → `.version`
- `apps/agro-field-suite/package.json` → `.version`
- `package.json` (root) → `.version`
- `apps/agro-field-suite/src-tauri/Cargo.toml` → `version` sotto `[package]`

Se il tag non è semver valida, lo script fallisce (`exit 1`) e il workflow
si interrompe prima di buildare — niente release con versione errata.
