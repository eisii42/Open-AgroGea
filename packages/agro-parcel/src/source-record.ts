/**
 * Record di catalogo di una fonte di particelle, e la sua validazione.
 *
 * Il catalogo è **dato, non codice**: aggiungere una fonte significa aggiungere
 * un file JSON e verificarlo, mai scrivere un modulo. Di conseguenza nulla qui
 * dentro conosce un paese in particolare — le differenze fra portali vivono nei
 * campi del record ({@link ParcelSourceRecord.attributeMap} sopra tutti), non in
 * rami di codice.
 *
 * ## La granularità è il nodo NUTS, non lo Stato
 *
 * Gli endpoint reali sono sub-nazionali: un Land tedesco, una comunità autonoma
 * spagnola, un comune per il catasto italiano. Un record dichiara i nodi che
 * copre in {@link ParcelSourceRecord.nuts}, e la copertura si eredita verso il
 * basso (`"NL"` copre `"NL32"`).
 *
 * ## Perché un validatore scritto a mano
 *
 * Il repository non usa librerie di validazione e le sue verifiche sono funzioni
 * pure che restituiscono un elenco di problemi (vedi `validateProduct` in
 * `@agrogea/core`). Qui vale lo stesso, con una differenza: questi messaggi non
 * finiscono mai davanti a un utente — li leggono i test e la CI — quindi sono
 * testo diretto e non chiavi i18n.
 */
import { isIsoAlpha2 } from "./iso-3166";
import {
  isReferenceUnitType,
  type ParcelLicense,
  type SourcedReferenceUnitType,
} from "./parcel";

/** Modo in cui si interroga la fonte. */
export type ParcelSourceAccessType = "wfs" | "ogcapi" | "atom" | "bulk" | "gml";

/** Elenco iterabile dei modi di accesso (per validatore e UI). */
export const PARCEL_SOURCE_ACCESS_TYPES = [
  "wfs",
  "ogcapi",
  "atom",
  "bulk",
  "gml",
] as const;

/** Modi di accesso che interrogano un tipo di feature nominato. */
const ACCESS_TYPES_WITH_FEATURE_TYPE: readonly ParcelSourceAccessType[] = [
  "wfs",
  "ogcapi",
  "gml",
];

/** Con che ritmo la fonte pubblica una nuova annata. */
export type ParcelSourceUpdateCadence =
  | "annual"
  | "biannual"
  | "quarterly"
  | "monthly"
  | "continuous"
  | "irregular";

/** Elenco iterabile delle cadenze di aggiornamento. */
export const PARCEL_SOURCE_UPDATE_CADENCES = [
  "annual",
  "biannual",
  "quarterly",
  "monthly",
  "continuous",
  "irregular",
] as const;

/**
 * Corrispondenza fra i campi di `Parcel` e i nomi degli attributi nella fonte.
 * È il cuore del "paese come dato": ciò che altrove sarebbe un adapter per
 * nazione, qui è questo oggetto.
 *
 * `sourceId` è l'unico obbligatorio: senza l'identificativo nativo non si può
 * deduplicare né riconoscere una particella già adottata.
 */
export interface ParcelSourceAttributeMap {
  /** Attributo che porta l'identificativo nativo della particella. */
  sourceId: string;
  /** Attributo del codice coltura nella codifica nazionale. */
  nationalCropCode?: string;
  /** Attributo della superficie dichiarata (ettari). */
  declaredArea?: string;
  /** Attributo della superficie ammissibile a premio (ettari). */
  eligibleArea?: string;
  /** Attributo dell'annata di validità del dato. */
  validityYear?: string;
}

/** Chiavi ammesse in {@link ParcelSourceAttributeMap}, per intercettare i refusi. */
const ATTRIBUTE_MAP_KEYS: readonly string[] = [
  "sourceId",
  "nationalCropCode",
  "declaredArea",
  "eligibleArea",
  "validityYear",
];

