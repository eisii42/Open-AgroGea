/**
 * Esportazione della mappa di prescrizione VRA verso i formati dei trattori.
 *
 *  * GeoJSON: interscambio universale (QGIS, FMIS, la maggior parte dei terminali
 *    accetta una mappa a poligoni con colonna del rateo);
 *  * ISO 11783-10 (ISOXML / "ISOBUS TASKDATA"): zone di trattamento poligonali
 *    con ProcessDataVariable per il rateo.
 *
 * NB: la mappatura DDI/unità ISOXML è un MVP: i DDI e i fattori di scala vanno
 * confermati contro il terminale di destinazione prima dell'uso in campo.
 * Parte PURA (solo stringhe): testabile sotto Node.
 */
import type { Feature, Polygon } from "geojson";
import type { RisultatoZoneVra, TipoLavorazione } from "./vra-zones";
import { geojsonToShapefileZip } from "./shapefile";

export function vraToGeoJson(result: RisultatoZoneVra): string {
  return JSON.stringify(result.fc);
}

/** Archivio ZIP Shapefile (.shp/.shx/.dbf/.prj) della mappa VRA, per trattori legacy. */
export function vraToShapefileZip(
  result: RisultatoZoneVra,
  nomeBase = "vra",
): Uint8Array {
  return geojsonToShapefileZip(result.fc, nomeBase);
}

/**
 * DDI ISO 11783-11 + fattore di scala dall'unità AgroGea all'unità base ISO
 * (processDataValue è un intero). MVP: da verificare col terminale.
 *   * massa per area  → DDI 0006, mg/m²  (1 kg/ha = 10 mg/m²)
 *   * volume per area → DDI 0001, mm³/m² (1 L/ha  = 100 mm³/m²)
 *   * conteggio/area  → DDI 0028, 1/m²   (1 semi/ha = 0.0001 /m²)
 */
const DDI_LAVORAZIONE: Record<
  TipoLavorazione,
  { ddi: string; scala: number }
> = {
  concimazione: { ddi: "0006", scala: 10 },
  fertilizzazione: { ddi: "0006", scala: 10 },
  trattamento: { ddi: "0001", scala: 100 },
  irrigation: { ddi: "0001", scala: 100 },
  semina: { ddi: "0028", scala: 0.0001 },
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** PNT ISOXML (C=Nord/lat, D=Est/lon in gradi decimali WGS84). */
function pnt(lon: number, lat: number): string {
  return `<PNT A="2" C="${lat}" D="${lon}"/>`;
}

/** Anello esterno di un poligono GeoJSON → PLN/LSG ISOXML (zona di trattamento). */
function polygonToPln(feature: Feature<Polygon>): string {
  const ring = feature.geometry.coordinates[0] ?? [];
  const punti = ring.map(([lon, lat]) => pnt(lon, lat)).join("");
  return `<PLN A="2"><LSG A="1">${punti}</LSG></PLN>`;
}

export interface IsoXmlMeta {
  /** Nome del task mostrato sul terminale. */
  taskName: string;
  /** Software di gestione (default AgroGea). */
  software?: string;
}

/**
 * Genera un TASKDATA.XML (ISO 11783-10) con una TreatmentZone per zona VRA,
 * ciascuna con il rateo come ProcessDataVariable e i poligoni delle celle.
 */
export function vraToIsoXml(
  result: RisultatoZoneVra,
  meta: IsoXmlMeta,
): string {
  const { ddi, scala } = DDI_LAVORAZIONE[result.lavorazione];
  const software = escapeXml(meta.software ?? "AgroGea");
  const taskName = escapeXml(meta.taskName);

  // Celle raggruppate per zona, così ogni TZN elenca i propri poligoni.
  const celleperZona = new Map<number, Feature<Polygon>[]>();
  for (const feature of result.fc.features) {
    const zona = Number(feature.properties?.zona ?? 0);
    const list = celleperZona.get(zona) ?? [];
    list.push(feature as Feature<Polygon>);
    celleperZona.set(zona, list);
  }

  const tzn = result.zone
    .map((zona) => {
      const valoreIso = Math.round(zona.rateo * scala);
      const polygons = (celleperZona.get(zona.zona) ?? [])
        .map(polygonToPln)
        .join("");
      return (
        `<TZN A="${zona.zona + 1}" B="${escapeXml(
          `Zona ${zona.zona + 1} (${zona.rateo} ${result.unita})`,
        )}">` +
        `<PDV A="${ddi}" B="${valoreIso}"/>` +
        polygons +
        `</TZN>`
      );
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ISO11783_TaskData VersionMajor="4" VersionMinor="0" ` +
    `ManagementSoftwareManufacturer="${software}" ` +
    `ManagementSoftwareVersion="1.0" DataTransferOrigin="1">` +
    `<TSK A="TSK1" B="${taskName}" G="1">` +
    tzn +
    `</TSK>` +
    `</ISO11783_TaskData>`
  );
}
