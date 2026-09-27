/**
 * Adapter OGC API — Features. Dove c'è, è preferibile al WFS: JSON nativo,
 * paginazione dichiarata dal servizio con un collegamento `next`, nessuna
 * ambiguità sull'ordine degli assi (la specifica impone longitudine-latitudine).
 *
 * La paginazione segue il collegamento `next` invece di calcolare un offset:
 * è ciò che la specifica prescrive, e regge anche i servizi che impaginano a
 * cursore. Il ciclo si ferma quando il collegamento non c'è più, quando una
 * pagina non aggiunge nulla, o al tetto di sicurezza.
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

/** CRS dei riquadri e delle geometrie nella specifica OGC API — Features. */
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

/** Forma URI del CRS nativo, come richiesto dal parametro `crs`. */
export function epsgToOgcUri(crs: string): string {
  const code = /^EPSG:(\d+)$/i.exec(crs.trim())?.[1];
  return code ? `http://www.opengis.net/def/crs/EPSG/0/${code}` : crs;
}

/** URL della prima pagina di `/collections/{id}/items`. */
export function buildOgcApiUrl(
  record: ParcelSourceRecord,
  bbox: BBox,
  { limit }: { limit: number },
): string {
  const base = record.endpoint.endsWith("/")
    ? record.endpoint
    : `${record.endpoint}/`;
  const url = new URL(
    `collections/${encodeURIComponent(record.featureType ?? "")}/items`,
    base,
  );
  const params = url.searchParams;
  params.set("f", "json");
  params.set("limit", String(limit));
  params.set("bbox", bbox.join(","));
  params.set("bbox-crs", CRS84);
  // Geometrie nel CRS nativo: è quello che si conserva come `originalGeometry`.
  params.set("crs", epsgToOgcUri(record.crs));
  return url.toString();
}

/** URL della pagina successiva dichiarato dal servizio, se c'è. */
export function nextPageUrl(payload: unknown, baseUrl: string): string | null {
  const links = (payload as { links?: unknown })?.links;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const { rel, href } = (link ?? {}) as { rel?: unknown; href?: unknown };
    if (rel === "next" && typeof href === "string" && href.trim() !== "") {
      // I servizi pubblicano indifferentemente URL assoluti o relativi.
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Adapter per una fonte di catalogo con `accessType: "ogcapi"`. */
export function createOgcApiSource(
  record: ParcelSourceRecord,
  deps: ParcelSourceDeps,
): ParcelSource {
  async function queryByBbox(
    bbox: BBox,
    options: ParcelQueryOptions = {},
  ): Promise<Parcel[]> {
    const limit = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxFeatures = options.maxFeatures ?? DEFAULT_MAX_FEATURES;
    const normalizeDeps: NormalizeDeps = {
      reproject: deps.reproject,
      newId: deps.newId,
      retrievedAt: deps.now(),
    };

    const collected: Parcel[] = [];
    let url: string | null = buildOgcApiUrl(record, bbox, { limit });
    const visited = new Set<string>();

    while (url != null && collected.length < maxFeatures) {
      // Un servizio che rimanda alla pagina appena letta manderebbe il ciclo
      // all'infinito: si passa una volta sola per ogni URL.
      if (visited.has(url)) break;
      visited.add(url);

      const payload: unknown = await deps.fetch(url, { signal: options.signal });
      const { parcels } = normalizeFeatureCollection(
        payload,
        record,
        normalizeDeps,
      );
      const features = (payload as { features?: unknown[] })?.features ?? [];
      if (features.length === 0) break;

      collected.push(...parcels.slice(0, maxFeatures - collected.length));
      url = nextPageUrl(payload, url);
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
