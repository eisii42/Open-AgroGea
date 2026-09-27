/**
 * Contratto comune degli adapter di fonte, e le capacità che si fanno iniettare.
 *
 * ## Il pacchetto non tocca la rete, e non conosce la geodesia
 *
 * Due cose che un adapter dovrebbe "saper fare" restano fuori da qui, iniettate
 * dal chiamante:
 *
 *   * **il recupero** ({@link ParcelFetch}) — sotto Tauri il fetch avviene in
 *     Rust, fuori dal sandbox CORS del webview e con concorrenza controllata;
 *     sul web passa dal proxy del dev server. L'adapter costruisce l'URL e
 *     interpreta la risposta, non decide come si arriva in rete.
 *   * **la riproiezione** ({@link Reprojector}) — richiede proj4 e le
 *     definizioni EPSG, che sono peso e dipendenze. Il pacchetto sa CHE le
 *     coordinate vanno trasformate e DA QUALE CRS; non sa come si fa.
 *
 * Il risultato è che il pacchetto resta senza dipendenze runtime e i
 * normalizzatori restano testabili su fixture salvate, senza rete — che è il
 * requisito di qualità §10.
 */
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { Parcel } from "./parcel";

/** Punto in due dimensioni, `[x, y]` nell'ordine del CRS di riferimento. */
export type Position2D = readonly [number, number];

/** Coordinate geografiche WGS84, `[longitudine, latitudine]`. */
export type LngLat = readonly [number, number];

/** Riquadro in WGS84: `[minLon, minLat, maxLon, maxLat]`. */
export type BBox = readonly [number, number, number, number];

/**
 * Trasforma un punto dal CRS della fonte a WGS84 (lon/lat). Una sola direzione:
 * i riquadri di interrogazione viaggiano in CRS84, che i servizi WFS/OGC API
 * accettano nativamente, quindi non serve mai la trasformazione inversa.
 */
export type Reprojector = (point: Position2D, fromCrs: string) => Position2D;

/**
 * Recupera un documento JSON. Riceve un URL già completo e restituisce il JSON
 * decodificato; segnalare gli errori HTTP lanciando è responsabilità
 * dell'implementazione.
 */
export type ParcelFetch = (
  url: string,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

/** Capacità iniettate, comuni a tutti gli adapter di fonte. */
export interface ParcelSourceDeps {
  fetch: ParcelFetch;
  reproject: Reprojector;
  /** Genera l'UUID interno di una particella. */
  newId: () => string;
  /** Istante corrente in ISO 8601. Iniettato per rendere i test deterministici. */
  now: () => string;
}

/** Opzioni di una singola interrogazione. */
export interface ParcelQueryOptions {
  /** Annulla l'interrogazione (propagato al recupero). */
  signal?: AbortSignal;
  /**
   * Tetto di sicurezza sulle particelle da raccogliere. I servizi regionali
   * sono fragili e un riquadro largo può valere centinaia di migliaia di
   * geometrie: meglio troncare che far cadere il servizio o il dispositivo.
   */
  maxFeatures?: number;
  /** Elementi per richiesta nella paginazione. */
  pageSize?: number;
}

/** Avanzamento di un prefetch, per una barra non modale e annullabile. */
export interface ParcelPrefetchProgress {
  done: number;
  total: number | null;
}

/**
 * Una fonte interrogabile di unità di riferimento territoriale. Ogni modo di
 * accesso (WFS, OGC API, ATOM, bulk, GML) ne è un'implementazione; anche la
 * digitalizzazione manuale passa da qui, per non essere un percorso parallelo.
 */
export interface ParcelSource {
  /** Id del record di catalogo che ha prodotto questa fonte. */
  readonly id: string;
  /**
   * `false` quando la fonte non risponde a interrogazioni puntuali sulla rete
   * (digitalizzazione manuale, o dataset che vanno prima scaricati per intero).
   */
  readonly supportsLiveQuery: boolean;
  /** Particelle che intersecano il riquadro, in WGS84. */
  queryByBbox(bbox: BBox, options?: ParcelQueryOptions): Promise<Parcel[]>;
  /**
   * Particelle candidate nel punto indicato. Restituisce un elenco e non un
   * singolo elemento: unità di riferimento sovrapposte esistono, e la scelta
   * finale spetta all'utente.
   */
  queryByPoint(lngLat: LngLat, options?: ParcelQueryOptions): Promise<Parcel[]>;
  /**
   * Scarica in anticipo l'area indicata in una cache locale, per lavorare poi
   * offline. Opzionale: la implementano le fonti che sanno farlo.
   */
  prefetch?(
    area: Geometry,
    onProgress: (progress: ParcelPrefetchProgress) => void,
    options?: ParcelQueryOptions,
  ): Promise<void>;
}

/** Numero di elementi richiesti per pagina quando il chiamante non lo dice. */
export const DEFAULT_PAGE_SIZE = 500;

/** Tetto di default sulle particelle raccolte da una singola interrogazione. */
export const DEFAULT_MAX_FEATURES = 5000;

/**
 * Lato del riquadro (in gradi) costruito attorno a un punto per
 * {@link ParcelSource.queryByPoint}. ~1 m alle latitudini europee: abbastanza
 * per far scattare l'indice spaziale del servizio, abbastanza poco da non
 * riportare i vicini.
 */
export const POINT_QUERY_EPSILON_DEG = 0.00001;

/** Riquadro minuscolo attorno a un punto, per l'interrogazione puntuale. */
export function bboxAroundPoint(
  [lon, lat]: LngLat,
  epsilon: number = POINT_QUERY_EPSILON_DEG,
): BBox {
  return [lon - epsilon, lat - epsilon, lon + epsilon, lat + epsilon];
}

/** True se una geometria è poligonale (l'unica forma che adottiamo). */
export function isPolygonal(
  geometry: Geometry | null | undefined,
): geometry is Polygon | MultiPolygon {
  return (
    geometry != null &&
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
  );
}
