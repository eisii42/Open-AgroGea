/**
 * Inietta la versione ricavata dal tag git (o passata da CLI) in tutti i file
 * di versione del monorepo, PRIMA che `tauri-action` builda l'installer.
 *
 * Motivo: tauri-action legge la `version` da `tauri.conf.json` per generare
 * l'installer e il `latest.json` dell'updater. Se quel campo resta fermo
 * (es. "0.1.0") mentre si pushano tag `vX.Y.Z`, l'updater confronta sempre la
 * stessa versione installata/remota e non propone mai aggiornamenti.
 *
 * Uso:
 *   node scripts/set-version.mjs v0.3.0
 *   node scripts/set-version.mjs            # legge GITHUB_REF_NAME dall'env (CI)
 *
 * File aggiornati (percorsi relativi alla root del repo):
 *   - apps/agro-field-suite/src-tauri/tauri.conf.json  (.version)
 *   - apps/agro-field-suite/package.json               (.version)
 *   - package.json                                     (.version, root)
 *   - apps/agro-field-suite/src-tauri/Cargo.toml        ([package].version)
 *
 * NON tocca `bundle.android.versionCode` in tauri.conf.json (versioning
 * mobile, fuori scope) né le righe `version = "..."` delle dipendenze in
 * Cargo.toml.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER_RE =
  /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Legge un file di testo, errore esplicito se manca. */
function readFileOrThrow(path) {
  if (!existsSync(path)) {
    throw new Error(`File non trovato: ${path}`);
  }
  return readFileSync(path, "utf8");
}

/** Aggiorna il campo `.version` top-level di un file JSON, indent 2. */
function setJsonVersion(path, version) {
  const raw = readFileOrThrow(path);
  const data = JSON.parse(raw);
  data.version = version;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`✓ ${path} → ${version}`);
}

/**
 * Aggiorna SOLO la `version` dentro la sezione `[package]` di Cargo.toml,
 * lasciando intatte le righe `version = "..."` delle dipendenze altrove nel
 * file. La regex cattura dal marker `[package]` fino alla prima occorrenza
 * di `version = "..."` e sostituisce solo quel valore.
 */
function setCargoPackageVersion(path, version) {
  const raw = readFileOrThrow(path);

  if (!/\[package\][\s\S]*?\nversion\s*=\s*"[^"]*"/.test(raw)) {
    throw new Error(
      `Impossibile trovare "version" nella sezione [package] di ${path}`,
    );
  }

  const updated = raw.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]*(")/,
    `$1${version}$2`,
  );

  writeFileSync(path, updated);
  console.log(`✓ ${path} → ${version}`);
}

function main() {
  const rawInput = process.argv[2] ?? process.env.GITHUB_REF_NAME;

  if (!rawInput) {
    console.error(
      "Versione mancante: passa un argomento CLI (es. v0.3.0) oppure imposta GITHUB_REF_NAME.",
    );
    process.exit(1);
  }

  const version = rawInput.replace(/^v/, "");

  if (!SEMVER_RE.test(version)) {
    console.error(
      `Versione non valida: "${version}" (attesa semver, es. 0.3.0 o 0.3.0-beta.1).`,
    );
    process.exit(1);
  }

  const tauriConfPath = join(
    ROOT,
    "apps/agro-field-suite/src-tauri/tauri.conf.json",
  );
  const appPackageJsonPath = join(ROOT, "apps/agro-field-suite/package.json");
  const rootPackageJsonPath = join(ROOT, "package.json");
  const cargoTomlPath = join(
    ROOT,
    "apps/agro-field-suite/src-tauri/Cargo.toml",
  );

  setJsonVersion(tauriConfPath, version);
  setJsonVersion(appPackageJsonPath, version);
  setJsonVersion(rootPackageJsonPath, version);
  setCargoPackageVersion(cargoTomlPath, version);

  console.log(`\nVersione impostata a ${version} in tutti i file.`);
  process.exit(0);
}

main();
