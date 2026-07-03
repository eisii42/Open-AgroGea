import type {
  Appezzamento,
  CampoCampagna,
  Crop,
  DssRisultato,
  LetturaMeteo,
  Raccolta,
  RegistroTrattamento,
  SoilWaterIndex,
} from "@agrogea/core";

/**
 * Tipi condivisi della dashboard aziendale + PRESET multi-serie "pronti" (es. il
 * bilancio idrico). L'analisi LIBERA (entità → dimensione → funzione(misura) →
 * tipo grafico) vive in {@link ./dashboard-analytics}; entrambi producono
 * {@link ChartData}, consumato dallo stesso renderer.
 */

export type ChartType = "line" | "area" | "bar" | "pie";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartData {
  rows: Record<string, string | number>[];
  /** Chiave dell'asse X / categoria. */
  categoryKey: string;
  series: ChartSeries[];
  empty: boolean;
}

/** Bundle di dominio (già nello scope dei filtri) passato ai builder. */
export interface DashboardData {
  appezzamenti: Appezzamento[];
  crops: Crop[];
  campaigns: CampoCampagna[];
  trattamenti: RegistroTrattamento[];
  raccolte: Raccolta[];
  soilIndices: SoilWaterIndex[];
  weather: LetturaMeteo[];
  dssRisultati: DssRisultato[];
}

export interface PresetDef {
  id: string;
  label: string;
  types: ChartType[];
  build: (data: DashboardData) => ChartData;
}

// ---------------------------------------------------------------------------
// Helper condivisi
// ---------------------------------------------------------------------------

export const PALETTE = [
  "#1f8a5b",
  "#1f6feb",
  "#e8833a",
  "#9b5de5",
  "#d23b2e",
  "#0aa3a3",
  "#0ea5e9",
  "#d97706",
];

/** "YYYY-MM-DD" robusto (PGlite ritorna Date a runtime anche se i tipi dicono string). */
export function dayKey(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function shortDate(key: string): string {
  return new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Preset multi-serie
// ---------------------------------------------------------------------------

/** Bilancio idrico giornaliero (media sugli appezzamenti nello scope, ultimi ~75gg). */
function buildWaterBalance(d: DashboardData): ChartData {
  const byDay = new Map<
    string,
    { dr: number; raw: number; etc: number; irr: number; rain: number; n: number }
  >();
  for (const s of d.soilIndices) {
    const k = dayKey(s.date);
    if (!k) continue;
    const c = byDay.get(k) ?? { dr: 0, raw: 0, etc: 0, irr: 0, rain: 0, n: 0 };
    c.dr += s.depletion_mm;
    c.raw += s.raw_mm;
    c.etc += s.etc;
    c.irr += s.irrigation_mm;
    c.rain += s.rain_mm;
    c.n += 1;
    byDay.set(k, c);
  }
  const rows = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-75)
    .map(([k, c]) => ({
      x: shortDate(k),
      Dr: r1(c.dr / c.n),
      RAW: r1(c.raw / c.n),
      ETc: r1(c.etc / c.n),
      Irrigazione: r1(c.irr / c.n),
      Pioggia: r1(c.rain / c.n),
    }));
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "Dr", label: "Deplezione Dr", color: PALETTE[1] },
      { key: "RAW", label: "Soglia RAW", color: PALETTE[4] },
      { key: "ETc", label: "ETc", color: PALETTE[2] },
      { key: "Irrigazione", label: "Irrigazione", color: PALETTE[6] },
      { key: "Pioggia", label: "Pioggia", color: PALETTE[5] },
    ],
    empty: rows.length === 0,
  };
}

