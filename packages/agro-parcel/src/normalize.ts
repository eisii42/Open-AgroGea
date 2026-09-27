/**
 * Normalizzazione: da una feature come la pubblica il servizio, alla
 * {@link SourcedParcel} del contratto.
 *
 * È il punto in cui il "paese come dato" diventa vero: qui non c'è una sola
 * riga che sappia di Paesi Bassi, Germania o Italia. Tutto ciò che varia da un
 * portale all'altro entra da {@link ParcelSourceRecord.attributeMap}.
 *
 * Modulo PURO: nessuna rete, nessun orologio, nessun generatore di id — quelle
 * capacità arrivano da {@link NormalizeDeps}, così le fixture salvate dai
 * servizi veri producono risultati identici a ogni esecuzione.
 */
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { SourcedParcel } from "./parcel";
import {
  nutsCountryToIso,
  type ParcelAttributeMapping,
  type ParcelSourceRecord,
} from "./source-record";
import { isPolygonal, type Position2D, type Reprojector } from "./source";

/** CRS in cui il GeoJSON deve stare, per definizione del formato. */
const WGS84 = "EPSG:4326";

/** Capacità iniettate dalla normalizzazione. */
export interface NormalizeDeps {
  reproject: Reprojector;
  /** Genera l'UUID interno della particella. */
  newId: () => string;
  /** Istante di acquisizione (ISO 8601), uguale per tutta l'interrogazione. */
  retrievedAt: string;
  /**
   * Nodo NUTS da attribuire alle particelle. Serve per i record che ne coprono
   * più d'uno (`["DE1", "DE2"]`): la feature non dice da quale nodo provenga, e
   * sceglierne uno a caso sarebbe una provenienza falsa. Chi interroga di solito
   * lo sa — è il nodo che ha cercato. In mancanza si usa il primo del record,
   * che per le fonti a nodo singolo è esatto.
   */
  nutsCode?: string;
}

/** Esito della normalizzazione di una collezione. */
export interface NormalizeResult {
  parcels: SourcedParcel[];
  /**
   * Feature scartate perché inutilizzabili: geometria assente o non poligonale,
   * oppure identificativo nativo mancante. Si contano invece di ignorarle in
   * silenzio — un servizio che cambia tracciato si manifesta così.
   */
  skipped: number;
}

/** True se il CRS della fonte è già quello del GeoJSON. */
function isWgs84(crs: string): boolean {
  return crs.toUpperCase() === WGS84;
}

/**
 * Valore testuale di un attributo, applicando l'eventuale estrazione. `null`
 * quando l'attributo manca, è vuoto, o il `pattern` non combacia: meglio un
 * campo assente di un valore inventato.
 */
export function resolveMapping(
  properties: Record<string, unknown> | null | undefined,
  mapping: ParcelAttributeMapping | undefined,
): string | null {
  if (mapping === undefined || properties == null) return null;
  const attribute = typeof mapping === "string" ? mapping : mapping.attribute;
  const raw = properties[attribute];
  if (raw == null) return null;
  const value = String(raw).trim();
  if (value === "") return null;
  if (typeof mapping === "string") return value;

  let pattern: RegExp;
  try {
    pattern = new RegExp(mapping.pattern);
  } catch {
    // Una regex malformata è già stata respinta da validateSourceRecord: se si
    // arriva qui il catalogo è stato aggirato, e il campo resta vuoto.
    return null;
  }
  const captured = pattern.exec(value)?.[1];
  return captured != null && captured.trim() !== "" ? captured.trim() : null;
}

