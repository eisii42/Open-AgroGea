/**
 * AbstractGisParser — importazione cartografica ASTRATTA e multiregionale dei
 * fascicoli grafici LPIS/INSPIRE (Shapefile `.zip`/`.shp`, GML).
 *
 * Strategy/Adapter Pattern: la decodifica delle proprietà alfanumeriche dello
 * shapefile (che variano per nazione/portale) è delegata a un
 * {@link GisParcelAdapter} scelto in base al `country_code` del tenant. Tutti gli
 * adapter producono lo stesso record EU-agnostico {@link MappedParcel}
 * (reference/agricultural parcel external id, crop/variety external code,
 * declared area), pronto per `plots_campaign`.
 *
 * La lettura spaziale (parsing del file → FeatureCollection) resta delegata al
 * {@link SpatialAnalysisEngine} (DuckDB Spatial, in-browser): l'adapter lavora
 * solo sulle properties, quindi è PURO e testabile sotto `node --test`.
 *
 *   * Adapter IT → SIAN/AGEA (Isola / Plot)
 *   * Adapter ES → SIGPAC/SIEX (Provincia, Municipio, Poligono, Parcela, Recinto)
 *   * Adapter FR → TelePAC/RPG (Îlot, Parcelle, Code culture)
 *   * Adapter EU → base internazionale (alias inglesi generici)
 */
import { areaHectares, type CountryCode } from "@agrogea/core";
import type {
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";
import {
  mapSianFeature,
  numeroItaliano,
  parseCsvRows,
  type SianCampoMappato,
  type SianProperties,
} from "./sian-mapping";

/** Record EU-agnostico product da ogni adapter (allineato a `plots_campaign`). */
export type MappedParcel = SianCampoMappato;

/** Strategia di decodifica delle properties per una specifica nazione. */
export interface GisParcelAdapter {
  /** Paese governato da questo adapter. */
  readonly countryCode: CountryCode;
  /** Etichetta del formato ufficiale (per log/UI). */
  readonly label: string;
  /** Decodifica una feature in un record EU-agnostico. */
  mapFeature(
    props: SianProperties,
    geometria: Geometry | null,
    areaGeodeticaHa?: number | null,
  ): MappedParcel;
}

// -- helpers generici (case-insensitive, alias robusti) ---------------------

function normalizza(chiave: string): string {
  return chiave.trim().toLowerCase().replace(/[\s.]+/g, "_");
}

function indicizza(props: SianProperties): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(props)) map.set(normalizza(k), v);
  return map;
}