/** Meteo giornaliero: T min/max e pioggia (ultimi ~60gg). */
function buildWeatherDaily(d: DashboardData): ChartData {
  const byDay = new Map<string, { temps: number[]; rain: number }>();
  for (const r of d.weather) {
    const k = dayKey(r.measured_at);
    if (!k) continue;
    const c = byDay.get(k) ?? { temps: [], rain: 0 };
    if (r.air_temperature != null) c.temps.push(r.air_temperature);
    if (r.rain_mm != null) c.rain += r.rain_mm;
    byDay.set(k, c);
  }
  const rows = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-60)
    .map(([k, c]) => ({
      x: shortDate(k),
      "T min": c.temps.length ? r1(Math.min(...c.temps)) : 0,
      "T max": c.temps.length ? r1(Math.max(...c.temps)) : 0,
      Pioggia: r1(c.rain),
    }));
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "T min", label: "T min (°C)", color: PALETTE[1] },
      { key: "T max", label: "T max (°C)", color: PALETTE[2] },
      { key: "Pioggia", label: "Pioggia (mm)", color: PALETTE[5] },
    ],
    empty: rows.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Aggregatori giornalieri condivisi dai preset agronomici
// ---------------------------------------------------------------------------

interface SoilDay {
  rain: number;
  irr: number;
  etc: number;
  et0: number;
  perc: number;
  dr: number;
  raw: number;
  awc: number;
  n: number;
}

/** Media giornaliera (tra appezzamenti) degli indici idrici, ordinata per data. */
function soilDaily(d: DashboardData): [string, SoilDay][] {
  const m = new Map<string, SoilDay>();
  for (const s of d.soilIndices) {
    const k = dayKey(s.date);
    if (!k) continue;
    const c =
      m.get(k) ??
      { rain: 0, irr: 0, etc: 0, et0: 0, perc: 0, dr: 0, raw: 0, awc: 0, n: 0 };
    c.rain += s.rain_mm;
    c.irr += s.irrigation_mm;
    c.etc += s.etc;
    c.et0 += s.et0;
    c.perc += s.deep_percolation_mm;
    c.dr += s.depletion_mm;
    c.raw += s.raw_mm;
    c.awc += s.awc_mm;
    c.n += 1;
    m.set(k, c);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

interface WeatherDay {
  temps: number[];
  rh: number[];
  wet: number;
  rain: number;
}

/** Aggregazione giornaliera delle letture meteo (orarie → giorno), ordinata. */
function weatherDaily(d: DashboardData): [string, WeatherDay][] {
  const m = new Map<string, WeatherDay>();
  for (const w of d.weather) {
    const k = dayKey(w.measured_at);
    if (!k) continue;
    const c = m.get(k) ?? { temps: [], rh: [], wet: 0, rain: 0 };
    if (w.air_temperature != null) c.temps.push(w.air_temperature);
    if (w.relative_humidity != null) c.rh.push(w.relative_humidity);
    if (w.leaf_wetness != null) c.wet += w.leaf_wetness; // frazione/ora → ore/giorno
    if (w.rain_mm != null) c.rain += w.rain_mm;
    m.set(k, c);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

/** N% dal titolo NPK ("15-15-15" → 15). null se non interpretabile. */
function nitrogenPct(npk: string | null): number | null {
  if (!npk) return null;
  const first = npk.split(/[-/\s]+/)[0]?.replace(",", ".");
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Preset agronomici "da analista"
// ---------------------------------------------------------------------------

/** Apporti (pioggia+irrigazione) vs consumi (ETc+percolazione) idrici, ultimi ~75gg. */
function buildWaterInOut(d: DashboardData): ChartData {
  const rows = soilDaily(d)
    .slice(-75)
    .map(([k, c]) => ({
      x: shortDate(k),
      Pioggia: r1(c.rain / c.n),
      Irrigazione: r1(c.irr / c.n),
      ETc: r1(c.etc / c.n),
      Percolazione: r1(c.perc / c.n),
    }));
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "Pioggia", label: "Pioggia (in)", color: PALETTE[5] },
      { key: "Irrigazione", label: "Irrigazione (in)", color: PALETTE[6] },
      { key: "ETc", label: "ETc (out)", color: PALETTE[2] },
      { key: "Percolazione", label: "Percolazione (out)", color: PALETTE[3] },
    ],
    empty: rows.length === 0,
  };
}

/** Bilancio idrico CUMULATO stagionale: pioggia, irrigazione ed ETc cumulate. */
function buildWaterCumulative(d: DashboardData): ChartData {
  let cr = 0;
  let ci = 0;
  let ce = 0;
  const rows = soilDaily(d).map(([k, c]) => {
    cr += c.rain / c.n;
    ci += c.irr / c.n;
    ce += c.etc / c.n;
    return {
      x: shortDate(k),
      "Pioggia cum.": r1(cr),
      "Irrigazione cum.": r1(ci),
      "ETc cum.": r1(ce),
    };
  });
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "Pioggia cum.", label: "Pioggia cumulata (mm)", color: PALETTE[5] },
      { key: "Irrigazione cum.", label: "Irrigazione cumulata (mm)", color: PALETTE[6] },
      { key: "ETc cum.", label: "ETc cumulata (mm)", color: PALETTE[2] },
    ],
    empty: rows.length === 0,
  };
}

