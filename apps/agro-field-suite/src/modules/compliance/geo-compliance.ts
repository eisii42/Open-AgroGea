/**
 * Geo-compliance del Quaderno di Campagna: intersezione locale dell'appezzamento
 * con i layer regionali vincolanti (Zone Vulnerabili ai Nitrati, aree protette
 * SIC/ZPS) e derivazione dei massimali di azoto distribuibile.
 *
 * Parte PURA (turf + geometria): testabile sotto Node. Nessun DuckDB necessario,
 * così il controllo è sincrono e immediato al salvataggio dell'appezzamento.
 */
import { NITROGEN_LIMIT_KG_HA } from "@agrogea/tools";
import booleanIntersects from "@turf/boolean-intersects";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";

/**
 * Layer vincolanti riconosciuti. Ai quattro storici (v0.1) si aggiungono, con
 * il modulo Compliance, quelli che le schede BCAA interrogano: il reticolo
 * idrografico della BCAA 4 e le zone umide della BCAA 2.
 */
export type ConstraintType =
  | "zvn"
  | "sic"
  | "zps"
  | "eudr"
  | "water_network"
  | "wetland";

export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  zvn: "Zona Vulnerabile ai Nitrati",
  sic: "Sito di Importanza Comunitaria (SIC)",
  zps: "Zona di Protezione Speciale (ZPS)",
  eudr: "Rischio deforestazione (EUDR, cut-off 2020)",
  water_network: "Reticolo idrografico (BCAA 4)",
  wetland: "Zona umida / torbiera (BCAA 2)",
};

/**
 * Tetto azoto: 170 kg N/ha/anno (Direttiva Nitrati 91/676/CEE). La costante ha
 * UNA sola definizione, in `@agrogea/tools`, dove serve anche al motore del
 * biologico: qui si ri-esporta con il nome storico, così i consumatori esistenti
 * non cambiano e i due moduli non possono divergere.
 */
export const NITROGEN_MAX_ZVN_KG_HA = NITROGEN_LIMIT_KG_HA;

export interface LayerCompliance {
  type: ConstraintType;
  fc: FeatureCollection;
}

export interface ComplianceResult {
  inZvn: boolean;
  inAreaProtetta: boolean;
  /** Interseca un'area a rischio deforestazione (EUDR). */
  inEudr: boolean;
  /** Vincoli intersecati, in ordine zvn, sic, zps, eudr. */
  constraints: ConstraintType[];
  /** Massimale di azoto kg/ha (null = nessun vincolo sull'azoto). */
  azotoMaxKgHa: number | null;
  /** Note leggibili per la UI. */
  note: string[];
}

type Bbox = [number, number, number, number];

function estendiBbox(bbox: Bbox, lon: number, lat: number): void {
  if (lon < bbox[0]) bbox[0] = lon;
  if (lat < bbox[1]) bbox[1] = lat;
  if (lon > bbox[2]) bbox[2] = lon;
  if (lat > bbox[3]) bbox[3] = lat;
}

/** Bounding box di una geometria (prefiltro economico prima di booleanIntersects). */
export function geometryBbox(geometry: Geometry): Bbox {
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const visita = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      estendiBbox(bbox, coords[0], coords[1]);
      return;
    }
    for (const c of coords) visita(c);
  };
  if ("coordinates" in geometry) visita(geometry.coordinates);
  else if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const b = geometryBbox(g);
      estendiBbox(bbox, b[0], b[1]);
      estendiBbox(bbox, b[2], b[3]);
    }
  }
  return bbox;
}

function bboxDisgiunti(a: Bbox, b: Bbox): boolean {
  return a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1];
}

/** True se l'appezzamento interseca almeno una feature del layer. */
function intersecaLayer(
  plot: Feature<Polygon | MultiPolygon>,
  appBbox: Bbox,
  fc: FeatureCollection,
): boolean {
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    // Prefiltro bbox: salta le feature lontane senza il test costoso.
    if (bboxDisgiunti(appBbox, geometryBbox(feature.geometry))) continue;
    if (booleanIntersects(plot, feature)) return true;
  }
  return false;
}

/**
 * Verifica i vincoli geografici dell'appezzamento sui layer forniti e ricava il
 * massimale di azoto. L'ordine dei vincoli restituiti è sempre zvn, sic, zps.
 */
export function checkCompliance(
  geometria: Polygon | MultiPolygon,
  layers: LayerCompliance[],
): ComplianceResult {
  const plot: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    geometry: geometria,
    properties: {},
  };
  const appBbox = geometryBbox(geometria);

  const colpiti = new Set<ConstraintType>();
  for (const layer of layers) {
    if (intersecaLayer(plot, appBbox, layer.fc)) colpiti.add(layer.type);
  }

  const ordine: ConstraintType[] = ["zvn", "sic", "zps", "eudr"];
  const constraints = ordine.filter((t) => colpiti.has(t));
  const inZvn = colpiti.has("zvn");
  const inAreaProtetta = colpiti.has("sic") || colpiti.has("zps");
  const inEudr = colpiti.has("eudr");

  const note = constraints.map((t) => {
    if (t === "zvn")
      return `In ZVN: azoto ≤ ${NITROGEN_MAX_ZVN_KG_HA} kg/ha/year (Direttiva Nitrati).`;
    if (t === "eudr")
      return "Area a rischio deforestazione: richiesta due diligence EUDR (cut-off 31/12/2020).";
    return `In ${CONSTRAINT_LABELS[t]}: verificare le prescrizioni dell'area protetta.`;
  });

  return {
    inZvn,
    inAreaProtetta,
    inEudr,
    constraints,
    azotoMaxKgHa: inZvn ? NITROGEN_MAX_ZVN_KG_HA : null,
    note,
  };
}

