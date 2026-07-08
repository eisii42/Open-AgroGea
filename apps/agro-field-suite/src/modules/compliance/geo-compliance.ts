/**
 * Geo-compliance del Quaderno di Campagna: intersezione locale dell'appezzamento
 * con i layer regionali vincolanti (Zone Vulnerabili ai Nitrati, aree protette
 * SIC/ZPS) e derivazione dei massimali di azoto distribuibile.
 *
 * Parte PURA (turf + geometria): testabile sotto Node. Nessun DuckDB necessario,
 * così il controllo è sincrono e immediato al salvataggio dell'appezzamento.
 */
import booleanIntersects from "@turf/boolean-intersects";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";

export type TipoVincolo = "zvn" | "sic" | "zps" | "eudr";

export const ETICHETTE_VINCOLO: Record<TipoVincolo, string> = {
  zvn: "Zona Vulnerabile ai Nitrati",
  sic: "Sito di Importanza Comunitaria (SIC)",
  zps: "Zona di Protezione Speciale (ZPS)",
  eudr: "Rischio deforestazione (EUDR, cut-off 2020)",
};

/** Tetto azoto in ZVN: 170 kg N/ha/anno (Direttiva Nitrati 91/676/CEE). */
export const AZOTO_MAX_ZVN_KG_HA = 170;

export interface LayerCompliance {
  tipo: TipoVincolo;
  fc: FeatureCollection;
}

export interface RisultatoCompliance {
  inZvn: boolean;
  inAreaProtetta: boolean;
  /** Interseca un'area a rischio deforestazione (EUDR). */
  inEudr: boolean;
  /** Vincoli intersecati, in ordine zvn, sic, zps, eudr. */
  vincoli: TipoVincolo[];
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
export function geometriaBbox(geometry: Geometry): Bbox {
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
      const b = geometriaBbox(g);
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
    if (bboxDisgiunti(appBbox, geometriaBbox(feature.geometry))) continue;
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
): RisultatoCompliance {
  const plot: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    geometry: geometria,
    properties: {},
  };
  const appBbox = geometriaBbox(geometria);

  const colpiti = new Set<TipoVincolo>();
  for (const layer of layers) {
    if (intersecaLayer(plot, appBbox, layer.fc)) colpiti.add(layer.tipo);
  }

  const ordine: TipoVincolo[] = ["zvn", "sic", "zps", "eudr"];
  const vincoli = ordine.filter((t) => colpiti.has(t));
  const inZvn = colpiti.has("zvn");
  const inAreaProtetta = colpiti.has("sic") || colpiti.has("zps");
  const inEudr = colpiti.has("eudr");

  const note = vincoli.map((t) => {
    if (t === "zvn")
      return `In ZVN: azoto ≤ ${AZOTO_MAX_ZVN_KG_HA} kg/ha/anno (Direttiva Nitrati).`;
    if (t === "eudr")
      return "Area a rischio deforestazione: richiesta due diligence EUDR (cut-off 31/12/2020).";
    return `In ${ETICHETTE_VINCOLO[t]}: verificare le prescrizioni dell'area protetta.`;
  });

  return {
    inZvn,
    inAreaProtetta,
    inEudr,
    vincoli,
    azotoMaxKgHa: inZvn ? AZOTO_MAX_ZVN_KG_HA : null,
    note,
  };
}

/** Massimale di azoto in value assoluto (kg) per la superficie data. */
export function azotoTotaleMax(
  superficieHa: number | null,
  maxKgHa: number | null,
): number | null {
  if (maxKgHa == null || superficieHa == null || superficieHa <= 0) return null;
  return Math.round(maxKgHa * superficieHa * 100) / 100;
}

/**
 * True se la quantità totale di azoto (kg) supera il massimale per la superficie.
 * Senza vincolo (maxKgHa null) o senza dati ritorna false.
 */
export function superaMassimaleAzoto(
  quantitaTotaleKg: number | null,
  superficieHa: number | null,
  maxKgHa: number | null,
): boolean {
  const tetto = azotoTotaleMax(superficieHa, maxKgHa);
  if (tetto == null || quantitaTotaleKg == null) return false;
  return quantitaTotaleKg > tetto;
}