/** Numero da un attributo mappato, o `null` se assente o non numerico. */
function resolveNumber(
  properties: Record<string, unknown> | null | undefined,
  mapping: ParcelAttributeMapping | undefined,
): number | null {
  const value = resolveMapping(properties, mapping);
  if (value == null) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Anno intero da un attributo mappato, o `null`. */
function resolveYear(
  properties: Record<string, unknown> | null | undefined,
  mapping: ParcelAttributeMapping | undefined,
): number | null {
  const value = resolveNumber(properties, mapping);
  return value != null && Number.isInteger(value) ? value : null;
}

/** Trasforma una singola posizione, scartando l'eventuale quota. */
function reprojectPosition(
  position: Position,
  fromCrs: string,
  reproject: Reprojector,
): Position {
  const point: Position2D = [position[0], position[1]];
  const [lon, lat] = reproject(point, fromCrs);
  return [lon, lat];
}

/**
 * Riproietta una geometria poligonale in WGS84. La traversata degli anelli sta
 * qui — è logica pura e vale per qualunque CRS — mentre la matematica della
 * trasformazione arriva iniettata.
 */
export function reprojectGeometry<T extends Polygon | MultiPolygon>(
  geometry: T,
  fromCrs: string,
  reproject: Reprojector,
): T {
  if (isWgs84(fromCrs)) return geometry;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((position) => reprojectPosition(position, fromCrs, reproject)),
      ),
    };
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) =>
        ring.map((position) => reprojectPosition(position, fromCrs, reproject)),
      ),
    ),
  };
}

/** Feature GeoJSON nella forma minima che ci interessa. */
interface RawFeature {
  geometry?: unknown;
  properties?: Record<string, unknown> | null;
}

/**
 * Converte una feature in una particella, o restituisce `null` se non è
 * utilizzabile (geometria non poligonale, o identificativo nativo assente —
 * senza il quale non si potrebbe deduplicare).
 */
export function featureToParcel(
  feature: RawFeature,
  record: ParcelSourceRecord,
  deps: NormalizeDeps,
): SourcedParcel | null {
  const geometry = feature.geometry;
  if (!isPolygonal(geometry as never)) return null;
  const source = geometry as Polygon | MultiPolygon;

  const properties = feature.properties ?? null;
  const sourceId = resolveMapping(properties, record.attributeMap.sourceId);
  if (sourceId == null) return null;

  const nutsCode = deps.nutsCode ?? record.nuts[0];
  const country = nutsCountryToIso(nutsCode);
  // Un nodo NUTS di un paese sconosciuto non può produrre una particella: il
  // contratto pretende un `country` ISO valido, e inventarlo sarebbe peggio che
  // scartare la feature. `validateSourceRecord` lo intercetta già a monte, qui
  // resta la difesa per un catalogo aggirato.
  if (country == null) return null;

  const nativeCrs = record.crs;
  const alreadyWgs84 = isWgs84(nativeCrs);
  const projected = reprojectGeometry(source, nativeCrs, deps.reproject);

  return {
    id: deps.newId(),
    geometry: projected,
    editedGeometry: null,
    referenceUnitType: record.referenceUnitType,
    country,
    nutsCode,
    eligibleArea: resolveNumber(properties, record.attributeMap.eligibleArea),
    declaredArea: resolveNumber(properties, record.attributeMap.declaredArea),
    validityYear: resolveYear(properties, record.attributeMap.validityYear),
    nationalCropCode: resolveMapping(
      properties,
      record.attributeMap.nationalCropCode,
    ),
    // La traduzione HCAT è un passo a sé (tassonomia EuroCrops/JRC): la fonte
    // pubblica il proprio codice nazionale, non quello armonizzato.
    hcatCode: null,
    farmFields: [],
    retrievedAt: deps.retrievedAt,
    sourceId,
    // Si conserva l'originale solo quando la riproiezione ha davvero cambiato
    // le coordinate: se la fonte pubblica già in WGS84, `geometry` È l'originale
    // e duplicarla peserebbe senza aggiungere tracciabilità.
    originalGeometry: alreadyWgs84 ? null : source,
    originalCrs: nativeCrs,
    sourceName: record.name,
    sourceUrl: record.endpoint,
    license: record.license,
  };
}

/**
 * Normalizza una `FeatureCollection` restituita da un servizio. Accetta un
 * `unknown` perché è ciò che torna dalla rete: la forma si verifica qui, non si
 * dà per buona.
 */
export function normalizeFeatureCollection(
  payload: unknown,
  record: ParcelSourceRecord,
  deps: NormalizeDeps,
): NormalizeResult {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { parcels: [], skipped: 0 };

  const parcels: SourcedParcel[] = [];
  let skipped = 0;
  for (const feature of features) {
    const parcel =
      feature != null && typeof feature === "object"
        ? featureToParcel(feature as RawFeature, record, deps)
        : null;
    if (parcel) parcels.push(parcel);
    else skipped += 1;
  }
  return { parcels, skipped };
}