/** Massimale di azoto in value assoluto (kg) per la area data. */
export function totalNitrogenMax(
  superficieHa: number | null,
  maxKgHa: number | null,
): number | null {
  if (maxKgHa == null || superficieHa == null || superficieHa <= 0) return null;
  return Math.round(maxKgHa * superficieHa * 100) / 100;
}

/**
 * True se la quantità totale di azoto (kg) supera il massimale per la area.
 * Senza vincolo (maxKgHa null) o senza dati ritorna false.
 */
export function exceedsNitrogenCap(
  quantitaTotaleKg: number | null,
  superficieHa: number | null,
  maxKgHa: number | null,
): boolean {
  const tetto = totalNitrogenMax(superficieHa, maxKgHa);
  if (tetto == null || quantitaTotaleKg == null) return false;
  return quantitaTotaleKg > tetto;
}

// ---------------------------------------------------------------------------
// Distanza dal reticolo idrografico (BCAA 4, scheda B1)
// ---------------------------------------------------------------------------

/**
 * Metri per grado di latitudine. Costante a sufficienza per l'uso che se ne fa
 * qui (la variazione fra equatore e poli è dello 0,6%).
 */
const M_PER_DEG_LAT = 111_320;

/**
 * Distanza planare in metri fra due posizioni, con la longitudine scalata per
 * il coseno della latitudine.
 *
 * È un'APPROSSIMAZIONE dichiarata, non una geodetica: su distanze dell'ordine
 * delle decine o centinaia di metri — che è tutto ciò che serve per una fascia
 * tampone di 3–10 m — l'errore è sotto il decimo di percento, e non introduce
 * una dipendenza geometrica per una formula di tre righe. Su distanze
 * chilometriche degraderebbe, ma a quel punto il quesito "sono dentro la fascia
 * tampone?" ha già risposta.
 */
function metersBetween(
  [lon1, lat1]: [number, number],
  [lon2, lat2]: [number, number],
): number {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * M_PER_DEG_LAT * Math.cos(midLat);
  const dy = (lat2 - lat1) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Distanza in metri fra un punto e un segmento (proiezione ortogonale). */
function distanceToSegment(
  point: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const scale = Math.cos(midLat);
  // Si lavora in un piano locale in metri: la proiezione ortogonale su un
  // segmento non è esprimibile in gradi senza deformare le lunghezze.
  const toXy = ([lon, lat]: [number, number]): [number, number] => [
    lon * M_PER_DEG_LAT * scale,
    lat * M_PER_DEG_LAT,
  ];
  const [px, py] = toXy(point);
  const [ax, ay] = toXy(a);
  const [bx, by] = toXy(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return metersBetween(point, a);
  // t è la posizione della proiezione lungo il segmento, limitata agli estremi.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Tutte le posizioni di una geometria, appiattite. */
function positionsOf(geometry: Geometry): [number, number][] {
  const out: [number, number][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      out.push([node[0], node[1]]);
      return;
    }
    for (const child of node) walk(child);
  };
  if ("coordinates" in geometry) walk(geometry.coordinates);
  else if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) out.push(...positionsOf(g));
  }
  return out;
}

/** Segmenti consecutivi di una geometria lineare o poligonale. */
function segmentsOf(geometry: Geometry): [[number, number], [number, number]][] {
  const segments: [[number, number], [number, number]][] = [];
  const walkLine = (line: unknown): void => {
    if (!Array.isArray(line)) return;
    if (typeof (line[0] as number[])?.[0] === "number") {
      const positions = line as [number, number][];
      for (let i = 1; i < positions.length; i++) {
        segments.push([positions[i - 1], positions[i]]);
      }
      return;
    }
    for (const child of line) walkLine(child);
  };
  if ("coordinates" in geometry) walkLine(geometry.coordinates);
  else if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) segments.push(...segmentsOf(g));
  }
  return segments;
}

/**
 * Distanza minima in metri fra l'appezzamento e le geometrie di un layer.
 *
 * Serve alla scheda BCAA 4 (fasce tampone), che è **geometrica e non
 * spettrale**: una fascia di tre metri è un terzo di un pixel Sentinel-2, e
 * cercarla nell'NDVI sarebbe una finzione. Il conto è sui VERTICI
 * dell'appezzamento contro i SEGMENTI del layer: è la distanza che conta per
 * l'obbligo — quanto il campo coltivato si avvicina al corso d'acqua — e
 * approssima per eccesso solo nel caso raro in cui un corso d'acqua passi
 * rasente un lato lungo senza avvicinarsi ad alcun vertice.
 *
 * `null` quando il layer non contiene geometrie utili: assenza di dato, non
 * distanza infinita, e la scheda la tratta come "non decidibile".
 */
export function minDistanceToLayerM(
  plotGeometry: Geometry,
  fc: FeatureCollection,
): number | null {
  const vertices = positionsOf(plotGeometry);
  if (vertices.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const segments = segmentsOf(feature.geometry);
    if (segments.length === 0) {
      // Layer puntuale: si misura sui punti.
      for (const position of positionsOf(feature.geometry)) {
        for (const vertex of vertices) {
          min = Math.min(min, metersBetween(vertex, position));
        }
      }
      continue;
    }
    for (const [a, b] of segments) {
      for (const vertex of vertices) {
        min = Math.min(min, distanceToSegment(vertex, a, b));
      }
    }
  }
  return Number.isFinite(min) ? min : null;
}
