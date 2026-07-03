/**
 * Genera apps/agro-field-suite/THIRD_PARTY_LICENSES.txt — l'avviso di attribuzione
 * delle dipendenze di terze parti distribuite con l'app cloud, con i testi
 * integrali delle licenze.
 *
 * Da rieseguire dopo ogni modifica delle dipendenze:
 *   node scripts/gen-third-party-licenses.mjs
 *   (oppure: npm run licenses:agro)
 *
 * Logica: incrocia la chiusura di PRODUZIONE dell'app (`npm ls`) con la mappa
 * licenze di tutti i pacchetti installati (`license-checker`), esclude i
 * pacchetti propri del monorepo (@geolibre/*, @agrogea/*, app, worker) e
 * antepone la MIT di GeoLibre (componente base). I pacchetti dichiarati ma non
 * installati (peer/optional, es. mapbox-gl) non compaiono: non vengono spediti.
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_WORKSPACE = "agro-field-suite";
const OUT = join(ROOT, "apps", "agro-field-suite", "THIRD_PARTY_LICENSES.txt");

const run = (cmd) =>
  execSync(cmd, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" });

/**
 * Come {@link run}, ma restituisce lo stdout anche se il comando esce con codice
 * ≠ 0. Serve per `npm ls`, che segnala i peer opzionali mancanti con exit 1 pur
 * emettendo un JSON valido e completo sullo stdout.
 */
const runAllowFail = (cmd) => {
  try {
    return run(cmd);
  } catch (err) {
    if (err && typeof err.stdout === "string" && err.stdout.length > 0) {
      return err.stdout;
    }
    throw err;
  }
};

console.log("• Chiusura di produzione dell'app…");
const appTree = JSON.parse(
  runAllowFail(`npm ls -w ${APP_WORKSPACE} --omit=dev --all --json`),
);
console.log("• Mappa licenze dei pacchetti installati…");
const licAll = JSON.parse(run(`npx --yes license-checker --json`));

const appKeys = new Set();
const appNames = new Set();
(function walk(deps) {
  if (!deps) return;
  for (const [name, node] of Object.entries(deps)) {
    appNames.add(name);
    if (node && node.version) appKeys.add(`${name}@${node.version}`);
    walk(node && node.dependencies);
  }
})(appTree.dependencies);

const isOwn = (name) =>
  /^@(geolibre|agrogea)\//.test(name) ||
  /^(geolibre|agro-field-suite)$/.test(name) ||
  /^geolibre-/.test(name);

const picked = [];
for (const [key, info] of Object.entries(licAll)) {
  const name = key.slice(0, key.lastIndexOf("@"));
  if (isOwn(name)) continue;
  if (!appKeys.has(key) && !appNames.has(name)) continue;
  picked.push({ key, info });
}
picked.sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()));

const byLicense = {};
for (const p of picked) {
  const l = String(p.info.licenses ?? "UNKNOWN");
  byLicense[l] = (byLicense[l] ?? 0) + 1;
}
const summary = Object.entries(byLicense)
  .sort((a, b) => b[1] - a[1])
  .map(([l, n]) => `    ${String(n).padStart(5)}  ${l}`)
  .join("\n");

const geolibreMit = readFileSync(join(ROOT, "packages/core/LICENSE"), "utf8").trim();
const today = new Date().toISOString().slice(0, 10);

const head = `================================================================================
 AgroGea Cloud — Note Legali e Licenze di Terze Parti
 (Third-Party Software Notices and Information)
================================================================================

 Titolare / Licenziante: Andrea Carnasciali

 Prodotto:   AgroGea Cloud (edizione commerciale)
 Generato:   ${today}
 Componenti terze parti incluse: ${picked.length}

--------------------------------------------------------------------------------
 Questo prodotto incorpora componenti software di terze parti, ciascuno
 distribuito secondo i termini della propria licenza, riportata per intero qui
 di seguito. Le presenti note sono fornite in adempimento agli obblighi di
 attribuzione di tali licenze. I rispettivi diritti appartengono ai relativi
 autori. Nulla in questo file limita i diritti concessi dalle singole licenze.

 Riepilogo per tipo di licenza:
${summary}
--------------------------------------------------------------------------------

================================================================================
 COMPONENTE BASE — GeoLibre (e moduli @geolibre/*)
 Licenza: MIT
================================================================================
 AgroGea è un'opera derivata di GeoLibre. Il codice GeoLibre incluso (pacchetti
 @geolibre/*) è distribuito secondo la MIT License riportata di seguito.

${geolibreMit}

================================================================================
 DIPENDENZE DI TERZE PARTI (testi integrali)
================================================================================
`;

const blocks = picked.map(({ key, info }) => {
  const lines = [
    "--------------------------------------------------------------------------------",
    key,
    `Licenza: ${info.licenses ?? "UNKNOWN"}`,
  ];
  if (info.repository) lines.push(`Origine: ${info.repository}`);
  if (info.publisher) lines.push(`Autore:  ${info.publisher}`);
  lines.push("");
  let text = "";
  if (info.licenseFile) {
    try {
      text = readFileSync(info.licenseFile, "utf8").trim();
    } catch {
      text = "";
    }
  }
  if (!text) {
    text = `[Testo della licenza non incluso nel pacchetto. Identificatore SPDX dichiarato: ${
      info.licenses ?? "UNKNOWN"
    }. Riferirsi al repository sopra indicato.]`;
  }
  lines.push(text, "");
  return lines.join("\n");
});

const footer = `
================================================================================
 Fine delle note di terze parti — ${picked.length} componenti.
 File generato automaticamente dall'albero di produzione di apps/agro-field-suite.
 Rigenerare dopo ogni modifica delle dipendenze. Da sottoporre a revisione legale
 prima della distribuzione commerciale.
================================================================================
`;

writeFileSync(OUT, head + "\n" + blocks.join("\n") + footer, "utf8");
console.log(`✓ Scritte ${picked.length} componenti in ${OUT}`);
