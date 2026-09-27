/**
 * Contratto `Parcel` — l'unità di riferimento territoriale come la pubblica una
 * fonte ufficiale (LPIS, catasto, tema INSPIRE Land Use), prima che l'azienda ne
 * faccia qualcosa.
 *
 * È **API pubblica**: lo consumano il resto di AgroGea (adozione, quaderno di
 * campagna, export) e i plugin distribuiti a parte (DSS, disciplinari). Si
 * modifica con la stessa cautela di uno schema persistito — vedi
 * {@link PARCEL_SCHEMA_VERSION}.
 *
 * ## Parcel non è Plot
 *
 * Il confine è deliberato e non va sfumato:
 *
 *   * **`Parcel`** — ciò che la FONTE dichiara: una geometria con la sua
 *     provenienza, la sua licenza e la sua annata. Candidata all'adozione,
 *     immutabile nei fatti (non la possediamo noi).
 *   * **`Plot`** (`@agrogea/core`, tabella `plots_registry`) — ciò che l'AZIENDA
 *     ha adottato e coltiva, con i suoi dati agronomici.
 *
 * L'adozione è la transizione fra i due ed è sempre un atto esplicito
 * dell'utente: i livelli LPIS pubblici sono anonimizzati per legge, nessuna
 * pre-popolazione automatica del portafoglio è possibile né lecita.
 *
 * ## Nessun dato agronomico qui dentro
 *
 * Colture, trattamenti, raccolte e rese NON vivono nella particella: stanno
 * nelle entità dedicate (`plots_campaign`, `treatment_logs`, …). {@link
 * ParcelBase.farmFields} porta soltanto degli identificativi, e il tipo
 * (`readonly string[]`) rende impossibile infilarci un payload.
 *
 * Modulo di soli TIPI, costanti e guardie pure: nessuna dipendenza runtime,
 * nessun I/O, nessun framework.
 */
import type { MultiPolygon, Polygon } from "geojson";
import type { IsoAlpha2 } from "./iso-3166";

/**
 * Versione semver del contratto, riportata dal documento di scambio nel suo
 * membro `schemaVersion` di primo livello (non su ogni particella: è una
 * proprietà del file, non del dato).
 *
 * Semantica: MAJOR = un consumatore esistente si rompe; MINOR = campi additivi
 * opzionali; PATCH = solo documentazione o precisazioni di tipo non vincolanti.
 */
export const PARCEL_SCHEMA_VERSION = "1.0.0";

/**
 * Che cosa rappresenta davvero la geometria che l'utente sta adottando.
 *
 * Non è un dettaglio tassonomico: cambia ciò che l'utente può aspettarsi. Un
 * Feldblock tedesco (`physical_block`) è un blocco fisico che può contenere più
 * appezzamenti coltivati diversi; una particella catastale italiana
 * (`cadastral_parcel`) può ospitare due colture; una `agricultural_parcel` è già
 * l'unità colturale dichiarata. L'interfaccia deve dirlo prima dell'adozione, e
 * il modello deve permettere di suddividere in più appezzamenti ciò che è stato
 * adottato come un blocco solo.
 */
export type ReferenceUnitType =
  | "cadastral_parcel"
  | "physical_block"
  | "farmer_parcel"
  | "agricultural_parcel"
  | "manual";

/** Elenco iterabile dei tipi di unità di riferimento (per validatori e UI). */
export const REFERENCE_UNIT_TYPES = [
  "cadastral_parcel",
  "physical_block",
  "farmer_parcel",
  "agricultural_parcel",
  "manual",
] as const;

/** Tipi di unità che provengono da una fonte esterna (tutti tranne `manual`). */
export type SourcedReferenceUnitType = Exclude<ReferenceUnitType, "manual">;

/**
 * Licenza d'uso del dato di origine. Non è un'etichetta da mostrare a schermo e
 * basta: viaggia nei metadati della particella e nel file di scambio, così
 * l'obbligo di attribuzione sopravvive all'export e a chi riceve il backup.
 */
export interface ParcelLicense {
  /** Identificativo SPDX dove esiste (es. `"CC0-1.0"`, `"CC-BY-4.0"`). */
  id: string;
  /** Attribuzione testuale richiesta dalla fonte (es. `"RVO / PDOK"`). */
  attribution: string;
  /** URL del testo di licenza pubblicato dalla fonte, se disponibile. */
  url?: string;
}

