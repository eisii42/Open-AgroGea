import type { OrthophotoSummary } from "@agrogea/tools";
import { vegetatedShare } from "@agrogea/tools";
import { fromArrayBuffer } from "geotiff";
import type { Geometry } from "geojson";
import { geometryBbox } from "./geo-compliance";

/**
 * Caricamento di un'ortofoto GeoTIFF per la BCAA 8.
 *
 * ## Perché la carica l'utente
 *
 * Le ortofoto ad altissima risoluzione — AGEA, voli regionali, rilievi con
 * drone — non hanno un catalogo pubblico interrogabile come le scene
 * Sentinel-2: chi le ha se le procura dal proprio ente o dal proprio volo. Il
 * modulo non può andarsele a prendere, ma può accettarle, ed è tutto quello
 * che serve perché la BCAA 8 smetta di essere "non decidibile".
 *
 * ## Che cosa legge
 *
 * Il file resta **in memoria**: non si persiste, non si sincronizza, non entra
 * nel backup. Un'ortofoto è decine o centinaia di megabyte e nulla di ciò che
 * serve alla scheda sopravvive al calcolo — quello che si conserva è l'esito,
 * con il nome del file e la risoluzione nella provenienza.
 *
 * Si leggono: risoluzione al suolo, numero di bande, estensione, e — quando le
 * bande sono almeno tre — la quota di pixel vegetati con Excess Green dentro il
 * poligono dell'appezzamento.
 *
 * ## Il limite da dire
 *
 * Il ritaglio sul poligono è fatto sul **bounding box** e non sulla geometria
 * esatta: su un appezzamento molto irregolare entrano nel conto pixel che gli
 * stanno fuori. È dichiarato nell'esito attraverso il numero di pixel
 * considerati, e resta accettabile perché la BCAA 8 ragiona su quote di
 * superficie e non su confini al centimetro.
 */

/** Errore leggibile dall'utente su un file non utilizzabile. */
export class OrthophotoError extends Error {}

/** Metri per grado di latitudine, per convertire la risoluzione se in gradi. */
const M_PER_DEG = 111_320;

/**
 * Risoluzione in metri. Un GeoTIFF proiettato (UTM) la dichiara già in metri;
 * uno geografico (EPSG:4326) in gradi, e va convertita — altrimenti una
 * risoluzione di 0,000002° verrebbe letta come 2 µm e l'ortofoto sembrerebbe
 * un milione di volte più fine di quanto è.
 *
 * Quale dei due sia **non si deduce dal valore**: un'ortofoto a 20 cm in UTM
 * dichiara `0.2`, che è piccolo quanto un valore in gradi. La discriminante è
 * il sistema di riferimento, che il chiamante ricava dall'estensione
 * dell'immagine (coordinate dentro ±180/±90 = geografiche) e passa qui.
 */
export function resolutionMeters(
  resX: number,
  latitudeDeg: number,
  geographic: boolean,
): number {
  const absolute = Math.abs(resX);
  return geographic
    ? absolute * M_PER_DEG * Math.cos((latitudeDeg * Math.PI) / 180)
    : absolute;
}

export async function loadOrthophoto(
  file: File,
  plotGeometry: Geometry,
): Promise<OrthophotoSummary> {
  const buffer = await file.arrayBuffer();
  let image;
  try {
    const tiff = await fromArrayBuffer(buffer);
    image = await tiff.getImage();
  } catch (error) {
    throw new OrthophotoError(
      `Il file non è un GeoTIFF leggibile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const [originX, originY] = image.getOrigin();
  const [resX, resYsigned] = image.getResolution();
  const resY = Math.abs(resYsigned);
  if (!Number.isFinite(originX) || !Number.isFinite(resX) || resX === 0) {
    throw new OrthophotoError(
      "Il GeoTIFF non è georeferenziato: senza georeferenziazione non si può ritagliare sull'appezzamento.",
    );
  }

  const [minLon, minLat, maxLon, maxLat] = geometryBbox(plotGeometry);
  const midLat = (minLat + maxLat) / 2;
  const bandCount = image.getSamplesPerPixel();

  // Sistema di riferimento dell'ortofoto: coordinate dentro ±180/±90 sono
  // gradi, tutto il resto è proiettato (in UTM gli easting stanno sulle
  // centinaia di migliaia). Da questo dipende sia la conversione della
  // risoluzione sia la possibilità di ritagliare sul poligono.
  const bounds = image.getBoundingBox();
  const geographic = Math.abs(bounds[0]) <= 180 && Math.abs(bounds[1]) <= 90;
  const gsdM = resolutionMeters(resX, midLat, geographic);

  // Finestra del poligono nelle coordinate dell'immagine. Se l'ortofoto è
  // proiettata, il bbox in gradi non è direttamente confrontabile: si ricade
  // sull'immagine intera, che è il comportamento onesto quando non si sa
  // riproiettare (e il numero di pixel lo dichiara).
  let window: [number, number, number, number];
  if (geographic) {
    const px0 = Math.max(0, Math.floor((minLon - originX) / resX));
    const px1 = Math.min(image.getWidth(), Math.ceil((maxLon - originX) / resX));
    const py0 = Math.max(0, Math.floor((originY - maxLat) / resY));
    const py1 = Math.min(image.getHeight(), Math.ceil((originY - minLat) / resY));
    if (px1 <= px0 || py1 <= py0) {
      throw new OrthophotoError(
        "L'ortofoto non copre l'appezzamento selezionato.",
      );
    }
    window = [px0, py0, px1, py1];
  } else {
    window = [0, 0, image.getWidth(), image.getHeight()];
  }

  const rasters = (await image.readRasters({ window })) as unknown as ArrayLike<
    ArrayLike<number>
  > & { width: number; height: number };
  const pixelsInPlot = (window[2] - window[0]) * (window[3] - window[1]);

  // ExG richiede R, G, B: con meno di tre bande la quota non si calcola, e la
  // scheda lo dice invece di inventare una classificazione.
  const share =
    bandCount >= 3
      ? vegetatedShare(rasters[0], rasters[1], rasters[2])
      : null;

  return {
    fileName: file.name,
    gsdM,
    bandCount,
    capturedAt: await readDateTime(image),
    pixelsInPlot,
    vegetatedShare: share,
  };
}

/**
 * Data di ripresa dal tag TIFF `DateTime` (`YYYY:MM:DD HH:MM:SS`), se c'è.
 * Molte ortofoto non lo valorizzano: l'assenza è normale e non è un errore.
 */
async function readDateTime(image: {
  fileDirectory: { loadValue(tag: "DateTime"): Promise<unknown> };
}): Promise<string | null> {
  try {
    const raw = await image.fileDirectory.loadValue("DateTime");
    if (typeof raw !== "string") return null;
    const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  } catch {
    return null;
  }
}
