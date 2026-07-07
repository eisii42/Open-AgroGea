import type { WeatherReading } from "@agrogea/core";
import type { MeteoGiornoDss } from "../types";

/**
 * Costruzione della serie meteo GIORNALIERA per i DSS, a partire dalle letture
 * orarie/locali di PGlite (`letture_meteo`, il "meteo_osservazioni" della
 * specifica). È il ponte del refactor §3: i motori puri di `@agrogea/tools`
 * restano invariati e tutto ciò che li alimenta proviene ESCLUSIVAMENTE dal DB
 * locale.
 *
 * Prevenzione crash (sensore offline / buchi nella serie): la serie viene resa
 * continua giorno per giorno e i buchi sono colmati con fallback — temperatura
 * per interpolazione lineare, umidità/pioggia per media dei giorni adiacenti —
 * così nessun DSS riceve mai `NaN` o una serie discontinua.
 */

const MS_GIORNO = 24 * 3600 * 1000;

interface GiornoAgg {
  data: string;
  tMin: number | null;
  tMax: number | null;
  rhMedia: number | null;
  pioggia: number | null;
  bagnaturaOre: number;
  /** Numero di letture orarie confluite nel giorno (0 = giorno mancante). */
  campioni: number;
}

/** Parte data "YYYY-MM-DD" (UTC) di un timestamp ISO. */
function giornoDi(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Media degli elementi finiti, o null se l'array è vuoto. */
function mediaFinita(valori: number[]): number | null {
  const ok = valori.filter((v) => Number.isFinite(v));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** Aggrega le letture (orarie) in record giornalieri grezzi, con buchi. */
function aggregaPerGiorno(letture: WeatherReading[]): Map<string, GiornoAgg> {
  const perGiorno = new Map<string, GiornoAgg>();
  for (const l of letture) {
    const data = giornoDi(l.measured_at);
    let agg = perGiorno.get(data);
    if (!agg) {
      agg = {
        data,
        tMin: null,
        tMax: null,
        rhMedia: null,
        pioggia: null,
        bagnaturaOre: 0,
        campioni: 0,
      };
      perGiorno.set(data, agg);
    }
    const t = l.air_temperature;
    if (t != null && Number.isFinite(t)) {
      agg.tMin = agg.tMin == null ? t : Math.min(agg.tMin, t);
      agg.tMax = agg.tMax == null ? t : Math.max(agg.tMax, t);
    }
    const rh = l.relative_humidity;
    if (rh != null && Number.isFinite(rh)) {
      // Media incrementale su rhMedia con conteggio campioni separato sarebbe
      // più preciso; qui basta accumulare e mediare a valle (vedi sotto).
      agg.rhMedia = (agg.rhMedia ?? 0) + rh;
    }
    const p = l.rain_mm;
    if (p != null && Number.isFinite(p)) {
      agg.pioggia = (agg.pioggia ?? 0) + p;
    }
    const bag = l.leaf_wetness;
    if (bag != null && Number.isFinite(bag)) {
      agg.bagnaturaOre += bag; // ogni lettura oraria contribuisce 0..1 ore
    }
    agg.campioni += 1;
  }
  // rhMedia accumulata → media reale per il numero di letture del giorno.
  for (const agg of perGiorno.values()) {
    if (agg.rhMedia != null && agg.campioni > 0) {
      agg.rhMedia = agg.rhMedia / agg.campioni;
    }
  }
  return perGiorno;
}

/** Tutte le date "YYYY-MM-DD" da `inizio` a `fine` incluse. */
function enumeraGiorni(inizio: string, fine: string): string[] {
  const out: string[] = [];
  let t = new Date(`${inizio}T00:00:00Z`).getTime();
  const tFine = new Date(`${fine}T00:00:00Z`).getTime();
  while (t <= tFine) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += MS_GIORNO;
  }
  return out;
}

/**
 * Interpolazione lineare dei `null` in un array numerico: ogni buco è stimato
 * sulla retta tra i due valori noti che lo racchiudono; i buchi alle estremità
 * sono riempiti col valore noto più vicino (forward/back fill).
 */
function interpolaLineare(valori: (number | null)[]): number[] {
  const n = valori.length;
  const out = valori.slice();
  let i = 0;
  while (i < n) {
    if (out[i] != null) {
      i++;
      continue;
    }
    // Buco da i: trova precedente e successivo noti.
    const prev = i - 1;
    let next = i;
    while (next < n && out[next] == null) next++;
    const vPrev = prev >= 0 ? (out[prev] as number) : null;
    const vNext = next < n ? (out[next] as number) : null;
    for (let k = i; k < next; k++) {
      if (vPrev != null && vNext != null) {
        const frazione = (k - prev) / (next - prev);
        out[k] = vPrev + (vNext - vPrev) * frazione;
      } else {
        out[k] = (vPrev ?? vNext) as number; // estremità: nearest fill
      }
    }
    i = next;
  }
  // Serie interamente vuota: nessun riferimento → resta da gestire a monte.
  return out.map((v) => (v == null ? Number.NaN : v));
}

/**
 * Riempie i `null` con la media dei giorni adiacenti noti (fino a `raggio`
 * giorni per lato). Fallback per umidità e pioggia, dove l'interpolazione
 * lineare avrebbe meno senso fisico della media locale.
 */
function riempiMediaAdiacenti(
  valori: (number | null)[],
  raggio = 3,
): number[] {
  const n = valori.length;
  return valori.map((v, i) => {
    if (v != null && Number.isFinite(v)) return v;
    const vicini: number[] = [];
    for (let d = 1; d <= raggio; d++) {
      const a = valori[i - d];
      const b = valori[i + d];
      if (a != null && Number.isFinite(a)) vicini.push(a);
      if (b != null && Number.isFinite(b)) vicini.push(b);
      if (vicini.length > 0) break; // bastano i più prossimi
    }
    return mediaFinita(vicini) ?? 0;
  });
}

/**
 * Serie giornaliera continua e priva di NaN per i DSS. Ritorna `[]` solo se non
 * c'è alcuna lettura: i moduli interpretano la serie vuota come "dati meteo
 * assenti" senza crashare.
 */
export function costruisciSerieDss(letture: WeatherReading[]): MeteoGiornoDss[] {
  if (letture.length === 0) return [];
  const perGiorno = aggregaPerGiorno(letture);
  const date = [...perGiorno.keys()].sort();
  if (date.length === 0) return [];

  const giorni = enumeraGiorni(date[0], date[date.length - 1]);
  const tMinRaw = giorni.map((d) => perGiorno.get(d)?.tMin ?? null);
  const tMaxRaw = giorni.map((d) => perGiorno.get(d)?.tMax ?? null);
  const rhRaw = giorni.map((d) => perGiorno.get(d)?.rhMedia ?? null);
  const pioggiaRaw = giorni.map((d) => perGiorno.get(d)?.pioggia ?? null);
  const bagnaturaRaw = giorni.map((d) => perGiorno.get(d)?.bagnaturaOre ?? null);

  const tMin = interpolaLineare(tMinRaw);
  const tMax = interpolaLineare(tMaxRaw);
  const rh = riempiMediaAdiacenti(rhRaw);
  const pioggia = riempiMediaAdiacenti(pioggiaRaw);
  const bagnatura = riempiMediaAdiacenti(bagnaturaRaw);

  return giorni.map((data, i) => {
    // Guardia finale anti-NaN: una serie tutta-vuota su un canale ricade su 0;
    // tMin/tMax incoerenti vengono riordinati.
    const lo = Number.isFinite(tMin[i]) ? tMin[i] : 0;
    const hi = Number.isFinite(tMax[i]) ? tMax[i] : lo;
    return {
      data,
      tMin: Math.min(lo, hi),
      tMax: Math.max(lo, hi),
      rhMedia: Number.isFinite(rh[i]) ? rh[i] : 0,
      pioggia: Number.isFinite(pioggia[i]) ? pioggia[i] : 0,
      bagnaturaOre: Number.isFinite(bagnatura[i]) ? bagnatura[i] : 0,
    };
  });
}
