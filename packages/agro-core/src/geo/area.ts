import turfArea from "@turf/area";
import turfBbox from "@turf/bbox";
import turfLength from "@turf/length";
import type {
  Feature,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

/**
 * Calcolo geometrico geodetico, condiviso da DAL (area in ettari salvata
 * sull'appezzamento) e pipeline NDVI (bbox per la query STAC).
 *
 * `@turf/area` integra sull'ellissoide WGS84: nessuna riproiezione manuale in
 * UTM e nessuna distorsione planare alle nostre latitudini. È la stessa
 * libreria geodetica già usata altrove in GeoLibre, quindi i valori sono
 * coerenti con l'engine cartografico.
 */

const MQ_PER_ETTARO = 10_000;

/**
 * Superficie geodetica del poligono in ettari (4 decimali). Sempre ≥ 0 e MAI
 * lanciante: durante l'editing il GeoEditor può emettere geometrie transitorie
 * con `coordinates` assenti/incomplete e `@turf/area` su quelle lancerebbe
 * (`Cannot read properties of undefined`), eccezione che, propagata dentro la
 * subscription/effect, mandava in schermata bianca la WebView. Su input non
 * valido o non finito si ritorna 0. I chiamati che la persistono devono
 * comunque passare prima da `normalizeGeometry`.
 */
export function areaHectares(geometria: Polygon | MultiPolygon): number {
  if (!geometryHasCoordinates(geometria)) return 0;
  try {
    const mq = Math.abs(turfArea(geometria));
    if (!Number.isFinite(mq)) return 0;
    return Math.round((mq / MQ_PER_ETTARO) * 1e4) / 1e4;
  } catch {
    return 0;
  }
}

/**
 * Vero quando la geometria ha coordinate strutturalmente presenti (array non
 * vuoto), così da non passare a turf/PostGIS una geometria a metà costruzione.
 * Guardia leggera (non valida l'intera topologia): basta a evitare i crash da
 * `coordinates` undefined durante il trascinamento dei vertici.
 */
export function geometryHasCoordinates(geometry: Geometry): boolean {
  if (geometry.type === "GeometryCollection") {
    return (
      Array.isArray(geometry.geometries) && geometry.geometries.length > 0
    );
  }
  const coords = (geometry as { coordinates?: unknown }).coordinates;
  return Array.isArray(coords) && coords.length > 0;
}

/** Bounding box [minLon, minLat, maxLon, maxLat] in EPSG:4326. */
export function boundingBox(
  geometria: Polygon | MultiPolygon,
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = turfBbox(geometria);
  return [minX, minY, maxX, maxY];
}

/**
 * Centroide approssimato [lon, lat] dal centro del bounding box. Sufficiente
 * per la query meteo (Open-Meteo campiona la cella, non serve il baricentro
 * geometrico esatto) ed evita una dipendenza in più rispetto a `@turf/centroid`.
 */
export function centroid(
  geometria: Polygon | MultiPolygon,
): [number, number] {
  const [minX, minY, maxX, maxY] = turfBbox(geometria);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Lunghezza geodetica di una linea in metri (0 decimali). */
export function lengthMeters(
  geometria: LineString | MultiLineString,
): number {
  const feature: Feature<LineString | MultiLineString> = {
    type: "Feature",
    geometry: geometria,
    properties: {},
  };
  return Math.round(turfLength(feature, { units: "meters" }));
}

/**
 * Tipo di geometria per il workflow di data-entry su disegno: poligono →
 * plot, linea → infrastructure, punto → POI/asset puntuale.
 */
export type DrawnGeometry = "polygon" | "line" | "point";

/**
 * Famiglia primitiva di un `Geometry["type"]` GeoJSON: poligono, linea o punto.
 * Single/Multi della stessa primitiva collassano nella stessa famiglia; i tipi
 * non spaziali (es. `GeometryCollection`) restituiscono `null`.
 */
export function geometryFamily(
  type: Geometry["type"],
): DrawnGeometry | null {
  switch (type) {
    case "Polygon":
    case "MultiPolygon":
      return "polygon";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Point":
    case "MultiPoint":
      return "point";
    default:
      return null;
  }
}

export function classifyGeometry(geometry: Geometry): DrawnGeometry | null {
  return geometryFamily(geometry.type);
}

/**
 * Vero quando due tipi GeoJSON appartengono alla STESSA famiglia primitiva
 * (entrambi poligoni, o linee, o punti). Usata per vincolare l'editing dei
 * vertici a tipo stabile: una modifica di una `LineString` non deve mai
 * produrre un `Polygon` (il GeoEditor espone feature ausiliarie — maniglie dei
 * vertici come Point — e in certi casi può chiudere la geometria; accettare il
 * drift corromperebbe il record e romperebbe il sync). Tipi non spaziali su un
 * lato → `false`.
 */
export function sameGeometryFamily(
  a: Geometry["type"],
  b: Geometry["type"],
): boolean {
  const fa = geometryFamily(a);
  return fa !== null && fa === geometryFamily(b);
}

/**
 * Helper puro: da una collezione di feature sceglie la prima della STESSA
 * famiglia di `expectedType`, ignorando le ausiliarie di tipo diverso (es.
 * maniglie Point). In assenza di match si ripiega sulla prima. Utility generica
 * (l'editing geometrico dell'app usa ora il motore in-place nativo di GeoLibre).
 */
export function pickEditedFeature(
  features: readonly Feature[],
  expectedType: Geometry["type"],
): Feature | undefined {
  return (
    features.find(
      (f) => f.geometry && sameGeometryFamily(f.geometry.type, expectedType),
    ) ?? features[0]
  );
}

// ---------------------------------------------------------------------------
// Normalizzazione difensiva delle geometrie prima della persistenza
// ---------------------------------------------------------------------------

/**
 * Profondità di annidamento di un array di coordinate GeoJSON: una posizione
 * `[x, y]` ha profondità 1, un anello `[[x, y], …]` profondità 2, le
 * `coordinates` di un Polygon profondità 3, di un MultiPolygon profondità 4.
 * 0 se non è un array.
 */
function profonditaCoordinate(value: unknown): number {
  let depth = 0;
  let cur: unknown = value;
  while (Array.isArray(cur)) {
    depth += 1;
    if (typeof cur[0] === "number") break;
    cur = cur[0];
  }
  return depth;
}

/**
 * Proietta ricorsivamente ogni posizione a 2D `[lng, lat]`, rimuovendo
 * Z/M. Il GeoEditor su mappa con terreno/globo può emettere coordinate 3D
 * `[lng, lat, z]`; la colonna PostGIS lato server è 2D (`geometry(…, 4326)`),
 * quindi un upsert con la Z fallisce con «Geometry has Z dimensions but column
 * does not». Si tronca a 2 sortedList prima di persistere.
 */
function coord2D(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (typeof value[0] === "number") {
    return value.length > 2 ? [value[0], value[1]] : value;
  }
  return value.map(coord2D);
}

/** Chiude un anello GeoJSON ripetendo la prima posizione in coda, se serve. */
function chiudiAnello(ring: Position[]): Position[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, [first[0], first[1]]];
  }
  return ring;
}

