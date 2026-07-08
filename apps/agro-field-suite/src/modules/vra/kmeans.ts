/**
 * K-means 1D **deterministico** per la zonazione VRA.
 *
 * Niente RNG: i centroidi iniziali sono presi a quantili regolari dei valori
 * sorted, così la stessa mappa indice produce sempre le stesse zone (risultati
 * riproducibili e testabili). I centroidi finali sono sorted in modo crescente
 * e le assegnazioni rimappate, così la zona 0 è sempre quella a value più basso.
 */

export interface KMeansResult {
  /** Indice del cluster (0..k-1, per value crescente) per ogni value input. */
  assignments: number[];
  /** Centroidi sorted in modo crescente. */
  centroids: number[];
}

/** Numero di valori distinti (determina il k massimo sensato). */
function distinctCount(sorted: number[]): number {
  let count = sorted.length > 0 ? 1 : 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1]) count += 1;
  }
  return count;
}

function nearestCentroid(value: number, centroids: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centroids.length; c += 1) {
    const dist = Math.abs(value - centroids[c]);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/**
 * Clusterizza valori 1D in `k` gruppi con l'algoritmo di Lloyd.
 *
 * @param values Valori finiti (es. NDVI per cella). I non-finiti vanno filtered
 *   dal chiamante.
 * @param k Numero di zone richiesto; ridotto al numero di valori distinti.
 * @param opts.maxIter Iterazioni massime (default 50).
 */
export function kmeans1d(
  values: number[],
  k: number,
  opts: { maxIter?: number } = {},
): KMeansResult {
  const maxIter = opts.maxIter ?? 50;
  if (values.length === 0) return { assignments: [], centroids: [] };

  const sorted = [...values].sort((a, b) => a - b);
  const effectiveK = Math.max(1, Math.min(Math.floor(k), distinctCount(sorted)));

  // Centroidi iniziali a quantili regolari: deterministici e ben distribuiti.
  let centroids = Array.from({ length: effectiveK }, (_, i) => {
    const q = effectiveK === 1 ? 0.5 : i / (effectiveK - 1);
    const idx = Math.round(q * (sorted.length - 1));
    return sorted[idx];
  });

  let assignments = new Array<number>(values.length).fill(0);
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (let i = 0; i < values.length; i += 1) {
      const c = nearestCentroid(values[i], centroids);
      if (c !== assignments[i]) {
        assignments[i] = c;
        changed = true;
      }
    }

    const sums = new Array<number>(effectiveK).fill(0);
    const counts = new Array<number>(effectiveK).fill(0);
    for (let i = 0; i < values.length; i += 1) {
      sums[assignments[i]] += values[i];
      counts[assignments[i]] += 1;
    }
    centroids = centroids.map((prev, c) =>
      counts[c] > 0 ? sums[c] / counts[c] : prev,
    );

    if (!changed && iter > 0) break;
  }

  // Ordina i centroidi in modo crescente e rimappa le assegnazioni: la zona 0
  // è la più "debole" (NDVI più basso), comodo per assegnare i ratei.
  const order = centroids
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const remap = new Array<number>(effectiveK);
  order.forEach((entry, newIndex) => {
    remap[entry.index] = newIndex;
  });

  return {
    assignments: assignments.map((c) => remap[c]),
    centroids: order.map((entry) => entry.value),
  };
}