/** Stress idrico nel tempo: deplezione e soglia RAW in % dell'AWC, ultimi ~75gg. */
function buildWaterStress(d: DashboardData): ChartData {
  const rows = soilDaily(d)
    .slice(-75)
    .map(([k, c]) => {
      const awc = c.awc / c.n;
      return {
        x: shortDate(k),
        "Deplezione %AWC": awc > 0 ? r1((c.dr / c.n / awc) * 100) : 0,
        "Soglia RAW %AWC": awc > 0 ? r1((c.raw / c.n / awc) * 100) : 0,
      };
    });
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "Deplezione %AWC", label: "Deplezione (% AWC)", color: PALETTE[1] },
      { key: "Soglia RAW %AWC", label: "Soglia RAW (% AWC)", color: PALETTE[4] },
    ],
    empty: rows.length === 0,
  };
}

/** Accumulo termico (GDD base 10 °C) CUMULATO dalla serie meteo. */
function buildGddCumulative(d: DashboardData): ChartData {
  let cum = 0;
  const rows = weatherDaily(d)
    .filter(([, c]) => c.temps.length > 0)
    .map(([k, c]) => {
      const tMin = Math.min(...c.temps);
      const tMax = Math.max(...c.temps);
      cum += Math.max(0, (tMin + tMax) / 2 - 10);
      return { x: shortDate(k), "GDD cum.": Math.round(cum) };
    });
  return {
    rows,
    categoryKey: "x",
    series: [{ key: "GDD cum.", label: "GDD cumulati (base 10 °C)", color: PALETTE[2] }],
    empty: rows.length === 0,
  };
}

/** Condizioni favorevoli alle infezioni fungine: bagnatura, RH media e pioggia, ~60gg. */
function buildInfectionMeteo(d: DashboardData): ChartData {
  const rows = weatherDaily(d)
    .slice(-60)
    .map(([k, c]) => ({
      x: shortDate(k),
      "Bagnatura (h)": r1(c.wet),
      "RH media (%)": r1(mean(c.rh)),
      "Pioggia (mm)": r1(c.rain),
    }));
  return {
    rows,
    categoryKey: "x",
    series: [
      { key: "Bagnatura (h)", label: "Bagnatura fogliare (h)", color: PALETTE[0] },
      { key: "RH media (%)", label: "Umidità relativa media (%)", color: PALETTE[1] },
      { key: "Pioggia (mm)", label: "Pioggia (mm)", color: PALETTE[5] },
    ],
    empty: rows.length === 0,
  };
}