function normalizzaAnelliPoligono(coords: Position[][]): Position[][] {
  return coords.map((ring) => {
    const chiuso = chiudiAnello(ring);
    if (chiuso.length < 4) {
      throw new Error(
        "Geometria poligono non valida: anello con meno di 3 vertici.",
      );
    }
    return chiuso;
  });
}

/**
 * Normalizza una geometria appena disegnata/modificata PRIMA di persisterla.
 * Il GeoEditor può emettere un `Polygon` con coordinate "piatte" di profondità
 * da anello/LineString (`[[x,y],…]` invece di `[[[x,y],…]]`): tale geometria
 * fa restituire a `@turf/area` un'area negativa/garbage e fa fallire il trigger
 * PostGIS lato server con «The 'coordinates' in Geojson ring are not an
 * array» (sync 500). Inoltre tronca le coordinate a 2D (rimuove la Z che il
 * GeoEditor su terreno/globo può aggiungere e che la colonna PostGIS 2D
 * rifiuta: «Geometry has Z dimensions but column does not»). Si riavvolge
 * l'annidamento corretto e si chiudono gli anelli; le geometrie già valide e 2D
 * passano sostanzialmente invariate. Lancia se la struttura è irrecuperabile,
 * così il salvataggio fallisce in modo visibile invece di corrompere il DB
 * locale e la coda di sync.
 */
export function normalizeGeometry<G extends Geometry>(geometry: G): G {
  if (geometry.type === "Polygon") {
    let coords = coord2D(geometry.coordinates);
    const depth = profonditaCoordinate(coords);
    // Profondità attesa 3; 2 = anello "nudo" senza il livello dei ring → avvolgi.
    if (depth === 2) coords = [coords];
    else if (depth !== 3) {
      throw new Error(
        "Geometria poligono non valida: annidamento coordinate inatteso.",
      );
    }
    return {
      ...geometry,
      coordinates: normalizzaAnelliPoligono(coords as Position[][]),
    };
  }

  if (geometry.type === "MultiPolygon") {
    let coords = coord2D(geometry.coordinates);
    const depth = profonditaCoordinate(coords);
    // Profondità attesa 4; 3 = singolo poligono senza il livello multi → avvolgi.
    if (depth === 3) coords = [coords];
    else if (depth !== 4) {
      throw new Error(
        "Geometria multipoligono non valida: annidamento coordinate inatteso.",
      );
    }
    return {
      ...geometry,
      coordinates: (coords as Position[][][]).map(normalizzaAnelliPoligono),
    };
  }

  // Linee e punti: nessun anello da chiudere, ma si tronca comunque la Z.
  if ("coordinates" in geometry) {
    return { ...geometry, coordinates: coord2D(geometry.coordinates) } as G;
  }
  return geometry;
}
