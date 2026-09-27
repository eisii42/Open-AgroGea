import type {
  Confidence,
  ConfidenceFactor,
  ConfidenceFactorId,
  IndexSeriesPoint,
  Observability,
} from "./check-types";
import { LIMITING_SCORE } from "./check-types";

/**
 * Modello di incertezza del modulo Compliance.
 *
 * ## Perché non basta un numero
 *
 * "Confidenza 0,55" non dice nulla a un agricoltore. Serve sapere se quel 0,55
 * viene dalle nuvole (aspetta due settimane e migliora), dalla dimensione della
 * parcella (non migliorerà mai con Sentinel-2) o dall'archivio troppo corto
 * (migliorerà fra un anno). Per questo la confidenza è la LISTA dei fattori con
 * il loro contributo, e `limitedBy` dice quali la stanno tirando giù.
 *
 * ## Media pesata, non anello debole
 *
 * Il valore è una media pesata degli score. L'alternativa — prendere il minimo,
 * l'anello debole — è più prudente ma butta via informazione: due schede con
 * confidenza 0,4 possono essere una "quasi buona tranne le nuvole" e l'altra
 * "scarsa su tutto", e vanno distinte. L'onestà è preservata da `limitedBy`,
 * che espone comunque l'anello debole invece di lasciarlo annegare nella media.
 *
 * ## La confidenza non salva un esito che non si può dare
 *
 * I presupposti bloccanti (zero scene utili, pixel puri sotto soglia, archivio
 * troppo corto, dato dichiarato mancante) NON producono un esito con confidenza
 * bassa: producono `undecidable`, prima che il metodo giri. Vedi `runner.ts`.
 * La confidenza gradua solo gli esiti che si possono dare — e viene calcolata
 * anche per gli `undecidable`, perché mostrarne i fattori è precisamente il
 * modo di spiegare all'utente perché non si è deciso.
 */

/** Rivisita nominale di Sentinel-2 in giorni (due satelliti, alle medie latitudini). */
export const SENTINEL2_REVISIT_DAYS = 5;

/** Risoluzione al suolo delle bande principali di Sentinel-2, in metri. */
export const SENTINEL2_GSD_M = 10;

/**
 * Pesi di default dei fattori. Non sono sacri: una scheda può sovrascriverli
 * motivandolo (la B5 sugli elementi non produttivi, per esempio, pesa la
 * risoluzione più di ogni altra cosa, perché è lì che si gioca tutto).
 */
export const DEFAULT_FACTOR_WEIGHTS: Record<ConfidenceFactorId, number> = {
  scene_count: 1,
  temporal_gap: 1,
  cloud_cover: 0.8,
  pure_pixels: 1.2,
  resolution_fit: 1,
  declared_data: 1,
  archive_depth: 1,
};

/** Giorni fra due date ISO (positivi se `to` è successiva a `from`). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return (b - a) / 86_400_000;
}

/**
 * Stima dei pixel PURI di un appezzamento: quelli che restano dopo aver
 * scartato una corona di un pixel lungo il bordo, dove il segnale è mescolato
 * con ciò che sta fuori (strada, siepe, altro appezzamento).
 *
 * Si assume la forma peggiore-ragionevole, il quadrato: lato = √area, e il lato
 * utile si accorcia di due volte la risoluzione. È un'APPROSSIMAZIONE
 * dichiarata, non una misura — la geometria reale darebbe un numero migliore ma
 * richiederebbe un buffer negativo vero, che non appartiene a una funzione pura
 * senza dipendenze geometriche. L'approssimazione è conservativa per le forme
 * allungate (che hanno più bordo di un quadrato) e ottimista solo per quelle
 * quasi circolari.
 *
 * Il conto spiega da solo perché sotto ~0,3 ha Sentinel-2 non basta: 0,3 ha è
 * un quadrato di ~55 m, che tolti 10 m per lato lascia ~35 m, cioè poco più di
 * una dozzina di pixel puri.
 */
export function purePixelEstimate(areaHa: number, gsdM = SENTINEL2_GSD_M): number {
  if (!Number.isFinite(areaHa) || areaHa <= 0) return 0;
  const sideM = Math.sqrt(areaHa * 10_000);
  const usableSideM = sideM - 2 * gsdM;
  if (usableSideM <= 0) return 0;
  return Math.floor((usableSideM * usableSideM) / (gsdM * gsdM));
}

