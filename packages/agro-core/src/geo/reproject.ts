/**
 * Riproiezione concreta: l'implementazione proj4 del {@link Reprojector} che
 * `@agrogea/parcel` si fa iniettare.
 *
 * Sta qui e non nel pacchetto del contratto perché proj4 è una dipendenza vera,
 * e il contratto deve restare senza: chi consuma il solo `Parcel` (i plugin
 * distribuiti a parte) non deve tirarsi dietro una libreria di geodesia.
 *
 * ## Le definizioni EPSG sono dato
 *
 * proj4 conosce di serie soltanto WGS84 e poche altre: ogni CRS nazionale va
 * definito. Le definizioni stanno in {@link EPSG_DEFINITIONS}, che è una tabella
 * da estendere quando si aggiunge un nodo di catalogo — nello stesso spirito
 * del catalogo stesso: dato, non codice.
 */
import proj4 from "proj4";

/** CRS di destinazione: quello del GeoJSON, l'unico ammesso dal formato. */
const WGS84 = "EPSG:4326";

/**
 * Definizioni proj4 dei CRS in cui pubblicano le fonti del catalogo. Aggiungere
 * un nodo che pubblica in un CRS non elencato significa aggiungere qui la sua
 * riga (le definizioni ufficiali stanno su epsg.io).
 */
export const EPSG_DEFINITIONS: Readonly<Record<string, string>> = {
  // ETRS89 geografico: il CRS di default dei servizi INSPIRE armonizzati.
  // Numericamente quasi indistinguibile da WGS84 (scarto sub-metrico), ma
  // resta un datum diverso e la trasformazione va comunque dichiarata.
  "EPSG:4258": "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",
  // Amersfoort / RD New — il CRS proiettato nazionale dei Paesi Bassi.
  "EPSG:28992":
    "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 " +
    "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
    "+towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.87740,4.0725 " +
    "+units=m +no_defs",
  // Monte Mario / Italia — usato dal catasto (Fase 2).
  "EPSG:6706": "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",
  // MGI / Austria Lambert (Fase 3).
  "EPSG:31287":
    "+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.3333333333333 " +
    "+x_0=400000 +y_0=400000 +ellps=bessel " +
    "+towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 " +
    "+units=m +no_defs",
};

/** CRS non risolvibile: il catalogo dichiara un sistema che non sappiamo trattare. */
export class UnknownCrsError extends Error {
  constructor(readonly crs: string) {
    super(
      `CRS non definito: "${crs}". Aggiungere la sua definizione proj4 a EPSG_DEFINITIONS.`,
    );
    this.name = "UnknownCrsError";
  }
}

let registered = false;

/** Registra una volta sola le definizioni in proj4. */
function ensureDefinitions(): void {
  if (registered) return;
  for (const [code, definition] of Object.entries(EPSG_DEFINITIONS)) {
    proj4.defs(code, definition);
  }
  registered = true;
}

/**
 * Un {@link Reprojector} che trasforma da un CRS dichiarato nel catalogo a
 * WGS84. Le trasformazioni sono memorizzate: una risposta WFS può contenere
 * centinaia di migliaia di vertici, e ricostruire il convertitore per ognuno
 * costerebbe più della trasformazione stessa.
 */
export function createProj4Reprojector(): (
  point: readonly [number, number],
  fromCrs: string,
) => readonly [number, number] {
  ensureDefinitions();
  const converters = new Map<string, proj4.Converter>();

  return (point, fromCrs) => {
    const crs = fromCrs.trim().toUpperCase();
    if (crs === WGS84) return point;

    let converter = converters.get(crs);
    if (!converter) {
      if (!(crs in EPSG_DEFINITIONS)) throw new UnknownCrsError(fromCrs);
      converter = proj4(crs, WGS84);
      converters.set(crs, converter);
    }
    const [lon, lat] = converter.forward([point[0], point[1]]);
    return [lon, lat];
  };
}