/** Azoto distribuito CUMULATO (kg) dalle fertilizzazioni (titolo NPK × quantità). */
function buildNitrogenCumulative(d: DashboardData): ChartData {
  const byDay = new Map<string, number>();
  for (const t of d.trattamenti) {
    if (t.deleted_at != null || t.operation_type !== "fertilization") continue;
    const npct = nitrogenPct(t.npk_ratio);
    const qty = t.total_quantity;
    if (npct == null || qty == null || !Number.isFinite(qty)) continue;
    const k = dayKey(t.executed_at);
    if (!k) continue;
    byDay.set(k, (byDay.get(k) ?? 0) + (qty * npct) / 100);
  }
  let cum = 0;
  const rows = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => {
      cum += n;
      return { x: shortDate(k), "N cum. (kg)": r1(cum) };
    });
  return {
    rows,
    categoryKey: "x",
    series: [{ key: "N cum. (kg)", label: "Azoto distribuito cumulato (kg)", color: PALETTE[0] }],
    empty: rows.length === 0,
  };
}

export const PRESETS: PresetDef[] = [
  {
    id: "water_balance",
    label: "Bilancio idrico (Dr/RAW/ETc/irrigazione)",
    types: ["area", "line", "bar"],
    build: buildWaterBalance,
  },
  {
    id: "water_in_out",
    label: "Apporti vs consumi idrici (pioggia+irrig. / ETc+perc.)",
    types: ["bar", "area", "line"],
    build: buildWaterInOut,
  },
  {
    id: "water_cumulative",
    label: "Bilancio idrico cumulato (pioggia/irrig./ETc)",
    types: ["line", "area"],
    build: buildWaterCumulative,
  },
  {
    id: "water_stress",
    label: "Stress idrico nel tempo (deplezione vs RAW, % AWC)",
    types: ["area", "line"],
    build: buildWaterStress,
  },
  {
    id: "gdd_cumulative",
    label: "Accumulo termico GDD cumulato (base 10 °C)",
    types: ["line", "area"],
    build: buildGddCumulative,
  },
  {
    id: "infection_meteo",
    label: "Condizioni infettive (bagnatura/RH/pioggia)",
    types: ["line", "area", "bar"],
    build: buildInfectionMeteo,
  },
  {
    id: "nitrogen_cumulative",
    label: "Azoto distribuito cumulato (kg, da NPK)",
    types: ["line", "bar"],
    build: buildNitrogenCumulative,
  },
  {
    id: "weather_daily",
    label: "Meteo giornaliero (T/pioggia)",
    types: ["line", "area", "bar"],
    build: buildWeatherDaily,
  },
];

export function presetById(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Filtro temporale
// ---------------------------------------------------------------------------

/** Intervallo temporale inclusivo (ISO "YYYY-MM-DD"); `null` = estremo aperto. */
export interface TemporalRange {
  from: string | null;
  to: string | null;
}

/** Range che copre un'intera annata di campagna (anno solare). */
export function campaignYearRange(year: number): TemporalRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function inRange(v: string | Date, range: TemporalRange): boolean {
  const k = dayKey(v);
  if (!k) return false;
  if (range.from && k < range.from) return false;
  if (range.to && k > range.to) return false;
  return true;
}

/**
 * Restringe il bundle al periodo dato per CAMPO DATA di ogni entità (operazioni,
 * raccolte, indici idrici, meteo, DSS). Anagrafiche/colture/campagne restano (sono
 * metadati, non eventi datati). `from`/`to` entrambi null = nessun filtro.
 */
export function filterByRange(
  data: DashboardData,
  range: TemporalRange,
): DashboardData {
  if (!range.from && !range.to) return data;
  return {
    ...data,
    trattamenti: data.trattamenti.filter((t) => inRange(t.executed_at, range)),
    raccolte: data.raccolte.filter((r) => inRange(r.harvested_at, range)),
    soilIndices: data.soilIndices.filter((s) => inRange(s.date, range)),
    weather: data.weather.filter((w) => inRange(w.measured_at, range)),
    dssRisultati: data.dssRisultati.filter((d) => inRange(d.calculated_at, range)),
  };
}