/** Una fonte di particelle pubblicata da un ente, per uno o più nodi NUTS. */
export interface ParcelSourceRecord {
  /** Identificativo stabile del record, in kebab-case (es. `nl-brp-gewaspercelen`). */
  id: string;
  /**
   * Nodi NUTS coperti dalla fonte. La copertura si eredita verso il basso:
   * `["NL"]` copre l'intero paese, `["DE1", "DE2"]` due Länder soltanto.
   */
  nuts: readonly string[];
  /** Nome della fonte come va mostrato e attribuito. */
  name: string;
  /** Come si interroga. */
  accessType: ParcelSourceAccessType;
  /** URL di base del servizio o del file. */
  endpoint: string;
  /**
   * Tipo di feature da richiedere. Obbligatorio per `wfs`/`ogcapi`/`gml`;
   * `null` per `atom`/`bulk`, dove si scarica un file intero.
   */
  featureType: string | null;
  /** CRS in cui la fonte pubblica le geometrie, forma `"EPSG:<codice>"`. */
  crs: string;
  /** Che cosa rappresentano le geometrie pubblicate da questa fonte. */
  referenceUnitType: SourcedReferenceUnitType;
  /** Licenza del dato, che viaggerà su ogni particella acquisita. */
  license: ParcelLicense;
  /** Corrispondenza fra campi di `Parcel` e attributi della fonte. */
  attributeMap: ParcelSourceAttributeMap;
  /** Ritmo di pubblicazione dichiarato dall'ente. */
  updateCadence: ParcelSourceUpdateCadence;
  /**
   * Momento (ISO 8601) dell'ultima verifica riuscita CONTRO IL SERVIZIO VIVO.
   * `null` significa "mai verificato": il record è una dichiarazione di intenti
   * finché lo script di verifica non lo conferma. Lo aggiorna la verifica, non
   * si scrive a mano.
   */
  lastVerified: string | null;
}

/** Chiavi ammesse in un record, per intercettare i refusi. */
const RECORD_KEYS: readonly string[] = [
  "id",
  "nuts",
  "name",
  "accessType",
  "endpoint",
  "featureType",
  "crs",
  "referenceUnitType",
  "license",
  "attributeMap",
  "updateCadence",
  "lastVerified",
];

