/**
 * Trasformazione WGS84 → UTM, forma chiusa e senza dipendenze.
 *
 * Serve alla pipeline NDVI: i COG Sentinel-2 sono in UTM (EPSG 326NN/327NN),
 * mentre i poligoni degli appezzamenti sono in WGS84 (EPSG:4326). Per ritagliare
 * i pixel sul perimetro esatto bisogna portare i vertici del poligono nello
 * stesso CRS della scena. Evitiamo proj4 (dipendenza pesante): per UTM la
 * proiezione trasversa di Mercatore ha una formula analitica diretta.
 *
 * Riferimento: series di Karney/Snyder per la proiezione trasversa di Mercatore
 * sull'ellissoide WGS84. Accuratezza sub-metrica entro la zona, ampiamente
 * sufficiente al campionamento NDVI a 10 m/pixel.
 */

// Parametri ellissoide WGS84.
const A = 6378137.0; // semiasse maggiore (m)
const F = 1 / 298.257223563; // schiacciamento
const K0 = 0.9996; // fattore di scala UTM
const E2 = F * (2 - F); // eccentricità²
const EP2 = E2 / (1 - E2); // eccentricità² seconda

const DEG2RAD = Math.PI / 180;

/** Zona UTM (1..60) dalla longitudine. */
export function utmZoneFromLon(lonDeg: number): number {
  return Math.floor((lonDeg + 180) / 6) + 1;
}

/**
 * Codice EPSG UTM per una posizione WGS84: 326NN a nord dell'equatore,
 * 327NN a sud. È lo stesso codice che i COG Sentinel-2 dichiarano in
 * ProjectedCSTypeGeoKey, così possiamo verificare di proiettare nella zona
 * giusta della scena.
 */
export function utmEpsg(lonDeg: number, latDeg: number): number {
  const zone = utmZoneFromLon(lonDeg);
  return (latDeg >= 0 ? 32600 : 32700) + zone;
}

export interface UtmPoint {
  easting: number;
  northing: number;
}

/**
 * Proietta (lon, lat) in coordinate UTM (easting, northing in metri) nella
 * zona indicata da `epsg`. Se `epsg` è omesso, usa la zona naturale del punto.
 */
export function lonLatToUtm(
  lonDeg: number,
  latDeg: number,
  epsg?: number,
): UtmPoint {
  const code = epsg ?? utmEpsg(lonDeg, latDeg);
  const zone = code % 100;
  const south = Math.floor(code / 100) === 327;
  const lonOrigin = (zone - 1) * 6 - 180 + 3; // meridiano centrale della zona

  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const lonOriginRad = lonOrigin * DEG2RAD;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);

  const N = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = EP2 * cosLat * cosLat;
  const Acoef = cosLat * (lon - lonOriginRad);

  // Lunghezza dell'arco di meridiano M.
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * lat -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) *
        Math.sin(2 * lat) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * lat) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * lat));

  const easting =
    K0 *
      N *
      (Acoef +
        ((1 - T + C) * Acoef ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Acoef ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (M +
      N *
        tanLat *
        ((Acoef * Acoef) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Acoef ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Acoef ** 6) / 720));

  if (south) northing += 10000000; // falso nord per l'emisfero sud

  return { easting, northing };
}

/**
 * Inverso di `lonLatToUtm`: da coordinate UTM (easting, northing) della zona
 * indicata da `epsg` a (lon, lat) in gradi WGS84. Serve a georeferenziare sulla
 * mappa l'overlay raster calcolato in UTM (i 4 angoli della finestra COG). Serie
 * inversa di Snyder per la proiezione trasversa di Mercatore.
 */
export function utmToLonLat(
  easting: number,
  northing: number,
  epsg: number,
): { lon: number; lat: number } {
  const zone = epsg % 100;
  const south = Math.floor(epsg / 100) === 327;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;

  const x = easting - 500000;
  const y = south ? northing - 10000000 : northing;

  const M = y / K0;
  const mu =
    M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = EP2 * cosPhi1 * cosPhi1;
  const R1 = (A * (1 - E2)) / (1 - E2 * sinPhi1 * sinPhi1) ** 1.5;
  const D = x / (N1 * K0);

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) *
          D ** 6) /
          720);

  const lon =
    lonOrigin * DEG2RAD +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) /
        120) /
      cosPhi1;

  return { lon: lon / DEG2RAD, lat: lat / DEG2RAD };
}