/** Campi comuni a ogni particella, quale che sia la sua origine. */
export interface ParcelBase {
  /** UUID interno AgroGea. Nostro, stabile, indipendente dalla fonte. */
  id: string;
  /**
   * Geometria in WGS84 (EPSG:4326), l'unico CRS ammesso dal GeoJSON. È la
   * geometria su cui lavorano mappa e calcoli.
   */
  geometry: Polygon | MultiPolygon;
  /**
   * Rettifica manuale dell'utente, quando il dato ufficiale non combacia col
   * campo reale. `null` finché nessuno interviene: la geometria della fonte
   * resta sempre leggibile in {@link ParcelBase.geometry}, così una correzione
   * non cancella mai ciò che la fonte dichiarava.
   */
  editedGeometry: Polygon | MultiPolygon | null;
  /** Che cosa rappresenta la geometria — vedi {@link ReferenceUnitType}. */
  referenceUnitType: ReferenceUnitType;
  /** Paese del nodo di catalogo di provenienza (ISO 3166-1 alpha-2). */
  country: IsoAlpha2;
  /**
   * Nodo NUTS da cui proviene il dato (es. `"NL"`, `"ITC1"`, `"DE4"`). La
   * granularità del catalogo è il nodo, non lo Stato: gli endpoint reali sono
   * sub-nazionali (un Land, una comunità autonoma, un comune per il catasto).
   */
  nutsCode: string;
  /** Superficie ammissibile a premio in ettari, se la fonte la pubblica. */
  eligibleArea: number | null;
  /** Superficie dichiarata in ettari, se la fonte la pubblica. */
  declaredArea: number | null;
  /** Annata del dato di origine (campagna LPIS), se dichiarata. */
  validityYear: number | null;
  /** Codice coltura nella codifica della fonte, non tradotto. */
  nationalCropCode: string | null;
  /**
   * Traduzione del codice coltura nella tassonomia HCAT (EuroCrops / JRC).
   * Di EuroCrops si prende SOLO la tassonomia: come sorgente di poligoni
   * operativi è un dataset di ricerca, con annate vecchie e senza id stabili.
   */
  hcatCode: string | null;
  /**
   * Identificativi degli appezzamenti aziendali nati da questa particella —
   * SOLO riferimenti. I dati agronomici stanno nelle loro entità: qui non
   * entrano, e il tipo lo impedisce.
   */
  farmFields: readonly string[];
  /** Momento in cui la particella è entrata nel portafoglio (ISO 8601). */
  retrievedAt: string;
}

/**
 * Particella proveniente da una fonte ufficiale. La provenienza è
 * OBBLIGATORIA: il tipo impedisce di costruire una particella acquisita senza
 * dire da dove viene e con quale licenza.
 */
export interface SourcedParcel extends ParcelBase {
  referenceUnitType: SourcedReferenceUnitType;
  /** Identificativo nativo nella fonte (codice catastale, FLIK, id RPG…). */
  sourceId: string;
  /**
   * La geometria come è arrivata dalla fonte, non riproiettata. Si conserva
   * quando la riproiezione ha davvero modificato le coordinate; resta `null`
   * quando la fonte pubblica già in EPSG:4326 e {@link ParcelBase.geometry} è
   * quindi già l'originale, bit per bit.
   */
  originalGeometry: Polygon | MultiPolygon | null;
  /**
   * CRS di origine in forma `"EPSG:<codice>"` (es. `"EPSG:28992"` Paesi Bassi,
   * `"EPSG:6706"` Italia, `"EPSG:31287"` Austria). Forma stringa, non numerica,
   * per combaciare con il campo `crs` del catalogo e con proj4.
   */
  originalCrs: string;
  /** Nome della fonte, come va mostrato e attribuito. */
  sourceName: string;
  /** URL del servizio o della pagina di riferimento della fonte. */
  sourceUrl: string;
  /** Licenza del dato di origine. */
  license: ParcelLicense;
}

/**
 * Particella digitalizzata a mano dall'utente. Passa dallo STESSO contratto
 * delle altre — non è un percorso parallelo — e dichiara l'assenza di
 * provenienza esterna con dei `null` espliciti, così la forma del record (e del
 * file di scambio) resta uniforme.
 */
export interface ManualParcel extends ParcelBase {
  referenceUnitType: "manual";
  sourceId: null;
  originalGeometry: null;
  originalCrs: null;
  sourceName: null;
  sourceUrl: null;
  license: null;
}

/** Unità di riferimento territoriale: acquisita da una fonte, o disegnata a mano. */
export type Parcel = SourcedParcel | ManualParcel;

/** True se la particella è stata disegnata a mano (nessuna provenienza esterna). */
export function isManualParcel(parcel: Parcel): parcel is ManualParcel {
  return parcel.referenceUnitType === "manual";
}

/** True se la particella proviene da una fonte ufficiale (provenienza completa). */
export function isSourcedParcel(parcel: Parcel): parcel is SourcedParcel {
  return parcel.referenceUnitType !== "manual";
}

/** True se il valore è un {@link ReferenceUnitType} noto. */
export function isReferenceUnitType(value: unknown): value is ReferenceUnitType {
  return (
    typeof value === "string" &&
    (REFERENCE_UNIT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Geometria da usare per mappa, calcoli e confronti: la rettifica dell'utente
 * quando c'è, altrimenti quella della fonte. Sta nel contratto e non in ogni
 * consumatore perché "quale delle due vince" è una decisione del contratto: se
 * la prendesse ognuno per conto proprio, prima o poi due moduli mostrerebbero
 * due superfici diverse per lo stesso campo.
 */
export function parcelGeometry(parcel: Parcel): Polygon | MultiPolygon {
  return parcel.editedGeometry ?? parcel.geometry;
}