/** Score 0..1 lineare fra `zero` e `full`, con clamp agli estremi. */
export function rampScore(value: number, zero: number, full: number): number {
  if (!Number.isFinite(value)) return 0;
  if (full === zero) return value >= full ? 1 : 0;
  const t = (value - zero) / (full - zero);
  return Math.max(0, Math.min(1, t));
}

function factor(
  id: ConfidenceFactorId,
  score: number,
  observed: ConfidenceFactor["observed"],
  weight = DEFAULT_FACTOR_WEIGHTS[id],
): ConfidenceFactor {
  const clamped = Math.max(0, Math.min(1, score));
  return { id, score: clamped, weight, observed, limiting: clamped < LIMITING_SCORE };
}

/**
 * Numero di scene attese in una finestra, data la rivisita del sensore. È il
 * denominatore onesto del fattore `scene_count`: dire "4 scene" senza dire
 * "su 9 attese" non informa nessuno.
 */
export function expectedScenes(
  from: string,
  to: string,
  revisitDays = SENTINEL2_REVISIT_DAYS,
): number {
  const span = daysBetween(from, to);
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(1, Math.round(span / revisitDays));
}

/** Fattore "numero di scene utili rispetto alle attese". */
export function sceneCountFactor(
  usable: number,
  expected: number,
  weight?: number,
): ConfidenceFactor {
  const ratio = expected <= 0 ? 0 : usable / expected;
  return factor(
    "scene_count",
    // Metà delle scene attese è già una serie utilizzabile; sotto un quarto
    // non lo è. Fra i due estremi lo score sale linearmente.
    rampScore(ratio, 0.25, 0.75),
    { id: "factor.sceneCount", values: { usable, expected } },
    weight,
  );
}

/**
 * Fattore "buco temporale": il massimo intervallo scoperto fra due scene utili
 * consecutive. Un evento di gestione (uno sfalcio, una lavorazione) dura pochi
 * giorni nel segnale: un buco di tre settimane può nasconderlo per intero, e
 * questo va detto anche quando le scene totali sono tante.
 */
export function temporalGapFactor(
  maxGapDays: number,
  toleratedGapDays: number,
  weight?: number,
): ConfidenceFactor {
  const score =
    toleratedGapDays <= 0
      ? 0
      : rampScore(maxGapDays, toleratedGapDays * 3, toleratedGapDays);
  return factor(
    "temporal_gap",
    score,
    {
      id: "factor.temporalGap",
      values: {
        maxGapDays: Math.round(maxGapDays),
        toleratedGapDays: Math.round(toleratedGapDays),
      },
    },
    weight,
  );
}

/** Fattore "nuvolosità media delle scene usate". */
export function cloudCoverFactor(
  meanCloudPct: number | null,
  weight?: number,
): ConfidenceFactor {
  const value = meanCloudPct ?? 0;
  return factor(
    "cloud_cover",
    // Sotto il 10% la scena è pulita; oltre il 60% resta poco di utilizzabile
    // anche dopo il mascheramento delle nuvole.
    rampScore(value, 60, 10),
    { id: "factor.cloudCover", values: { meanCloudPct: Math.round(value) } },
    weight,
  );
}

/** Fattore "pixel puri": quanto l'appezzamento è grande per il sensore. */
export function purePixelFactor(
  areaHa: number,
  minPurePixels: number,
  gsdM = SENTINEL2_GSD_M,
  weight?: number,
): ConfidenceFactor {
  const pure = purePixelEstimate(areaHa, gsdM);
  return factor(
    "pure_pixels",
    // Al minimo richiesto lo score è zero: sotto non si decide affatto (il
    // runner produce `undecidable`), sopra cresce fino a dieci volte il minimo,
    // dove la statistica zonale è solida.
    rampScore(pure, minPurePixels, minPurePixels * 10),
    {
      id: "factor.purePixels",
      values: { purePixels: pure, minPurePixels, gsdM },
    },
    weight,
  );
}

