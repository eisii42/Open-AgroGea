/**
 * Excess Green su un'ortofoto RGB: la sola cosa ragionevole che si possa
 * calcolare da tre bande visibili.
 *
 * ## Perché non NDVI
 *
 * L'NDVI richiede il vicino infrarosso, che un'ortofoto RGB non ha. Con le sole
 * bande visibili l'indice di riferimento in letteratura agronomica è
 * **ExG = 2g − r − b** (Woebbecke et al., 1995) sulle componenti cromatiche
 * normalizzate: separa la vegetazione dal suolo, dall'asfalto e dalle strutture
 * in modo robusto rispetto alle variazioni di illuminazione, perché normalizza
 * via l'intensità.
 *
 * ## Che cosa NON è
 *
 * **Non è una classificazione.** ExG distingue "verde" da "non verde": una
 * siepe, un prato, un'infestante e un telo verde danno lo stesso segnale. Serve
 * a misurare *quanta* superficie è vegetata quando la risoluzione lo permette,
 * non a dire *che cosa* la vegeta. Le schede che la usano lo dichiarano, e non
 * ne ricavano mai una contestazione.
 */

/** Soglia ExG oltre la quale il pixel si considera vegetato. */
export const DEFAULT_EXG_THRESHOLD = 0.1;

/**
 * Excess Green normalizzato di un pixel RGB (valori 0..1 o 0..255, indifferente:
 * la normalizzazione cromatica elimina la scala).
 *
 * Restituisce `NaN` per un pixel nero puro, dove le componenti cromatiche non
 * sono definite — e un `NaN` è corretto: di quel pixel non si sa il colore.
 */
export function excessGreen(red: number, green: number, blue: number): number {
  const sum = red + green + blue;
  if (!Number.isFinite(sum) || sum <= 0) return Number.NaN;
  const r = red / sum;
  const g = green / sum;
  const b = blue / sum;
  return 2 * g - r - b;
}

/**
 * Quota di pixel vegetati su una finestra RGB, contando solo i pixel dentro la
 * maschera del poligono (`mask[i] === 1`). Senza maschera si contano tutti.
 *
 * Restituisce `null` se non ci sono pixel validi: nessuna quota è meglio di una
 * quota calcolata su zero pixel.
 */
export function vegetatedShare(
  red: ArrayLike<number>,
  green: ArrayLike<number>,
  blue: ArrayLike<number>,
  options: { mask?: ArrayLike<number>; threshold?: number } = {},
): number | null {
  const threshold = options.threshold ?? DEFAULT_EXG_THRESHOLD;
  const mask = options.mask;
  let vegetated = 0;
  let valid = 0;
  for (let i = 0; i < red.length; i++) {
    if (mask && !mask[i]) continue;
    const value = excessGreen(red[i], green[i], blue[i]);
    if (!Number.isFinite(value)) continue;
    valid += 1;
    if (value >= threshold) vegetated += 1;
  }
  return valid === 0 ? null : vegetated / valid;
}

/**
 * La risoluzione basta a risolvere un oggetto largo `widthM`?
 *
 * Il criterio è **tre pixel sulla larghezza**: sotto, l'oggetto finisce dentro
 * pixel misti e la sua larghezza non è misurabile. È la stessa soglia del
 * fattore `resolution_fit` della confidenza, e vive qui perché la decisione
 * "questa ortofoto basta o no" deve dare la stessa risposta del fattore che poi
 * la spiega.
 */
export function resolvesFeature(gsdM: number, widthM: number): boolean {
  if (!Number.isFinite(gsdM) || gsdM <= 0) return false;
  return widthM / gsdM >= 3;
}
