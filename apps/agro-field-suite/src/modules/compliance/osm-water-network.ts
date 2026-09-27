import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import { geometryBbox } from "./geo-compliance";

/**
 * Reticolo idrografico da **OpenStreetMap**, per la BCAA 4 (fasce tampone).
 *
 * ## Perché OSM e non un upload
 *
 * La fascia tampone si misura dal corso d'acqua, e finora il corso d'acqua
 * doveva portarlo l'utente come layer. Voleva dire: trovare il reticolo
 * regionale, scaricarlo, convertirlo, caricarlo — per una scheda che senza
 * quel layer non può dire nulla. In pratica la scheda restava muta.
 *
 * OSM ha il reticolo mappato quasi ovunque in Europa, è interrogabile per
 * bounding box tramite Overpass, ed è gratuito e senza registrazione. La
 * scheda si prende da sé il dato di cui ha bisogno, sul perimetro
 * dell'appezzamento e basta.
 *
 * ## Che cosa si chiede a Overpass
 *
 * Le `way` con tag `waterway` di tipo lineare — fiumi, torrenti, canali, fossi,
 * scoli — più i corpi d'acqua a superficie (`natural=water`). Sono le
 * fattispecie che i decreti nazionali sulla BCAA 4 considerano "corso d'acqua";
 * quali esattamente rientrino varia per regione, e per questo i tipi sono un
 * parametro della funzione e non una costante sepolta.
 *
 * ## I limiti, che vanno detti all'utente
 *
 * OSM è cartografia **volontaria**: la copertura del reticolo minore è
 * disomogenea, un fosso può mancare e uno può essere mappato con precisione
 * metrica dubbia. Non è il reticolo ufficiale su cui l'Organismo Pagatore
 * misura. Serve a dare alla scheda un dato dove prima non ne aveva nessuno, e
 * l'esito che ne deriva porta con sé la provenienza — così chi legge sa su che
 * cosa è stato calcolato e può sostituirlo con il layer regionale quando ce
 * l'ha.
 */

/** Endpoint pubblico di Overpass. */
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Tipi di `waterway` considerati corso d'acqua ai fini della fascia tampone.
 * Sono un parametro: quali rientrino lo decide la norma regionale.
 */
export const DEFAULT_WATERWAY_TYPES = [
  "river",
  "stream",
  "canal",
  "ditch",
  "drain",
] as const;

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Query Overpass per il reticolo dentro un bbox, con un margine in gradi. */
export function buildOverpassQuery(
  bbox: [number, number, number, number],
  options: { waterwayTypes?: readonly string[]; padDeg?: number; timeoutS?: number } = {},
): string {
  const types = options.waterwayTypes ?? DEFAULT_WATERWAY_TYPES;
  // Il margine serve perché un corso d'acqua appena FUORI dal poligono è
  // esattamente quello da cui misurare la distanza: cercare solo dentro il
  // bbox dell'appezzamento troverebbe soltanto i corsi che lo attraversano.
  const pad = options.padDeg ?? 0.005;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  // Sette decimali (~1 cm) e non il float grezzo: `11.2 - 0.005` in virgola
  // mobile vale `11.194999999999999`, e mandare a Overpass quindici cifre di
  // rumore non aggiunge precisione, la finge.
  const round = (value: number) => Number(value.toFixed(7));
  const area =
    `${round(minLat - pad)},${round(minLon - pad)},` +
    `${round(maxLat + pad)},${round(maxLon + pad)}`;
  const filter = types.join("|");
  return (
    `[out:json][timeout:${options.timeoutS ?? 25}];` +
    `(way["waterway"~"^(${filter})$"](${area});` +
    `way["natural"="water"](${area}););` +
    `out geom;`
  );
}

/** Elementi Overpass → FeatureCollection di LineString. */
export function overpassToGeoJson(
  elements: readonly OverpassElement[],
): FeatureCollection {
  const features: Feature<LineString>[] = [];
  for (const element of elements) {
    const geometry = element.geometry;
    // Servono almeno due vertici: una `way` troncata dal bbox può averne uno.
    if (!Array.isArray(geometry) || geometry.length < 2) continue;
    features.push({
      type: "Feature",
      id: `${element.type}/${element.id}`,
      geometry: {
        type: "LineString",
        coordinates: geometry.map((p) => [p.lon, p.lat]),
      },
      properties: {
        osmId: `${element.type}/${element.id}`,
        name: element.tags?.["name"] ?? null,
        waterway: element.tags?.["waterway"] ?? element.tags?.["natural"] ?? null,
        // La provenienza viaggia con il dato: l'attribuzione OSM è richiesta
        // dalla ODbL, e l'esito deve poter dire da dove viene il reticolo.
        source: "OpenStreetMap",
        license: "ODbL 1.0",
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Attribuzione da mostrare ovunque il reticolo compaia (richiesta dalla ODbL). */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL 1.0)";

export interface WaterNetworkResult {
  fc: FeatureCollection;
  /** Corsi d'acqua trovati. */
  count: number;
  attribution: string;
}

/**
 * Scarica da Overpass il reticolo idrografico attorno all'appezzamento.
 *
 * Un risultato **vuoto non è un errore**: può voler dire che non ci sono corsi
 * d'acqua nel raggio cercato, e in quel caso la BCAA 4 non si applica. Ma può
 * anche voler dire che OSM non li ha mappati, e le due cose non si
 * distinguono: chi consuma questo risultato deve trattarlo come "nessun corso
 * d'acqua noto", non come "nessun corso d'acqua".
 */
export async function fetchWaterNetwork(
  geometry: Geometry,
  options: {
    fetchImpl?: typeof fetch;
    endpoint?: string;
    waterwayTypes?: readonly string[];
    padDeg?: number;
  } = {},
): Promise<WaterNetworkResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const query = buildOverpassQuery(geometryBbox(geometry), {
    waterwayTypes: options.waterwayTypes,
    padDeg: options.padDeg,
  });
  const res = await fetchImpl(options.endpoint ?? OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!res.ok) {
    // 429 e 504 sono i due esiti tipici di Overpass sotto carico: sono
    // temporanei, e vanno distinti da "non c'è nulla".
    throw new Error(`Overpass non disponibile (HTTP ${res.status}).`);
  }
  const payload = (await res.json()) as { elements?: OverpassElement[] };
  const fc = overpassToGeoJson(payload.elements ?? []);
  return {
    fc,
    count: fc.features.length,
    attribution: OSM_ATTRIBUTION,
  };
}