/**
 * Fattore "adeguatezza della risoluzione": quanto è grande, in metri, l'oggetto
 * che l'obbligo riguarda, rispetto al pixel. Una siepe larga 2 m dentro un
 * pixel da 10 m non è osservabile — e la scheda deve dirlo prima, non dopo.
 */
export function resolutionFitFactor(
  objectSizeM: number,
  gsdM = SENTINEL2_GSD_M,
  weight?: number,
): ConfidenceFactor {
  const ratio = gsdM <= 0 ? 0 : objectSizeM / gsdM;
  return factor(
    "resolution_fit",
    // Sotto un pixel non si risolve nulla; da tre pixel in su l'oggetto è
    // misurabile con margine.
    rampScore(ratio, 1, 3),
    { id: "factor.resolutionFit", values: { objectSizeM, gsdM } },
    weight,
  );
}

/** Fattore "completezza dei dati dichiarati" (Quaderno, campagna, magazzino). */
export function declaredDataFactor(
  present: number,
  required: number,
  weight?: number,
): ConfidenceFactor {
  const ratio = required <= 0 ? 1 : present / required;
  return factor(
    "declared_data",
    rampScore(ratio, 0, 1),
    { id: "factor.declaredData", values: { present, required } },
    weight,
  );
}

/** Fattore "profondità dell'archivio" per le schede pluriennali. */
export function archiveDepthFactor(
  availableYears: number,
  requiredYears: number,
  weight?: number,
): ConfidenceFactor {
  const ratio = requiredYears <= 0 ? 1 : availableYears / requiredYears;
  return factor(
    "archive_depth",
    rampScore(ratio, 0.5, 1),
    {
      id: "factor.archiveDepth",
      values: { availableYears, requiredYears },
    },
    weight,
  );
}

/**
 * Compone i fattori nella confidenza finale. `limitedBy` elenca i fattori sotto
 * {@link LIMITING_SCORE}, ordinati dal più penalizzante: è ciò che la UI legge
 * per dire "confidenza 0,55, limitata da nuvolosità e numero di scene" invece
 * di mostrare un numero nudo che nessuno sa interpretare.
 */
export function combineConfidence(
  factors: readonly ConfidenceFactor[],
): Confidence {
  if (factors.length === 0) {
    return { value: 0, factors: [], limitedBy: [] };
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const f of factors) {
    const weight = Number.isFinite(f.weight) && f.weight > 0 ? f.weight : 0;
    weighted += f.score * weight;
    totalWeight += weight;
  }
  const value = totalWeight === 0 ? 0 : weighted / totalWeight;
  const limitedBy = factors
    .filter((f) => f.limiting)
    .slice()
    .sort((a, b) => a.score - b.score)
    .map((f) => f.id);
  return {
    // Due decimali: oltre sarebbe una precisione che il metodo non ha.
    value: Math.round(value * 100) / 100,
    factors,
    limitedBy,
  };
}

/**
 * Tetto di confidenza per osservabilità dichiarata. Una scheda a osservabilità
 * bassa non può risultare "molto confidente" solo perché quel giorno il cielo
 * era sereno: il limite non è il meteo, è il sensore.
 */
export const OBSERVABILITY_CEILING: Record<Observability, number> = {
  high: 1,
  medium: 0.8,
  low: 0.45,
};

/** Applica il tetto di osservabilità a una confidenza già composta. */
export function capByObservability(
  confidence: Confidence,
  observability: Observability,
): Confidence {
  const ceiling = OBSERVABILITY_CEILING[observability];
  if (confidence.value <= ceiling) return confidence;
  return { ...confidence, value: ceiling };
}

// ---------------------------------------------------------------------------
// Statistiche di serie usate dai fattori
// ---------------------------------------------------------------------------

/** Massimo intervallo in giorni fra punti consecutivi (0 con meno di due punti). */
export function maxGapDays(points: readonly IndexSeriesPoint[]): number {
  if (points.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const gap = daysBetween(points[i - 1].date, points[i].date);
    if (Number.isFinite(gap) && gap > max) max = gap;
  }
  return max;
}

/** Nuvolosità media delle scene, ignorando quelle che non la dichiarano. */
export function meanCloudCover(
  points: readonly IndexSeriesPoint[],
): number | null {
  const values = points
    .map((p) => p.cloudCoverPct)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
