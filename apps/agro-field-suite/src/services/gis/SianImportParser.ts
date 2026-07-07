/**
 * SianImportParser — ingestione headless dei file del Fascicolo Aziendale
 * Grafico (SIAN/AGEA) in `campi_campagna`.
 *
 * Processa interamente nel browser:
 *   * archivi `.zip` / `.shp` con lo Shapefile cartografico ministeriale, letti
 *     da **DuckDB Spatial** (riuso di {@link SpatialAnalysisEngine});
 *   * file `.csv` / tabellari di interscambio esportati dai portali CAA (parsing
 *     in JS, senza geometria: popolano solo lo stato burocratico).
 *
 * La decodifica dei campi rigidi ministeriali è delegata al modulo PURO
 * {@link ./sian-mapping}, testabile sotto Node.
 */
import { areaHectares } from "@agrogea/core";
import type { FeatureCollection, Geometry, Polygon, MultiPolygon } from "geojson";
import {
  mapSianFeature,
  parseCsvRows,
  type SianCampoMappato,
} from "./sian-mapping";

export type FormatoSian = "shapefile" | "csv";

export interface SianImportParseResult {
  formato: FormatoSian;
  campi: SianCampoMappato[];
}

function isPoligono(g: Geometry | null): g is Polygon | MultiPolygon {
  return g != null && (g.type === "Polygon" || g.type === "MultiPolygon");
}

/** Estensione (minuscola, senza punto) del nome file. */
function estensione(nome: string): string {
  const m = /\.([^.\\/]+)$/.exec(nome.trim().toLowerCase());
  return m ? m[1] : "";
}

/** Mappa una FeatureCollection ministeriale in record di campo-campagna. */
export function mapFeatureCollection(
  fc: FeatureCollection,
): SianCampoMappato[] {
  const out: SianCampoMappato[] = [];
  for (const f of fc.features) {
    const geom = f.geometry ?? null;
    const area = isPoligono(geom) ? areaHectares(geom) : null;
    out.push(mapSianFeature(f.properties ?? {}, geom, area));
  }
  return out;
}

export class SianImportParser {
  /**
   * Processa un file del Fascicolo SIAN. Riconosce shapefile (`.zip`/`.shp`,
   * via DuckDB Spatial) e CSV di interscambio (JS). Ritorna i campi decodificati,
   * pronti per l'inserimento create-or-populate in PGlite.
   */
  static async parse(file: File): Promise<SianImportParseResult> {
    const ext = estensione(file.name);

    if (ext === "csv" || ext === "tsv") {
      const campi = parseCsvRows(await file.text()).map((props) =>
        mapSianFeature(props, null, null),
      );
      return { formato: "csv", campi };
    }

    // Shapefile (zip/shp) e altri vettoriali → DuckDB Spatial → FeatureCollection.
    const { SpatialAnalysisEngine } = await import("./SpatialAnalysisEngine");
    const data = new Uint8Array(await file.arrayBuffer());
    const fc = await SpatialAnalysisEngine.instance().loadVectorFileAsFeatureCollection(
      { name: file.name, extension: ext, data },
    );
    return { formato: "shapefile", campi: mapFeatureCollection(fc) };
  }
}