/** Problema riscontrato in un record di catalogo. Destinatari: test e CI. */
export interface ParcelSourceIssue {
  /** Percorso del campo, es. `"attributeMap.sourceId"` o `"nuts[0]"`. */
  path: string;
  /** Descrizione diretta del problema. */
  message: string;
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NUTS_PATTERN = /^[A-Z]{2}[A-Z0-9]{0,3}$/;
const CRS_PATTERN = /^EPSG:\d+$/;

/**
 * Codici paese NUTS che NON coincidono con l'ISO 3166-1 alpha-2: Eurostat usa
 * `EL` per la Grecia (ISO: `GR`) e `UK` per il Regno Unito (ISO: `GB`). Senza
 * questa eccezione un record greco valido verrebbe respinto.
 */
const NUTS_ONLY_COUNTRIES: readonly string[] = ["EL", "UK"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** True se `value` è un URL http(s) sintatticamente valido. */
function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** True se il paese di un codice NUTS è un paese reale (ISO, più EL e UK). */
function hasKnownNutsCountry(code: string): boolean {
  const country = code.slice(0, 2);
  return isIsoAlpha2(country) || NUTS_ONLY_COUNTRIES.includes(country);
}

function checkLicense(
  license: unknown,
  issues: ParcelSourceIssue[],
): void {
  if (typeof license !== "object" || license === null) {
    issues.push({ path: "license", message: "licenza mancante o non un oggetto" });
    return;
  }
  const { id, attribution, url } = license as Partial<ParcelLicense>;
  if (!isNonEmptyString(id)) {
    issues.push({
      path: "license.id",
      message: "identificativo di licenza mancante (SPDX dove esiste, es. CC0-1.0)",
    });
  }
  if (!isNonEmptyString(attribution)) {
    issues.push({
      path: "license.attribution",
      // L'attribuzione è un obbligo che viaggia col dato, non un ornamento:
      // finisce nei metadati di ogni particella e nel file di scambio.
      message: "attribuzione mancante",
    });
  }
  if (url !== undefined && !isHttpUrl(url)) {
    issues.push({ path: "license.url", message: "url di licenza non valido" });
  }
}

function checkAttributeMap(
  attributeMap: unknown,
  issues: ParcelSourceIssue[],
): void {
  if (typeof attributeMap !== "object" || attributeMap === null) {
    issues.push({
      path: "attributeMap",
      message: "attributeMap mancante o non un oggetto",
    });
    return;
  }
  const entries = Object.entries(attributeMap as Record<string, unknown>);
  const known = new Set(ATTRIBUTE_MAP_KEYS);
  for (const [key, value] of entries) {
    if (!known.has(key)) {
      issues.push({
        path: `attributeMap.${key}`,
        message: `campo non mappabile (ammessi: ${ATTRIBUTE_MAP_KEYS.join(", ")})`,
      });
      continue;
    }
    if (!isNonEmptyString(value)) {
      issues.push({
        path: `attributeMap.${key}`,
        message: "nome di attributo vuoto o non testuale",
      });
    }
  }
  if (!isNonEmptyString((attributeMap as ParcelSourceAttributeMap).sourceId)) {
    issues.push({
      path: "attributeMap.sourceId",
      message:
        "obbligatorio: senza identificativo nativo non si può deduplicare una particella",
    });
  }
}

/**
 * Verifica STRUTTURALE di un record di catalogo: forma, tipi, vocabolari
 * chiusi, coerenza fra `accessType` e `featureType`. Non tocca la rete — che
 * l'endpoint risponda davvero e che gli attributi mappati esistano lo accerta
 * lo script di verifica live, che è ciò che poi valorizza `lastVerified`.
 *
 * Restituisce l'elenco COMPLETO dei problemi (vuoto = record valido): chi
 * aggiunge una fonte li vede tutti in una volta, invece che uno per tentativo.
 */
export function validateSourceRecord(raw: unknown): ParcelSourceIssue[] {
  const issues: ParcelSourceIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [{ path: "", message: "il record non è un oggetto JSON" }];
  }
  const record = raw as Record<string, unknown>;

  // `$schema` è un puntatore per l'editor, non un campo del contratto.
  for (const key of Object.keys(record)) {
    if (key !== "$schema" && !RECORD_KEYS.includes(key)) {
      issues.push({ path: key, message: "campo sconosciuto" });
    }
  }

  if (!isNonEmptyString(record.id)) {
    issues.push({ path: "id", message: "identificativo mancante" });
  } else if (!ID_PATTERN.test(record.id)) {
    issues.push({
      path: "id",
      message: "deve essere kebab-case minuscolo (es. nl-brp-gewaspercelen)",
    });
  }

  if (!Array.isArray(record.nuts) || record.nuts.length === 0) {
    issues.push({ path: "nuts", message: "serve almeno un nodo NUTS coperto" });
  } else {
    record.nuts.forEach((node, i) => {
      if (!isNonEmptyString(node) || !NUTS_PATTERN.test(node)) {
        issues.push({
          path: `nuts[${i}]`,
          message: "codice NUTS non valido (2 lettere maiuscole + fino a 3 caratteri)",
        });
        return;
      }
      if (!hasKnownNutsCountry(node)) {
        issues.push({
          path: `nuts[${i}]`,
          message: `paese "${node.slice(0, 2)}" sconosciuto`,
        });
      }
    });
  }

  if (!isNonEmptyString(record.name)) {
    issues.push({ path: "name", message: "nome della fonte mancante" });
  }

  const accessType = record.accessType;
  if (
    !isNonEmptyString(accessType) ||
    !(PARCEL_SOURCE_ACCESS_TYPES as readonly string[]).includes(accessType)
  ) {
    issues.push({
      path: "accessType",
      message: `modo di accesso sconosciuto (ammessi: ${PARCEL_SOURCE_ACCESS_TYPES.join(", ")})`,
    });
  }

  if (!isHttpUrl(record.endpoint)) {
    issues.push({ path: "endpoint", message: "endpoint non è un URL http(s) valido" });
  }

  // featureType e accessType si vincolano a vicenda: un WFS senza tipo di
  // feature non è interrogabile, un download ATOM non ne ha uno.
  const needsFeatureType =
    isNonEmptyString(accessType) &&
    ACCESS_TYPES_WITH_FEATURE_TYPE.includes(accessType as ParcelSourceAccessType);
  if (needsFeatureType && !isNonEmptyString(record.featureType)) {
    issues.push({
      path: "featureType",
      message: `obbligatorio con accessType "${accessType}"`,
    });
  }
  if (
    !needsFeatureType &&
    record.featureType !== null &&
    record.featureType !== undefined
  ) {
    issues.push({
      path: "featureType",
      message: `deve essere null con accessType "${String(accessType)}"`,
    });
  }

  if (!isNonEmptyString(record.crs) || !CRS_PATTERN.test(record.crs)) {
    issues.push({ path: "crs", message: 'atteso il formato "EPSG:<codice>"' });
  }

  if (!isReferenceUnitType(record.referenceUnitType)) {
    issues.push({
      path: "referenceUnitType",
      message: "tipo di unità di riferimento sconosciuto",
    });
  } else if (record.referenceUnitType === "manual") {
    issues.push({
      path: "referenceUnitType",
      // "manual" è la digitalizzazione dell'utente: per definizione non esce da
      // una fonte pubblica.
      message: '"manual" non è un valore ammesso per una fonte di catalogo',
    });
  }

  checkLicense(record.license, issues);
  checkAttributeMap(record.attributeMap, issues);

  const cadence = record.updateCadence;
  if (
    !isNonEmptyString(cadence) ||
    !(PARCEL_SOURCE_UPDATE_CADENCES as readonly string[]).includes(cadence)
  ) {
    issues.push({
      path: "updateCadence",
      message: `cadenza sconosciuta (ammesse: ${PARCEL_SOURCE_UPDATE_CADENCES.join(", ")})`,
    });
  }

  const lastVerified = record.lastVerified;
  if (lastVerified !== null) {
    if (
      !isNonEmptyString(lastVerified) ||
      Number.isNaN(Date.parse(lastVerified))
    ) {
      issues.push({
        path: "lastVerified",
        message: "atteso null oppure un istante ISO 8601",
      });
    }
  }

  return issues;
}

/**
 * Valida un intero catalogo: ogni record, più l'unicità degli `id` — che è un
 * vincolo del catalogo nel suo insieme e non del singolo file, quindi nessuna
 * validazione per-record potrebbe accorgersene.
 *
 * I percorsi dei problemi sono prefissati con l'id del record (o con la sua
 * posizione, se l'id manca), così l'output della CI dice subito quale file
 * aprire.
 */
export function validateCatalog(
  records: readonly unknown[],
): ParcelSourceIssue[] {
  const issues: ParcelSourceIssue[] = [];
  const seen = new Set<string>();

  records.forEach((record, i) => {
    const id = (record as { id?: unknown } | null)?.id;
    const label = isNonEmptyString(id) ? id : `[${i}]`;
    for (const issue of validateSourceRecord(record)) {
      issues.push({
        path: issue.path === "" ? label : `${label}.${issue.path}`,
        message: issue.message,
      });
    }
    if (isNonEmptyString(id)) {
      if (seen.has(id)) {
        issues.push({ path: id, message: "identificativo duplicato nel catalogo" });
      }
      seen.add(id);
    }
  });

  return issues;
}