function pick(idx: Map<string, unknown>, alias: readonly string[]): unknown {
  for (const a of alias) {
    const v = idx.get(a);
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function asCodice(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function arrotonda4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Alias per la decodifica di un formato nazionale. */
interface AdapterAliases {
  /** Riferimento di parcella (reference parcel). Più alias = identificativo composito. */
  reference: readonly string[];
  /** Parcella agricola / recinto (agricultural parcel). */
  agricultural: readonly string[];
  crop: readonly string[];
  variety: readonly string[];
  /** Superficie già in ettari. */
  areaHa: readonly string[];
  /** Superficie in metri quadri (convertita /10000). */
  areaMq: readonly string[];
  /**
   * Se valorizzato, il reference id è composto concatenando questi alias con
   * `sep` (es. SIGPAC: provincia-municipio-poligono-parcela).
   */
  referenceComposite?: readonly string[];
  sep?: string;
}

function resolveArea(
  idx: Map<string, unknown>,
  aliases: AdapterAliases,
  areaGeodeticaHa?: number | null,
): number {
  const dichiarata = numeroItaliano(pick(idx, aliases.areaHa));
  if (dichiarata != null && dichiarata > 0) return arrotonda4(dichiarata);
  const mq = numeroItaliano(pick(idx, aliases.areaMq));
  if (mq != null && mq > 0) return arrotonda4(mq / 10000);
  if (areaGeodeticaHa != null && areaGeodeticaHa > 0) return arrotonda4(areaGeodeticaHa);
  return 0;
}

function resolveReference(
  idx: Map<string, unknown>,
  aliases: AdapterAliases,
): string | null {
  if (aliases.referenceComposite && aliases.referenceComposite.length > 0) {
    const parts = aliases.referenceComposite
      .map((a) => asCodice(idx.get(a)))
      .filter((p): p is string => p != null);
    if (parts.length > 0) return parts.join(aliases.sep ?? "-");
  }
  return asCodice(pick(idx, aliases.reference));
}

/** Costruisce un adapter alias-based da una mappa di alias nazionale. */
function makeAdapter(
  countryCode: CountryCode,
  label: string,
  aliases: AdapterAliases,
): GisParcelAdapter {
  return {
    countryCode,
    label,
    mapFeature(props, geometria, areaGeodeticaHa) {
      const idx = indicizza(props);
      return {
        reference_parcel_external_id: resolveReference(idx, aliases),
        agricultural_parcel_external_id: asCodice(pick(idx, aliases.agricultural)),
        crop_external_code: asCodice(pick(idx, aliases.crop)),
        variety_external_code: asCodice(pick(idx, aliases.variety)),
        superficie_ha: resolveArea(idx, aliases, areaGeodeticaHa),
        geometria,
      };
    },
  };
}

// -- adapter per nazione -----------------------------------------------------

/** IT — SIAN/AGEA. Delega al mapper SIAN robusto già esistente (Isola/Plot). */
export const itSianAdapter: GisParcelAdapter = {
  countryCode: "IT",
  label: "SIAN/AGEA (Isola/Plot)",
  mapFeature: (props, geometria, areaGeodeticaHa) =>
    mapSianFeature(props, geometria, areaGeodeticaHa),
};

/** ES — SIGPAC/SIEX. Reference = Provincia-Municipio-Poligono-Parcela; agricultural = Recinto. */
export const esSigpacAdapter: GisParcelAdapter = makeAdapter(
  "ES",
  "SIGPAC/SIEX (Provincia/Municipio/Poligono/Parcela/Recinto)",
  {
    referenceComposite: ["provincia", "municipio", "poligono", "parcela"],
    sep: ":",
    reference: ["parcela", "id_parcela", "referencia"],
    agricultural: ["recinto", "id_recinto", "siex", "recinto_id"],
    crop: ["uso_sigpac", "uso", "cod_uso", "producto", "cultivo", "crop_external_code"],
    variety: ["variedad", "cod_variedad", "variety_external_code"],
    areaHa: ["superficie_ha", "sup_ha", "supha", "dn_sup_ha", "has"],
    areaMq: ["dn_surface", "superficie", "area", "shape_area", "sup_m2"],
  },
);

/** FR — TelePAC/RPG. Reference = Îlot; agricultural = Parcelle; crop = Code culture. */
export const frTelepacAdapter: GisParcelAdapter = makeAdapter(
  "FR",
  "TelePAC/RPG (Îlot/Parcelle/Code culture)",
  {
    reference: ["num_ilot", "ilot", "id_ilot", "numero_ilot"],
    agricultural: ["num_parcel", "numero", "parcelle", "id_parcel", "num_parcelle"],
    crop: ["code_cultu", "code_culture", "culture", "cod_cultu", "crop_external_code"],
    variety: ["variete", "code_var", "variety_external_code"],
    areaHa: ["surf_parc", "surface", "surf_ha", "superficie_ha", "surf"],
    areaMq: ["surf_m2", "shape_area", "area"],
  },
);

/** EU — base internazionale (alias inglesi generici INSPIRE/LPIS). */
export const euBaseAdapter: GisParcelAdapter = makeAdapter(
  "EU",
  "INSPIRE/LPIS base (reference/agricultural parcel)",
  {
    reference: ["reference_parcel_external_id", "reference_parcel", "ref_parcel", "parcel_ref", "block_id"],
    agricultural: ["agricultural_parcel_external_id", "agricultural_parcel", "agri_parcel", "parcel_id", "field_id"],
    crop: ["crop_external_code", "crop_code", "crop", "land_use", "lu_code"],
    variety: ["variety_external_code", "variety_code", "variety"],
    areaHa: ["declared_area_ha", "area_ha", "ha", "hectares"],
    areaMq: ["area_m2", "area_sqm", "shape_area", "area"],
  },
);

const ADAPTERS: Record<CountryCode, GisParcelAdapter> = {
  IT: itSianAdapter,
  ES: esSigpacAdapter,
  FR: frTelepacAdapter,
  EU: euBaseAdapter,
};

/** Restituisce l'adapter GIS per il paese risolto (fallback base internazionale). */
export function getGisAdapter(countryCode: CountryCode): GisParcelAdapter {
  return ADAPTERS[countryCode] ?? euBaseAdapter;
}

function isPoligono(g: Geometry | null): g is Polygon | MultiPolygon {
  return g != null && (g.type === "Polygon" || g.type === "MultiPolygon");
}

/** Estensione (minuscola, senza punto) del name file. */
function estensione(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name.trim().toLowerCase());
  return m ? m[1] : "";
}

export type FormatoGis = "shapefile" | "gml" | "csv";

export interface GisParseResult {
  countryCode: CountryCode;
  adapter: string;
  formato: FormatoGis;
  parcels: MappedParcel[];
}

/** Mappa un'intera FeatureCollection con l'adapter dato (PURO, testabile). */
export function mapFeatureCollectionWith(
  fc: FeatureCollection,
  adapter: GisParcelAdapter,
): MappedParcel[] {
  const out: MappedParcel[] = [];
  for (const f of fc.features) {
    const geom = f.geometry ?? null;
    const area = isPoligono(geom) ? areaHectares(geom) : null;
    out.push(adapter.mapFeature(f.properties ?? {}, geom, area));
  }
  return out;
}

/**
 * Parser cartografico astratto. Sceglie l'adapter dal `country_code`, legge il
 * file con DuckDB Spatial (shapefile/GML) o come CSV di interscambio, e ritorna
 * i record EU-agnostici pronti per `plots_campaign`.
 */
export class AbstractGisParser {
  static async parse(
    file: File,
    countryCode: CountryCode,
  ): Promise<GisParseResult> {
    const adapter = getGisAdapter(countryCode);
    const ext = estensione(file.name);

    if (ext === "csv" || ext === "tsv") {
      const parcels = parseCsvRows(await file.text()).map((props) =>
        adapter.mapFeature(props, null, null),
      );
      return { countryCode, adapter: adapter.label, formato: "csv", parcels };
    }

    // Shapefile (zip/shp) o GML → DuckDB Spatial → FeatureCollection.
    const { SpatialAnalysisEngine } = await import("./SpatialAnalysisEngine");
    const data = new Uint8Array(await file.arrayBuffer());
    const fc = await SpatialAnalysisEngine.instance().loadVectorFileAsFeatureCollection(
      { name: file.name, extension: ext, data },
    );
    return {
      countryCode,
      adapter: adapter.label,
      formato: ext === "gml" ? "gml" : "shapefile",
      parcels: mapFeatureCollectionWith(fc, adapter),
    };
  }
}
