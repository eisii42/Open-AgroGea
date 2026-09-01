/**
 * Digitalizzazione manuale — la geometria che l'utente disegna a mano.
 *
 * Passa dallo STESSO contratto delle fonti pubbliche, e non è un caso: se il
 * disegno a mano avesse una strada sua, prima o poi due percorsi produrrebbero
 * due forme diverse dello stesso oggetto, e ogni consumatore a valle dovrebbe
 * gestirle entrambe. Qui produce una {@link ManualParcel}, che è un membro
 * dell'unione `Parcel` come gli altri.
 *
 * Non è una fonte interrogabile: `supportsLiveQuery` è `false` e le
 * interrogazioni restituiscono un elenco vuoto — non un errore. È il fatto
 * corretto: nel disegno dell'utente non c'è nulla "da cercare" in un riquadro,
 * ma la fonte esiste ed è enumerabile insieme alle altre senza che chi la usa
 * debba trattarla a parte.
 */
import type { MultiPolygon, Polygon } from "geojson";
import type { IsoAlpha2 } from "./iso-3166";
import type { ManualParcel } from "./parcel";
import type { ParcelSource } from "./source";

/** Identificativo convenzionale della fonte manuale nel registro degli adapter. */
export const MANUAL_SOURCE_ID = "manual";

/** Dati che l'utente (o l'app) fornisce insieme alla geometria disegnata. */
export interface ManualParcelInput {
  /** Geometria disegnata, già in WGS84: viene dalla mappa. */
  geometry: Polygon | MultiPolygon;
  /** Paese in cui ricade il disegno. */
  country: IsoAlpha2;
  /** Nodo NUTS di riferimento. */
  nutsCode: string;
  /** Superficie dichiarata dall'utente, se la indica. */
  declaredArea?: number | null;
  /** Annata a cui il disegno si riferisce. */
  validityYear?: number | null;
}

/** Capacità iniettate per costruire una particella manuale. */
export interface ManualParcelDeps {
  newId: () => string;
  now: () => string;
}

/**
 * Costruisce la particella corrispondente a una geometria disegnata a mano.
 * Nessuna riproiezione: la mappa lavora già in WGS84, quindi non esiste una
 * geometria "originale" diversa da questa — ed è per questo che
 * `originalGeometry` e `originalCrs` restano `null`.
 */
export function createManualParcel(
  input: ManualParcelInput,
  deps: ManualParcelDeps,
): ManualParcel {
  return {
    id: deps.newId(),
    geometry: input.geometry,
    editedGeometry: null,
    referenceUnitType: "manual",
    country: input.country,
    nutsCode: input.nutsCode,
    eligibleArea: null,
    declaredArea: input.declaredArea ?? null,
    validityYear: input.validityYear ?? null,
    nationalCropCode: null,
    hcatCode: null,
    farmFields: [],
    retrievedAt: deps.now(),
    sourceId: null,
    originalGeometry: null,
    originalCrs: null,
    sourceName: null,
    sourceUrl: null,
    license: null,
  };
}

/**
 * La fonte manuale come {@link ParcelSource}, così può stare nello stesso
 * registro delle altre. Non interroga nulla.
 */
export function createManualSource(): ParcelSource {
  return {
    id: MANUAL_SOURCE_ID,
    supportsLiveQuery: false,
    queryByBbox: async () => [],
    queryByPoint: async () => [],
  };
}
