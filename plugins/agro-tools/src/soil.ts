import type { SoilParameters } from "./agrometeo";

/**
 * Pedotransfer del suolo — engine PURO (testabile sotto `node --test`).
 *
 * Traduce la TESSITURA (classi tessiturali o percentuali sabbia/limo/argilla) e
 * la sostanza organica nelle costanti idrauliche richieste dal bilancio idrico
 * FAO 56/66 ({@link SoilParameters}: capacità di campo θFC e punto di
 * appassimento θPWP), tramite le equazioni di **Saxton & Rawls (2006)**.
 *
 * Nessuna dipendenza da DB/rete: la risoluzione spaziale (Tier 1 mappa custom,
 * Tier 2 campionamenti georeferenziati) vive in `modules/soil/SoilDataResolver`
 * e si limita a comporre questo engine.
 */

/** Frazioni granulometriche del suolo (0..1, sommano a 1). */
export interface TextureFractions {
  /** Sabbia (sand). */
  sabbia: number;
  /** Limo (silt). */
  limo: number;
  /** Argilla (clay). */
  argilla: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Normalizza una stringa libera di tessitura: minuscole, accenti rimossi,
 * separatori (-, _, /, spazi) uniformati a spazio singolo.
 */
function normalizza(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z%0-9.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Centroidi USDA (sabbia/limo/argilla, frazioni 0..1) delle 12 classi
 * tessiturali. Valori di letteratura: punti medi del triangolo USDA.
 */
const CENTROIDI: Record<string, TextureFractions> = {
  sand: { sabbia: 0.92, limo: 0.05, argilla: 0.03 },
  loamy_sand: { sabbia: 0.82, limo: 0.12, argilla: 0.06 },
  sandy_loam: { sabbia: 0.65, limo: 0.25, argilla: 0.1 },
  loam: { sabbia: 0.4, limo: 0.4, argilla: 0.2 },
  silt_loam: { sabbia: 0.2, limo: 0.65, argilla: 0.15 },
  silt: { sabbia: 0.08, limo: 0.86, argilla: 0.06 },
  sandy_clay_loam: { sabbia: 0.6, limo: 0.13, argilla: 0.27 },
  clay_loam: { sabbia: 0.32, limo: 0.34, argilla: 0.34 },
  silty_clay_loam: { sabbia: 0.1, limo: 0.56, argilla: 0.34 },
  sandy_clay: { sabbia: 0.52, limo: 0.06, argilla: 0.42 },
  silty_clay: { sabbia: 0.07, limo: 0.46, argilla: 0.47 },
  clay: { sabbia: 0.22, limo: 0.2, argilla: 0.58 },
};

/**
 * Sinonimi multilingue (IT / EN / ES) → slug USDA. Le chiavi sono già
 * normalizzate da {@link normalizza}. Copre le forme più comuni del catalogo
 * AgroGea e degli import di laboratorio.
 */
const SINONIMI: Record<string, keyof typeof CENTROIDI> = {
  // sand
  sabbioso: "sand",
  sabbia: "sand",
  arenoso: "sand",
  sand: "sand",
  // loamy sand
  "sabbioso franco": "loamy_sand",
  "franco sabbia": "loamy_sand",
  "loamy sand": "loamy_sand",
  "franco arenoso grueso": "loamy_sand",
  // sandy loam
  "franco sabbioso": "sandy_loam",
  "sandy loam": "sandy_loam",
  "franco arenoso": "sandy_loam",
  // loam
  franco: "loam",
  loam: "loam",
  // silt loam
  "franco limoso": "silt_loam",
  "silt loam": "silt_loam",
  "franco limoso fino": "silt_loam",
  // silt
  limoso: "silt",
  silt: "silt",
  limo: "silt",
  // sandy clay loam
  "franco sabbioso argilloso": "sandy_clay_loam",
  "sandy clay loam": "sandy_clay_loam",
  "franco arcillo arenoso": "sandy_clay_loam",
  // clay loam
  "franco argilloso": "clay_loam",
  "clay loam": "clay_loam",
  "franco arcilloso": "clay_loam",
  // silty clay loam
  "franco limoso argilloso": "silty_clay_loam",
  "silty clay loam": "silty_clay_loam",
  "franco arcillo limoso": "silty_clay_loam",
  // sandy clay
  "sabbioso argilloso": "sandy_clay",
  "sandy clay": "sandy_clay",
  "arcillo arenoso": "sandy_clay",
  // silty clay
  "limoso argilloso": "silty_clay",
  "silty clay": "silty_clay",
  "arcillo limoso": "silty_clay",
  // clay
  argilloso: "clay",
  argilla: "clay",
  clay: "clay",
  arcilloso: "clay",
};

/**
 * Fallback euristico per classi non in tabella: assegna pesi alle famiglie
 * granulometriche in base ai termini presenti (multilingue) e normalizza. Così
 * etichette composte o atipiche restituiscono comunque frazioni plausibili.
 */
function frazioniDaKeyword(norm: string): TextureFractions | null {
  const ha = (re: RegExp) => re.test(norm);
  const sabbia = ha(/sabb|sand|aren/) ? 1 : 0;
  const limo = ha(/limo|silt|limos/) ? 1 : 0;
  const argilla = ha(/argill|clay|arcill/) ? 1 : 0;
  const franco = ha(/franc|loam/) ? 1 : 0;
  if (sabbia + limo + argilla + franco === 0) return null;
  // "franco" indica equilibrio: distribuisce su tutte le componenti.
  const pesoSabbia = sabbia * 2 + franco;
  const pesoLimo = limo * 2 + franco;
  const pesoArgilla = argilla * 2 + franco * 0.6;
  const tot = pesoSabbia + pesoLimo + pesoArgilla;
  if (tot <= 0) return null;
  return {
    sabbia: pesoSabbia / tot,
    limo: pesoLimo / tot,
    argilla: pesoArgilla / tot,
  };
}

/** Normalizza tre frazioni qualsiasi (anche in %) a somma 1, o null se nulle. */
export function normalizeFractions(
  sabbia: number,
  limo: number,
  argilla: number,
): TextureFractions | null {
  const s = Math.max(0, sabbia);
  const l = Math.max(0, limo);
  const a = Math.max(0, argilla);
  const tot = s + l + a;
  if (!(tot > 0)) return null;
  return { sabbia: s / tot, limo: l / tot, argilla: a / tot };
}

/**
 * Risolve le frazioni granulometriche da una classe tessiturale testuale
 * (IT/EN/ES). Prova prima il match esatto sui sinonimi, poi l'euristica a
 * keyword. Restituisce null se la stringa non è riconducibile a una tessitura.
 */
export function fractionsFromTexture(
  texture: string | null | undefined,
): TextureFractions | null {
  if (!texture) return null;
  const norm = normalizza(texture);
  if (norm.length === 0) return null;
  const slug = SINONIMI[norm];
  if (slug) return { ...CENTROIDI[slug] };
  return frazioniDaKeyword(norm);
}

export interface SaxtonRawlsOptions {
  /** Sostanza organica (% in peso), default 2.5 (terreno agrario tipico). */
  sostanzaOrganicaPct?: number;
  /** Profondità della zona radicale (m), default 0.8. */
  profonditaRadiciM?: number;
  /** Frazione di depletion FAO p (0..1), default 0.5. */
  depletionFraction?: number;
}

const DEFAULT_OM = 2.5;
const DEFAULT_PROFONDITA = 0.8;
const DEFAULT_DEPLEZIONE = 0.5;

/**
 * Equazioni di Saxton & Rawls (2006) per il punto di appassimento (θ a 1500 kPa)
 * e la capacità di campo (θ a 33 kPa) come frazioni volumetriche, da sabbia (S),
 * argilla (C) e sostanza organica (OM, %). Le costanti sono quelle pubblicate
 * (Soil Sci. Soc. Am. J. 70:1569-1578).
 */
export function saxtonRawls(
  frazioni: TextureFractions,
  sostanzaOrganicaPct = DEFAULT_OM,
): { fieldCapacity: number; wiltingPoint: number } {
  const S = clamp01(frazioni.sabbia);
  const C = clamp01(frazioni.argilla);
  const OM = Math.max(0, sostanzaOrganicaPct);

  // Punto di appassimento (1500 kPa).
  const t1500 =
    -0.024 * S +
    0.487 * C +
    0.006 * OM +
    0.005 * (S * OM) -
    0.013 * (C * OM) +
    0.068 * (S * C) +
    0.031;
  const pwp = t1500 + (0.14 * t1500 - 0.02);

  // Capacità di campo (33 kPa).
  const t33 =
    -0.251 * S +
    0.195 * C +
    0.011 * OM +
    0.006 * (S * OM) -
    0.027 * (C * OM) +
    0.452 * (S * C) +
    0.299;
  const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);

  // Vincoli fisici: 0 < PWP < FC < porosità (~0.55 max).
  const wiltingPoint = Math.max(0.01, Math.min(pwp, 0.4));
  const fieldCapacity = Math.max(
    wiltingPoint + 0.02,
    Math.min(fc, 0.55),
  );
  return { fieldCapacity, wiltingPoint };
}

/**
 * Compone {@link saxtonRawls} nei {@link SoilParameters} pronti per il bilancio
 * idrico FAO 66, applicando profondità radicale e frazione di depletion (con i
 * default agronomici, sovrascrivibili).
 */
export function saxtonRawlsSoilParameters(
  frazioni: TextureFractions,
  opzioni: SaxtonRawlsOptions = {},
): SoilParameters {
  const { fieldCapacity, wiltingPoint } = saxtonRawls(
    frazioni,
    opzioni.sostanzaOrganicaPct ?? DEFAULT_OM,
  );
  return {
    fieldCapacity,
    wiltingPoint,
    rootDepth: opzioni.profonditaRadiciM ?? DEFAULT_PROFONDITA,
    depletionFraction: opzioni.depletionFraction ?? DEFAULT_DEPLEZIONE,
  };
}
