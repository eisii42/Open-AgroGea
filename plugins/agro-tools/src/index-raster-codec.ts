/**
 * Codec compatto del raster di un indice, per la cache locale del modulo Suolo.
 *
 * Persistere il GeoJSON delle celle costerebbe ~300 byte per pixel; il raster
 * sorgente ne costa 2, e `rasterToIndexCells` (funzione pura) ricostruisce le
 * celle identiche a partire da `RasterWindow` + valori. Su un appezzamento da
 * 50 ha significa ~10 KB per scena invece di ~1,5 MB.
 *
 * Formato: Int16 LITTLE-ENDIAN esplicito (non `Int16Array`, la cui endianness
 * segue la piattaforma), valori scalati di `valueScale` — con 10000 gli indici
 * normalizzati −1..1 conservano 4 decimali, ben oltre i 3 usati dalla UI — e
 * sentinella `nodataValue` sui pixel mascherati (fuori poligono o nodata della
 * scena), che nel raster sono `NaN`.
 *
 * Il buffer viaggia in base64 su una colonna `text`: mai `bytea`, per non
 * dipendere dalla serializzazione binaria del driver PGlite (stessa scelta di
 * `field_session_audio`).
 *
 * Parte pura e testabile: nessun accesso a DOM/rete/DB, gira identica nel Web
 * Worker, nel main thread e nei test Node.
 */

/** Scala di default: 4 decimali sull'intervallo −1..1 degli indici normalizzati. */
export const DEFAULT_INDEX_VALUE_SCALE = 10_000;

/** Sentinella dei pixel mascherati: il minimo Int16, mai prodotto da un valore scalato. */
export const DEFAULT_INDEX_NODATA = -32_768;

/** Estremi rappresentabili dopo la scalatura (il minimo è riservato al nodata). */
const INT16_MIN = -32_767;
const INT16_MAX = 32_767;

/** Chunk di caratteri per `String.fromCharCode`: sotto il limite di argomenti. */
const BASE64_CHUNK = 0x2000;

export interface EncodedIndexRaster {
  valueScale: number;
  nodataValue: number;
  valuesBase64: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Comprime un raster mascherato (NaN fuori dal poligono) in Int16 base64. I
 * valori oltre l'intervallo rappresentabile vengono saturati agli estremi:
 * gli indici normalizzati stanno in −1..1, quindi in pratica non accade mai,
 * ma un indice non normalizzato non deve poter corrompere la cache.
 */
export function encodeIndexRaster(
  values: Float32Array,
  options: { valueScale?: number; nodataValue?: number } = {},
): EncodedIndexRaster {
  const valueScale = options.valueScale ?? DEFAULT_INDEX_VALUE_SCALE;
  const nodataValue = options.nodataValue ?? DEFAULT_INDEX_NODATA;
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const scaled = Number.isFinite(value)
      ? Math.min(INT16_MAX, Math.max(INT16_MIN, Math.round(value * valueScale)))
      : nodataValue;
    view.setInt16(i * 2, scaled, true);
  }
  return {
    valueScale,
    nodataValue,
    valuesBase64: bytesToBase64(new Uint8Array(buffer)),
  };
}

/**
 * Ricostruisce il raster mascherato: i pixel a `nodataValue` tornano `NaN`,
 * esattamente come li produce `clipRasterToPolygon`, così le celle ricostruite
 * coincidono con quelle del calcolo originale.
 */
export function decodeIndexRaster(
  encoded: EncodedIndexRaster,
): Float32Array {
  const bytes = base64ToBytes(encoded.valuesBase64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 2);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const raw = view.getInt16(i * 2, true);
    values[i] = raw === encoded.nodataValue ? Number.NaN : raw / encoded.valueScale;
  }
  return values;
}
