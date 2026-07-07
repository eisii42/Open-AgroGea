import type { WeatherReading, TreatmentLog } from "@agrogea/core";
import {
  waterBalanceFao66,
  type WaterBalanceDay,
  type CropType,
  type WeatherDataDay,
  et0PenmanMonteith,
  cropEt,
  type PhenologicalPhase,
  getPhaseCalibration,
  type SoilParameters,
} from "@agrogea/tools";

/**
 * Motore dinamico di BILANCIO IDRICO (FAO 56/66) — layer di ORCHESTRAZIONE
 * (refactor §3). Non duplica le formule: compone gli engine puri di
 * `@agrogea/tools`
 *   * `et0PenmanMonteith` (FAO-56) → ET0 di riferimento da `weather_readings`;
 *   * `cropEt` = ET0·Kc, con Kc per phase fenologica dalla `crops`;
 *   * `waterBalanceFao66` → depletion radicale Dr,t con DP esplicito.
 *
 * Tutto in locale, su dati PGlite. È puro (stringhe/array/oggetti): la lettura
 * del DAL e la persistenza in `soil_water_indices` vivono nel hook chiamante,
 * così questo file resta testabile sotto `node --test`.
 */

/** 1 mm d'acqua distribuito su 1 ha = 10 000 litri. */
const LITRI_PER_MM_HA = 10_000;

export interface ApportoIrriguo {
  /** Data ISO "YYYY-MM-DD" (o timestamp) dell'apporto. */
  data: string;
  /** Lama d'acqua applicata (mm). */
  mm: number;
}

export interface BilancioIdricoParams {
  /** Letture meteo orarie/giornaliere dell'azienda (`weather_readings`). */
  letture: WeatherReading[];
  /** Apporti irrigui giornalieri (mm), dai log gestionali. */
  irrigazioni?: ApportoIrriguo[];
  coltura: CropType;
  phase: PhenologicalPhase;
  suolo: SoilParameters;
  /** Quota della stazione (m s.l.m.) per il termine altimetrico di ET0. */
  altitude?: number;
  /** Deplezione radicale iniziale Dr,0 (mm). */
  deplezioneIniziale?: number;
}

/** Riga giornaliera del bilancio idrico, pronta per `soil_water_indices`. */
export interface IndiceIdricoGiorno {
  data: string;
  et0: number;
  etc: number;
  rain: number;
  irrigation: number;
  percolation: number;
  depletion: number;
  raw: number;
  awc: number;
  inStress: boolean;
}

export interface BilancioIdricoOutput {
  kc: number;
  series: IndiceIdricoGiorno[];
  /** Giorni di autonomia prima del primo stress (index nella series). */
  autonomyDays: number;
}

/** Lama irrigua (mm) da un volume in litri applicato su `areaHa` ettari. */
export function apportoIrriguoMm(litri: number, areaHa: number): number {
  if (!(areaHa > 0) || !(litri > 0)) return 0;
  return litri / (areaHa * LITRI_PER_MM_HA);
}

/** Volume d'acqua (litri) di un'irrigation: `total_quantity`, poi `water_volume_l`. */
function volumeIrriguoLitri(t: TreatmentLog): number | null {
  if (t.total_quantity != null && Number.isFinite(t.total_quantity)) {
    return t.total_quantity;
  }
  if (t.water_volume_l != null && Number.isFinite(t.water_volume_l)) {
    return t.water_volume_l;
  }
  return null;
}

/**
 * Estrae gli apporti irrigui giornalieri (mm) dai trattamenti di tipo
 * `irrigation`: il volume d'acqua registrato sull'operazione (`total_quantity`,
 * con fallback su `water_volume_l`), riportato a lama d'acqua sulla superficie
 * dell'appezzamento.
 */
export function apportiIrriguiDaTrattamenti(
  trattamenti: TreatmentLog[],
  areaHa: number,
): ApportoIrriguo[] {
  return trattamenti
    .filter((t) => t.operation_type === "irrigation")
    .map((t) => ({
      data: giornoDi(t.executed_at),
      mm: apportoIrriguoMm(volumeIrriguoLitri(t) ?? 0, areaHa),
    }))
    .filter((a) => a.mm > 0);
}

