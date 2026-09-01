/**
 * Adapter WFS 2.0.0 — il modo di accesso più diffuso fra i geoportali europei.
 *
 * Due scelte dettate dal comportamento reale dei servizi, non dallo standard:
 *
 *  1. **Il riquadro viaggia in CRS84.** WFS 2.0 con `EPSG:4326` impone l'ordine
 *     assi latitudine-longitudine, che è la sorgente classica di riquadri
 *     ribaltati e risposte vuote. `urn:ogc:def:crs:OGC:1.3:CRS84` è lo stesso
 *     sistema con l'ordine longitudine-latitudine, senza ambiguità. Così non
 *     serve nemmeno la riproiezione inversa del riquadro.
 *  2. **La paginazione si ferma sul "meno del richiesto".** L'uscita GeoJSON di
 *     PDOK non riporta `numberReturned`/`numberMatched` (verificato sul
 *     servizio, vedi le fixture), quindi non si può contare su di essi. Quando
 *     ci sono, li si usa per fermarsi prima.
 *
 * La geometria si chiede nel CRS NATIVO della fonte, non già riproiettata: è
 * quella che si conserva in `originalGeometry`, ed è la tracciabilità che il
 * §2.4 chiede. La conversione in WGS84 la fa il normalizzatore.
 */
import type { Parcel } from "./parcel";
import {
  normalizeFeatureCollection,
  type NormalizeDeps,
} from "./normalize";
import type { ParcelSourceRecord } from "./source-record";
import {
  bboxAroundPoint,
  DEFAULT_MAX_FEATURES,
  DEFAULT_PAGE_SIZE,
  type BBox,
  type LngLat,
  type ParcelQueryOptions,
  type ParcelSource,
  type ParcelSourceDeps,
} from "./source";

/** CRS del riquadro: WGS84 con ordine assi longitudine-latitudine. */
const BBOX_CRS = "urn:ogc:def:crs:OGC:1.3:CRS84";

/** Trasforma `"EPSG:4258"` nella forma URN che i WFS 2.0 si aspettano. */
export function epsgToUrn(crs: string): string {
  const code = /^EPSG:(\d+)$/i.exec(crs.trim())?.[1];
  return code ? `urn:ogc:def:crs:EPSG::${code}` : crs;
}

/** URL di una singola richiesta `GetFeature`. */
export function buildWfsUrl(
  record: ParcelSourceRecord,
  bbox: BBox,
  { count, startIndex }: { count: number; startIndex: number },
): string {
  const url = new URL(record.endpoint);
  // I parametri già presenti nell'endpoint restano (alcuni portali ci mettono
  // una chiave di servizio); quelli della richiesta li sovrascrivono.
  const params = url.searchParams;
  params.set("service", "WFS");
  params.set("version", "2.0.0");
  params.set("request", "GetFeature");
  params.set("typeNames", record.featureType ?? "");
  params.set("outputFormat", "application/json");
  params.set("srsName", epsgToUrn(record.crs));
  params.set("count", String(count));
  params.set("startIndex", String(startIndex));
  params.set("bbox", `${bbox.join(",")},${BBOX_CRS}`);
  return url.toString();
}

/** Elementi dichiarati dal servizio nella risposta, quando li dichiara. */
function declaredCount(payload: unknown): number | null {
  const value = (payload as { numberReturned?: unknown })?.numberReturned;
  return typeof value === "number" ? value : null;
}

/** Adapter per una fonte di catalogo con `accessType: "wfs"`. */
export function createWfsSource(
  record: ParcelSourceRecord,
  deps: ParcelSourceDeps,
): ParcelSource {
  async function queryByBbox(
    bbox: BBox,
    options: ParcelQueryOptions = {},
  ): Promise<Parcel[]> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxFeatures = options.maxFeatures ?? DEFAULT_MAX_FEATURES;
    const normalizeDeps: NormalizeDeps = {
      reproject: deps.reproject,
      newId: deps.newId,
      // Un solo istante per l'intera interrogazione: le particelle di una
      // stessa acquisizione condividono il momento in cui sono entrate.
      retrievedAt: deps.now(),
    };

    const collected: Parcel[] = [];
    let startIndex = 0;

    while (collected.length < maxFeatures) {
      const count = Math.min(pageSize, maxFeatures - collected.length);
      const url = buildWfsUrl(record, bbox, { count, startIndex });
      const payload = await deps.fetch(url, { signal: options.signal });
      const { parcels } = normalizeFeatureCollection(
        payload,
        record,
        normalizeDeps,
      );

      const returned =
        declaredCount(payload) ??
        ((payload as { features?: unknown[] })?.features?.length ?? 0);
      // Si tronca a ciò che manca invece di fidarsi che il servizio abbia
      // onorato `count`: il tetto è una difesa del dispositivo, e deve tenere
      // anche davanti a un servizio che restituisce più di quanto chiesto.
      collected.push(...parcels.slice(0, maxFeatures - collected.length));

      // Meno elementi di quanti richiesti: era l'ultima pagina. Vale anche per
      // una pagina vuota, che chiude il ciclo senza una richiesta in più.
      if (returned < count) break;
      startIndex += returned;
    }

    return collected;
  }

  return {
    id: record.id,
    supportsLiveQuery: true,
    queryByBbox,
    queryByPoint: (lngLat: LngLat, options?: ParcelQueryOptions) =>
      queryByBbox(bboxAroundPoint(lngLat), options),
  };
}
