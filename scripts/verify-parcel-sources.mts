/**
 * Verifica LIVE del catalogo delle fonti di particelle.
 *
 * Interroga davvero ogni endpoint e controlla due cose che nessun test offline
 * può sapere: che il servizio risponda, e che gli attributi dichiarati in
 * `attributeMap` esistano ancora nei dati che pubblica. Un portale che rinomina
 * una colonna non rompe niente in compilazione — rompe l'acquisizione sul
 * dispositivo di un agricoltore, silenziosamente. Questo script è il modo di
 * accorgersene prima che accada.
 *
 * È l'UNICO punto del repository che tocca la rete: i test e il build non ne
 * fanno mai (requisito §10). Per questo non vive in `tests/` e non gira nel
 * gate di qualità.
 *
 *   node --import tsx scripts/verify-parcel-sources.ts            → verifica e riporta
 *   node --import tsx scripts/verify-parcel-sources.ts --write    → aggiorna lastVerified
 *
 * Uscita diversa da zero se anche una sola fonte non risponde o ha perso un
 * attributo mappato.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARCEL_SOURCE_CATALOG,
  buildOgcApiUrl,
  buildWfsUrl,
  validateCatalog,
  type BBox,
  type ParcelSourceRecord,
} from "@agrogea/parcel";

const CATALOG_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "agro-parcel",
  "src",
  "catalog",
);

/** Un solo elemento basta: serve a leggere i nomi degli attributi, non i dati. */
const PROBE_COUNT = 1;

/** Timeout per richiesta: un portale che non risponde in un minuto è giù. */
const TIMEOUT_MS = 60_000;

/**
 * Riquadro di sonda: il mondo intero. Non sappiamo dove cadano i dati di una
 * fonte — è proprio ciò che il catalogo non dichiara — e chiedere un solo
 * elemento senza restringere l'area è il modo più semplice di farsene dare uno
 * qualsiasi.
 */
const WORLD: BBox = [-180, -90, 180, 90];

interface SourceReport {
  id: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  /** Attributi dichiarati in attributeMap che il servizio non pubblica più. */
  missingAttributes: string[];
}

/** Nomi degli attributi che il record dichiara di leggere dalla fonte. */
function mappedAttributes(record: ParcelSourceRecord): string[] {
  return Object.values(record.attributeMap)
    .map((mapping) =>
      typeof mapping === "string" ? mapping : mapping?.attribute,
    )
    .filter((name): name is string => typeof name === "string");
}

/** URL della richiesta di sonda per il modo di accesso del record. */
function probeUrl(record: ParcelSourceRecord): string | null {
  switch (record.accessType) {
    case "wfs":
      return buildWfsUrl(record, WORLD, { count: PROBE_COUNT, startIndex: 0 });
    case "ogcapi":
      return buildOgcApiUrl(record, WORLD, { limit: PROBE_COUNT });
    default:
      // atom/bulk/gml non hanno ancora un adapter: dichiararli "ok" sarebbe
      // una bugia, "rotti" un falso allarme.
      return null;
  }
}

async function verifySource(record: ParcelSourceRecord): Promise<SourceReport> {
  const url = probeUrl(record);
  if (!url) {
    return {
      id: record.id,
      status: "skipped",
      detail: `modo di accesso "${record.accessType}" non ancora implementato`,
      missingAttributes: [],
    };
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        id: record.id,
        status: "failed",
        detail: `il servizio ha risposto ${response.status}`,
        missingAttributes: [],
      };
    }
    const payload = (await response.json()) as {
      features?: { properties?: Record<string, unknown> }[];
    };
    const feature = payload.features?.[0];
    if (!feature) {
      return {
        id: record.id,
        status: "failed",
        detail: "il servizio ha risposto senza alcuna feature",
        missingAttributes: [],
      };
    }
    const properties = feature.properties ?? {};
    const missing = mappedAttributes(record).filter(
      (name) => !(name in properties),
    );
    return {
      id: record.id,
      status: missing.length === 0 ? "ok" : "failed",
      detail:
        missing.length === 0
          ? "risponde, attributi mappati presenti"
          : "attributi mappati non più pubblicati dal servizio",
      missingAttributes: missing,
    };
  } catch (error) {
    return {
      id: record.id,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
      missingAttributes: [],
    };
  }
}

/** Scrive `lastVerified` nel file JSON della fonte, lasciando il resto com'è. */
function stampVerified(id: string, when: string): void {
  const path = join(CATALOG_DIR, `${id}.json`);
  const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  record.lastVerified = when;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");

  // Prima la validazione strutturale: interrogare la rete per scoprire che un
  // record era malformato sarebbe tempo sprecato.
  const structural = validateCatalog(PARCEL_SOURCE_CATALOG);
  if (structural.length > 0) {
    console.error("Catalogo non valido, verifica interrotta:");
    for (const issue of structural) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`Verifica di ${PARCEL_SOURCE_CATALOG.length} fonti…\n`);
  const reports: SourceReport[] = [];
  // In sequenza e non in parallelo: i portali regionali sono fragili, e questo
  // script non ha alcuna fretta.
  for (const record of PARCEL_SOURCE_CATALOG) {
    const report = await verifySource(record);
    reports.push(report);
    const mark =
      report.status === "ok" ? "✓" : report.status === "skipped" ? "–" : "✗";
    console.log(`${mark} ${report.id}: ${report.detail}`);
    for (const name of report.missingAttributes) {
      console.log(`    attributo mancante: ${name}`);
    }
    if (report.status === "ok" && write) {
      stampVerified(record.id, new Date().toISOString());
    }
  }

  const failed = reports.filter((r) => r.status === "failed");
  const skipped = reports.filter((r) => r.status === "skipped");
  console.log(
    `\n${reports.length - failed.length - skipped.length} ok, ` +
      `${failed.length} in errore, ${skipped.length} saltate.`,
  );
  if (write) {
    console.log("lastVerified aggiornato per le fonti verificate.");
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

await main();