/** Parte data "YYYY-MM-DD" (UTC) di un timestamp ISO. */
function giornoDi(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

interface GiornoAgrometeo {
  data: string;
  tMin: number;
  tMax: number;
  rhMin: number;
  rhMax: number;
  windSpeed2m: number;
  radiation: number;
  rain: number;
}

/** Media degli elementi finiti, o `fallback` se l'array è vuoto. */
function media(valori: number[], fallback: number): number {
  const ok = valori.filter((v) => Number.isFinite(v));
  if (ok.length === 0) return fallback;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/**
 * Aggrega le letture (orarie) in record giornalieri per Penman-Monteith. I
 * canali assenti ricadono su default agronomici editabili (RH 50/90 %, vento
 * 2 m/s, radiation 0) così ET0 non riceve mai NaN. Ordina per data crescente.
 */
export function serieAgrometeoDaLetture(
  letture: WeatherReading[],
  altitude = 0,
): { meteo: WeatherDataDay[]; rain: number[]; date: string[] } {
  const perGiorno = new Map<
    string,
    {
      temp: number[];
      rh: number[];
      vento: number[];
      rad: number[];
      rain: number;
    }
  >();

  for (const l of letture) {
    const data = giornoDi(l.measured_at);
    let agg = perGiorno.get(data);
    if (!agg) {
      agg = { temp: [], rh: [], vento: [], rad: [], rain: 0 };
      perGiorno.set(data, agg);
    }
    if (l.air_temperature != null) agg.temp.push(l.air_temperature);
    if (l.relative_humidity != null) agg.rh.push(l.relative_humidity);
    if (l.wind_speed != null) agg.vento.push(l.wind_speed);
    if (l.solar_radiation != null) agg.rad.push(l.solar_radiation);
    if (l.rain_mm != null && Number.isFinite(l.rain_mm)) {
      agg.rain += l.rain_mm;
    }
  }

  const date = [...perGiorno.keys()].sort();
  const giorni: GiornoAgrometeo[] = date.map((data) => {
    const a = perGiorno.get(data)!;
    const temps = a.temp.filter((v) => Number.isFinite(v));
    const tMin = temps.length ? Math.min(...temps) : 0;
    const tMax = temps.length ? Math.max(...temps) : tMin;
    const rhs = a.rh.filter((v) => Number.isFinite(v));
    const rhMin = rhs.length ? Math.min(...rhs) : 50;
    const rhMax = rhs.length ? Math.max(...rhs) : 90;
    return {
      data,
      tMin: Math.min(tMin, tMax),
      tMax: Math.max(tMin, tMax),
      rhMin: Math.min(rhMin, rhMax),
      rhMax: Math.max(rhMin, rhMax),
      windSpeed2m: media(a.vento, 2),
      radiation: Math.max(0, media(a.rad, 0)),
      rain: a.rain,
    };
  });

  return {
    date,
    rain: giorni.map((g) => g.rain),
    meteo: giorni.map((g) => ({
      tMin: g.tMin,
      tMax: g.tMax,
      rhMin: g.rhMin,
      rhMax: g.rhMax,
      windSpeed2m: g.windSpeed2m,
      radiation: g.radiation,
      altitude,
    })),
  };
}

/** Proietta gli apporti irrigui sulla griglia giornaliera `date`. */
function irrigazionePerGiorno(
  date: string[],
  irrigazioni: ApportoIrriguo[],
): number[] {
  const perGiorno = new Map<string, number>();
  for (const a of irrigazioni) {
    const d = a.data.slice(0, 10);
    perGiorno.set(d, (perGiorno.get(d) ?? 0) + (a.mm ?? 0));
  }
  return date.map((d) => perGiorno.get(d) ?? 0);
}

/**
 * Calcola il bilancio idrico giornaliero componendo gli engine puri:
 * ET0 (Penman-Monteith) → ETc (ET0·Kc per phase) → depletion Dr,t (FAO-66).
 */
export function calcolaBilancioIdrico(
  params: BilancioIdricoParams,
): BilancioIdricoOutput {
  const kc = getPhaseCalibration(params.coltura, params.phase).kc;
  const { meteo, rain, date } = serieAgrometeoDaLetture(
    params.letture,
    params.altitude ?? 0,
  );

  const et0Serie = meteo.map((m) => et0PenmanMonteith(m));
  const etcSerie = et0Serie.map((et0) => cropEt(et0, kc));
  const irrSerie = irrigazionePerGiorno(date, params.irrigazioni ?? []);

  const { series, autonomyDays }: {
    series: WaterBalanceDay[];
    autonomyDays: number;
  } = waterBalanceFao66(
    params.suolo,
    etcSerie,
    rain,
    irrSerie,
    params.deplezioneIniziale ?? 0,
  );

  return {
    kc,
    autonomyDays,
    series: series.map((g, i) => ({
      data: date[i],
      et0: et0Serie[i],
      etc: g.etc,
      rain: g.rain,
      irrigation: g.irrigation,
      percolation: g.percolation,
      depletion: g.depletion,
      raw: g.raw,
      awc: g.awc,
      inStress: g.inStress,
    })),
  };
}
