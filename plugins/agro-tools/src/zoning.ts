/**
 * Zonazione per mappe di prescrizione a rateo variabile (VRA).
 *
 * K-Means 1-D sui valori di un indice (es. NDVI storico medio) per raggruppare
 * i pixel in classi di vigore omogenee. Implementazione deterministica:
 *   * inizializzazione dei centroidi per quantili (non casuale) → stesso input,
 *     stesso output, requisito per mappe riproducibili e auditabili;
 *   * 1-D, quindi l'assegnazione è una semplice ricerca della soglia.
 *
 * Output orientato all'uso agronomico: per ogni classe i confini, il centroid,
 * la numerosità e (opzionale) la dose prescritta. Le geometrie delle zone si
 * vettorializzano poi in DuckDB Spatial (fase B); qui si lavora sui soli valori.
 */

export interface ClasseVigore {
  /** Indice di classe, 0 = vigore minore. */
  classe: number;
  /** Valore medio dell'indice nella classe (centroid). */
  centroid: number;
  /** Estremi [min,max) dell'indice che ricadono nella classe. */
  intervallo: [number, number];
  /** Numero di pixel assegnati. */
  pixel: number;
  /** Frazione del totale (0..1). */
  frazione: number;
}

export interface RisultatoZonazione {
  classi: ClasseVigore[];
  /** Soglie che separano le classi (length = k − 1). */
  soglie: number[];
  /** Indice di classe per ogni pixel valido, allineato all'input filtrato. */
  assegnazioni: Int8Array;
  iterazioni: number;
}

export type LogicaVRA = "conservativa" | "spinta";

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Esegue K-Means 1-D sui valori finiti dell'array (i NaN del soil-masking sono
 * scartati). `k` è il numero di classi (tipicamente 3/4/5). Lancia se i valori
 * finiti sono meno di `k`.
 */
export function zonazioneKMeans(
  values: Float32Array | number[],
  k: number,
  options: { maxIter?: number; tolleranza?: number } = {},
): RisultatoZonazione {
  if (k < 2) throw new Error("La zonazione richiede almeno 2 classi.");
  const maxIter = options.maxIter ?? 50;
  const tol = options.tolleranza ?? 1e-6;

  const finiti: number[] = [];
  for (const v of values) if (Number.isFinite(v)) finiti.push(v);
  if (finiti.length < k) {
    throw new Error(
      `Pixel validi insufficienti (${finiti.length}) per ${k} classi.`,
    );
  }

  const sorted = [...finiti].sort((a, b) => a - b);
  // Centroidi iniziali ai quantili: 1/(2k), 3/(2k), … distribuiti nel range.
  let centroidi = Array.from({ length: k }, (_, i) =>
    quantile(sorted, (2 * i + 1) / (2 * k)),
  );

  const assegnazioni = new Int8Array(finiti.length);
  let iterazioni = 0;
  for (; iterazioni < maxIter; iterazioni++) {
    // Assegnazione: in 1-D il cluster più vicino si trova per soglie mediane.
    const soglie = centroidi
      .slice(0, -1)
      .map((c, i) => (c + centroidi[i + 1]) / 2);
    for (let p = 0; p < finiti.length; p++) {
      let cls = 0;
      while (cls < soglie.length && finiti[p] >= soglie[cls]) cls++;
      assegnazioni[p] = cls;
    }
    // Aggiornamento centroidi (media dei membri); cluster vuoti restano fermi.
    const somme = new Array(k).fill(0);
    const conteggi = new Array(k).fill(0);
    for (let p = 0; p < finiti.length; p++) {
      somme[assegnazioni[p]] += finiti[p];
      conteggi[assegnazioni[p]]++;
    }
    let spostamento = 0;
    const nuovi = centroidi.map((c, i) => {
      if (conteggi[i] === 0) return c;
      const media = somme[i] / conteggi[i];
      spostamento = Math.max(spostamento, Math.abs(media - c));
      return media;
    });
    centroidi = nuovi;
    if (spostamento < tol) {
      iterazioni++;
      break;
    }
  }

  const conteggi = new Array(k).fill(0);
  const minClasse = new Array(k).fill(Number.POSITIVE_INFINITY);
  const maxClasse = new Array(k).fill(Number.NEGATIVE_INFINITY);
  for (let p = 0; p < finiti.length; p++) {
    const c = assegnazioni[p];
    conteggi[c]++;
    if (finiti[p] < minClasse[c]) minClasse[c] = finiti[p];
    if (finiti[p] > maxClasse[c]) maxClasse[c] = finiti[p];
  }

  const classi: ClasseVigore[] = centroidi.map((centroid, i) => ({
    classe: i,
    centroid,
    intervallo: [
      conteggi[i] > 0 ? minClasse[i] : Number.NaN,
      conteggi[i] > 0 ? maxClasse[i] : Number.NaN,
    ],
    pixel: conteggi[i],
    frazione: conteggi[i] / finiti.length,
  }));

  const soglieFinali = centroidi
    .slice(0, -1)
    .map((c, i) => (c + centroidi[i + 1]) / 2);

  return { classi, soglie: soglieFinali, assegnazioni, iterazioni };
}

/**
 * Calcola le dosi per classe a partire da una dose di riferimento.
 *
 *   * "conservativa": più dose dove il vigore è BASSO (riempire le carenze),
 *     uniformando la coltura — tipico per azoto/concimazione di sostegno.
 *   * "spinta": più dose dove il vigore è ALTO (assecondare il potenziale
 *     produttivo) — tipico per la semina a rateo variabile.
 *
 * `intensita` (0..1) regola lo scostamento massimo dalla dose di riferimento.
 * Le classi sono ordinate per centroid crescente prima di mappare le dosi.
 */
export function dosiPerClasse(
  classi: ClasseVigore[],
  doseRiferimento: number,
  logica: LogicaVRA,
  intensita = 0.3,
): { classe: number; dose: number }[] {
  const ordinate = [...classi].sort((a, b) => a.centroid - b.centroid);
  const n = ordinate.length;
  if (n < 2) return ordinate.map((c) => ({ classe: c.classe, dose: doseRiferimento }));

  return ordinate.map((c, rank) => {
    // rank 0 = vigore minore → +1; rank max = vigore maggiore → −1.
    const posizione = (rank / (n - 1)) * 2 - 1; // da −1 a +1
    const segno = logica === "conservativa" ? -1 : 1;
    const fattore = 1 + segno * posizione * intensita;
    return {
      classe: c.classe,
      dose: Math.max(0, doseRiferimento * fattore),
    };
  });
}
