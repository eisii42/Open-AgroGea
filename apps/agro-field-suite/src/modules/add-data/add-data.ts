/**
 * Logica PURA del componente "Add Data" globale (GeoLibre 1.2 nella field suite).
 *
 * Centralizza il riconoscimento del formato dei file esterni e la costruzione
 * del layer da iniettare nel Layer Store NATIVO di GeoLibre (`useAppStore`).
 * Nessuna dipendenza da React/MapLibre/DuckDB: stringhe e oggetti, testabili
 * sotto `node --test`. Il caricamento WASM (Shapefile/PBF via DuckDB Spatial)
 * vive nel componente {@link ../../components/AddDataControl}.
 */
import type { FormatoFile } from "@agrogea/core";
import type { FeatureCollection } from "geojson";

/** Marcatore di metadata che identifica un layer caricato via Add Data. */
export const EXTERNAL_LAYER_FLAG = "agrogeaExternal";

/** Estensione (senza punto, minuscola) di un nome file. */
export function estensioneFile(nome: string): string {
  const m = /\.([^.\\/]+)$/.exec(nome.trim().toLowerCase());
  return m ? m[1] : "";
}

/**
 * Mappa l'estensione del file sul formato tracciato (csv/geojson/isoxml/
 * shapefile). Ritorna null per le estensioni non riconosciute, così il chiamante
 * può rifiutare il file invece di registrare un formato errato nel giornale.
 */
export function formatoDaNomeFile(nome: string): FormatoFile | null {
  const ext = estensioneFile(nome);
  switch (ext) {
    case "geojson":
    case "json":
      return "geojson";
    case "csv":
    case "tsv":
      return "csv";
    case "zip":
    case "shp":
      return "shapefile";
    case "gpkg":
      return "gpkg";
    case "kml":
    case "kmz":
      return "kml";
    case "gpx":
      return "gpx";
    case "xml":
    case "isoxml":
      return "isoxml";
    default:
      return null;
  }
}

/** Soglia (bytes) oltre la quale mostrare il warning di file massivo su mobile. */
export const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

/** True se il file va interpretato come GeoJSON testuale (parse diretto in JS). */
export function isGeoJson(nome: string): boolean {
  return formatoDaNomeFile(nome) === "geojson";
}

/**
 * Normalizza un JSON parsato in FeatureCollection, accettando sia una
 * FeatureCollection sia una singola Feature. Ritorna null se non è GeoJSON
 * vettoriale valido.
 */
export function toFeatureCollection(parsed: unknown): FeatureCollection | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { type?: string; features?: unknown };
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return parsed as FeatureCollection;
  }
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [parsed as never] };
  }
  return null;
}

/** Estensioni accettate dall'input file dell'Add Data (attributo `accept`). */
export const ADD_DATA_ACCEPT =
  ".geojson,.json,.zip,.shp,.gpkg,.kml,.kmz,.gpx,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/gpx+xml,application/geopackage+sqlite3";
