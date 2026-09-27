import { utmToLonLat } from "@agrogea/tools";
import { fromArrayBuffer } from "geotiff";

/**
 * Ortofoto GeoTIFF → overlay georeferenziato sulla mappa.
 *
 * ## Perché serve una conversione
 *
 * MapLibre non legge il GeoTIFF: sa disporre un'immagine su quattro angoli
 * (`type: "image"`), e nient'altro. Il lavoro è quindi tradurre il raster in
 * qualcosa che il browser sappia disegnare — un PNG — e i suoi angoli in
 * longitudine e latitudine.
 *
 * ## I due limiti, dichiarati
 *
 * **L'immagine viene ridimensionata.** Un'ortofoto a 20 cm su cento ettari è
 * una texture da 50.000 pixel di lato: nessuna GPU la accetta come sorgente
 * singola, e decodificarla intera farebbe saltare la scheda. Si ricampiona al
 * lato massimo consentito, dichiarando il fattore: per guardarla va benissimo,
 * per misurarci sopra no — e infatti la BCAA 8 rilegge il file a piena
 * risoluzione per conto proprio invece di misurare su questa.
 *
 * **La sovrapposizione è un quadrilatero, non una riproiezione.** MapLibre
 * deforma l'immagine sui quattro angoli in modo lineare; la proiezione vera
 * curverebbe leggermente i lati. Su un'ortofoto aziendale — qualche chilometro
 * di lato — lo scarto è sotto il pixel. Su un'immagine regionale no, e si
 * vedrebbe ai bordi.
 */

/** Lato massimo della texture, in pixel. Oltre, le GPU mobili rifiutano. */
export const MAX_OVERLAY_SIDE = 4096;

export class GeoTiffOverlayError extends Error {}

export interface GeoTiffOverlay {
  /** PNG pronto per MapLibre (`source.url`). */
  dataUrl: string;
  /** Angoli in ordine MapLibre: alto-sx, alto-dx, basso-dx, basso-sx. */
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  width: number;
  height: number;
  /** Risoluzione originale al suolo, in metri. */
  gsdM: number;
  /** Fattore di ricampionamento applicato (1 = nessuno). */
  downscale: number;
  epsg: number | null;
}

/** EPSG della scena da ProjectedCSTypeGeoKey / GeographicTypeGeoKey. */
function epsgOf(image: {
  getGeoKeys?: () => Partial<Record<string, unknown>> | null;
}): number | null {
  const keys = image.getGeoKeys?.() ?? null;
  const projected = keys?.["ProjectedCSTypeGeoKey"];
  if (typeof projected === "number") return projected;
  const geographic = keys?.["GeographicTypeGeoKey"];
  return typeof geographic === "number" ? geographic : null;
}

/**
 * Angolo in lon/lat. Gestisce i due casi che le ortofoto reali usano davvero:
 * WGS84 geografico (4326) e UTM (326xx/327xx). Qualunque altro sistema viene
 * **rifiutato con il suo codice**, invece di essere disegnato nel posto
 * sbagliato: un'ortofoto fuori registro di centinaia di metri è peggio di
 * un'ortofoto che non si carica, perché sembra funzionare.
 */
function toLonLat(x: number, y: number, epsg: number | null): [number, number] {
  if (epsg === null || epsg === 4326 || epsg === 4258) return [x, y];
  const family = Math.floor(epsg / 100);
  if (family === 326 || family === 327) {
    const { lon, lat } = utmToLonLat(x, y, epsg);
    return [lon, lat];
  }
  throw new GeoTiffOverlayError(
    `Sistema di riferimento EPSG:${epsg} non supportato per la sovrapposizione: ` +
      "riproietta l'ortofoto in UTM o WGS84.",
  );
}

/** Normalizza un campione a 0–255 dal suo intervallo dichiarato. */
function toByte(value: number, min: number, range: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = ((value - min) / range) * 255;
  return scaled < 0 ? 0 : scaled > 255 ? 255 : Math.round(scaled);
}

export async function loadGeoTiffOverlay(file: File): Promise<GeoTiffOverlay> {
  let image;
  try {
    const tiff = await fromArrayBuffer(await file.arrayBuffer());
    image = await tiff.getImage();
  } catch (error) {
    throw new GeoTiffOverlayError(
      `Il file non è un GeoTIFF leggibile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const [originX, originY] = image.getOrigin();
  const [resX, resYsigned] = image.getResolution();
  if (!Number.isFinite(originX) || !Number.isFinite(resX) || resX === 0) {
    throw new GeoTiffOverlayError(
      "Il GeoTIFF non è georeferenziato: senza georeferenziazione non si può collocare sulla mappa.",
    );
  }
  const resY = Math.abs(resYsigned);
  const fullWidth = image.getWidth();
  const fullHeight = image.getHeight();
  const epsg = epsgOf(image);

  // Angoli nel sistema dell'immagine, poi in lon/lat.
  const maxX = originX + fullWidth * resX;
  const minY = originY - fullHeight * resY;
  const coordinates: GeoTiffOverlay["coordinates"] = [
    toLonLat(originX, originY, epsg),
    toLonLat(maxX, originY, epsg),
    toLonLat(maxX, minY, epsg),
    toLonLat(originX, minY, epsg),
  ];

  // Ricampionamento: geotiff.js accetta width/height e riduce in lettura, così
  // non si decodifica mai l'immagine intera in memoria.
  const downscale = Math.max(
    1,
    Math.ceil(Math.max(fullWidth, fullHeight) / MAX_OVERLAY_SIDE),
  );
  const width = Math.max(1, Math.floor(fullWidth / downscale));
  const height = Math.max(1, Math.floor(fullHeight / downscale));

  const rasters = (await image.readRasters({
    width,
    height,
  })) as unknown as ArrayLike<ArrayLike<number>>;
  const bandCount = image.getSamplesPerPixel();
  if (bandCount < 1) {
    throw new GeoTiffOverlayError("Il GeoTIFF non contiene bande leggibili.");
  }

  // Intervallo dei valori: un'ortofoto a 8 bit sta già in 0–255, una a 16 bit
  // no, e disegnarla senza normalizzare darebbe un'immagine nera.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let b = 0; b < Math.min(3, bandCount); b++) {
    const band = rasters[b];
    for (let i = 0; i < band.length; i++) {
      const value = band[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const range = max > min ? max - min : 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new GeoTiffOverlayError("Canvas non disponibile in questo contesto.");
  }
  const rgba = context.createImageData(width, height);
  const red = rasters[0];
  const green = bandCount >= 3 ? rasters[1] : rasters[0];
  const blue = bandCount >= 3 ? rasters[2] : rasters[0];
  // La quarta banda di un'ortofoto è l'alpha solo se il file lo dichiara; in
  // mancanza si assume opaca, che è il caso normale.
  const alpha = bandCount >= 4 ? rasters[3] : null;
  for (let i = 0; i < width * height; i++) {
    rgba.data[i * 4] = toByte(red[i], min, range);
    rgba.data[i * 4 + 1] = toByte(green[i], min, range);
    rgba.data[i * 4 + 2] = toByte(blue[i], min, range);
    rgba.data[i * 4 + 3] = alpha ? toByte(alpha[i], min, range) : 255;
  }
  context.putImageData(rgba, 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    coordinates,
    width,
    height,
    // La risoluzione dichiarata è quella ORIGINALE: è il dato che serve a
    // capire se l'ortofoto è adatta a una verifica, non quella della texture.
    gsdM: epsg === 4326 || epsg === 4258 ? resX * 111_320 : resX,
    downscale,
    epsg,
  };
}
