import {
  type AgroDal,
  type Plot,
  centroid,
  type CompanyWeatherConfig,
  type WeatherDataSource,
  type WeatherReading,
} from "@agrogea/core";
import { v5 as uuidv5 } from "uuid";
import i18n from "../i18n";

/**
 * Namespace fisso per derivare l'id (UUIDv5) di una lettura meteo dalla sua
 * chiave naturale. La colonna `letture_meteo.id` è di tipo `uuid` (come la PK
 * remota e `outbox.riga_id`): inserirvi una chiave testuale grezza tipo
 * "open-meteo:<iso>" fa fallire l'INSERT con "invalid input syntax for type
 * uuid", lasciando la tabella vuota — ed era il motivo per cui i DSS non
 * trovavano dati pur funzionando la scheda meteo (che non passa dal DB).
 * UUIDv5 è deterministico: la stessa chiave → lo stesso id, quindi l'idempotenza
 * `on conflict (id)` resta intatta e un re-import sovrascrive senza duplicare.
 */
const NS_LETTURA_METEO = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

/** Id `uuid` deterministico di una lettura meteo dalla sua chiave naturale. */
function idLettura(chiaveNaturale: string): string {
  return uuidv5(chiaveNaturale, NS_LETTURA_METEO);
}

/**
 * Engine meteo local-first (Modulo Meteo §2).
 *
 * Unico punto del sistema che parla con l'esterno per il meteo. Tutto ciò che
 * scarica (Open-Meteo o centralina privata) finisce normalizzato nella stessa
 * tabella locale `letture_meteo` (il modello "meteo_osservazioni" della
 * specifica), da cui poi leggono i DSS. Pensato per i tier gratuiti: un solo
 * fetch copre storico + previsione e un lucchetto orario evita di consumare
 * quota a ogni apertura/cambio azienda.
 *
 * Regola architetturale: scrive SOLO via DAL, mai su PGlite direttamente.
 */

/** Riga meteo pronta per il DAL (idempotente per `id`). */
type WeatherReadingInput = Omit<
  WeatherReading,
  "tenant_id" | "created_at" | "updated_at" | "deleted_at"
>;

/**
 * Finestra del fetch previsionale (endpoint /forecast), spinta al massimo del
 * free tier Open-Meteo: 92 giorni di passato + 16 di previsione in UNA chiamata.
 * Copre i modelli giornalieri (peronospora/oidio) e gran parte dell'accumulo
 * recente; lo storico più profondo per il GDD stagionale arriva dall'Archive API.
 */
const GIORNI_STORICO_FORECAST = 92;
const GIORNI_PREVISIONE = 16;

/**
 * Finestra di rilettura locale: abbondante, così l'accumulo stagionale dispone
 * di tutta la storia presente in PGlite (forecast + backfill Archive). Lettura
 * locale, nessun costo di quota.
 */
const GIORNI_LETTURA = 430;

/** Latenza tipica dell'Archive API Open-Meteo (i dati recenti non ci sono). */
const ARCHIVIO_LATENZA_GIORNI = 5;

/** Lucchetto orario: sotto questo delta si legge dalla cache locale. */
export const LOCK_METEO_MINUTI = 60;

/** Stazione logica con cui Open-Meteo marca le sue righe in `letture_meteo`. */
export const STAZIONE_OPEN_METEO = "open-meteo";

export interface MeteoFetchOptions {
  dal: AgroDal;
  companyId: string;
  /** Plot da cui prendere le coordinate (il "principale"). */
  appezzamentoPrincipale: Plot | null;
  /** Config già caricata; se assente il servizio la legge dal DAL. */
  config?: CompanyWeatherConfig | null;
  /** Forza il fetch ignorando il lucchetto orario (pulsante "aggiorna ora"). */
  force?: boolean;
}

export interface MeteoFetchResult {
  /** true se ha colpito davvero la rete/centralina in questa chiamata. */
  fetched: boolean;
  fonte: WeatherDataSource;
  /** Serie completa (storico + previsione) letta da PGlite dopo l'eventuale pull. */
  letture: WeatherReading[];
  /** Righe nuove scritte in `letture_meteo` (0 se servita dalla cache). */
  inserite: number;
  /** Perché non ha fetchato, quando `fetched` è false (es. lucchetto orario). */
  motivo?: string;
}

// ---------------------------------------------------------------------------
// Previsione "da cruscotto" (scheda meteo dell'header): oggi + N giorni.
// ---------------------------------------------------------------------------

/** Condizioni correnti per la riga principale della scheda meteo. */
export interface MeteoCorrente {
  /** ISO dell'osservazione corrente restituita da Open-Meteo. */
  ora: string;
  temperatura: number | null;
  umidita: number | null;
  vento: number | null;
  pioggia: number | null;
  /** Codice meteo WMO (0..99) per la scelta dell'icona. */
  weatherCode: number | null;
}

/** Sintesi di un giorno di previsione (icona + min/max + pioggia). */
export interface GiornoPrevisione {
  /** Data "YYYY-MM-DD" (timezone locale dell'azienda). */
  data: string;
  tMin: number | null;
  tMax: number | null;
  pioggiaMm: number | null;
  ventoMax: number | null;
  weatherCode: number | null;
}

export interface PrevisioneDashboard {
  corrente: MeteoCorrente;
  /** Oggi in testa, poi i giorni successivi. */
  giorni: GiornoPrevisione[];
  /** ISO del momento in cui è stata recuperata (per il "aggiornato alle…"). */
  recuperatoIl: string;
}

interface OpenMeteoForecastResp {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
  };
}

/** Giorni di previsione mostrati nella scheda: oggi + 4. */
const GIORNI_PREVISIONE_DASHBOARD = 5;

/**
 * Cache in-memory (per azienda) della previsione da cruscotto. È volutamente
 * separata dal lucchetto `last_weather_pull_at` dei DSS: quella scheda NON
 * scrive `letture_meteo`, quindi non deve marcare il pull autorevole (altrimenti
 * i DSS crederebbero i dati freschi senza averli). All'avvio dell'app la cache è
 * vuota → primo fetch; entro l'ora si serve dalla cache (stesso lucchetto orario).
 */
const cachePrevisione = new Map<
  string,
  { at: number; data: PrevisioneDashboard }
>();

function buildForecastDashboardUrl(lon: number, lat: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
    forecast_days: String(GIORNI_PREVISIONE_DASHBOARD),
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/** Minuti trascorsi dall'ISO passato a ora; +∞ se nullo/non valido. */
function minutiDa(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60_000;
}

// ---------------------------------------------------------------------------
// Open-Meteo (provider pubblico di default, gratuito)
// ---------------------------------------------------------------------------

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  precipitation: number[];
  shortwave_radiation: number[];
  wind_speed_10m: number[];
}

/**
 * Bagnatura fogliare STIMATA (Open-Meteo non la misura): la fogliazione è
 * considerata bagnata nell'ora se l'umidità relativa è ≥90% o c'è pioggia
 * apprezzabile. Valore 0..1 = frazione dell'ora con foglia bagnata, coerente
 * con la colonna `bagnatura_fogliare` usata dai DSS fungini.
 */
function stimaBagnatura(rh: number, pioggiaMm: number): number {
  if (pioggiaMm >= 0.2) return 1;
  if (rh >= 90) return 1;
  if (rh >= 85) return 0.5;
  return 0;
}

function buildOpenMeteoUrl(lon: number, lat: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation,shortwave_radiation,wind_speed_10m",
    past_days: String(GIORNI_STORICO_FORECAST),
    forecast_days: String(GIORNI_PREVISIONE),
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function fetchOpenMeteo(
  companyId: string,
  lon: number,
  lat: number,
): Promise<WeatherReadingInput[]> {
  const resp = await fetch(buildOpenMeteoUrl(lon, lat));
  if (!resp.ok) {
    throw new Error(i18n.t("weatherSyncService.openMeteoHttpError", { status: resp.status }));
  }
  const data = (await resp.json()) as { hourly?: OpenMeteoHourly };
  const h = data.hourly;
  if (!h?.time?.length) {
    throw new Error(i18n.t("weatherSyncService.openMeteoNoHourlyData"));
  }
  return h.time.map((iso, i) => {
    const rilevatoIl = new Date(iso).toISOString();
    const rh = h.relative_humidity_2m[i] ?? null;
    const pioggia = h.precipitation[i] ?? null;
    return {
      // id idempotente (UUIDv5 dalla chiave naturale): un re-import sovrascrive.
      id: idLettura(`${STAZIONE_OPEN_METEO}:${rilevatoIl}`),
      company_id: companyId,
      station_id: STAZIONE_OPEN_METEO,
      measured_at: rilevatoIl,
      air_temperature: h.temperature_2m[i] ?? null,
      relative_humidity: rh,
      rain_mm: pioggia,
      leaf_wetness:
        rh != null && pioggia != null ? stimaBagnatura(rh, pioggia) : null,
      solar_radiation: h.shortwave_radiation[i] ?? null,
      wind_speed: h.wind_speed_10m[i] ?? null,
      wind_direction: null,
      metadata: {
        provider: "open-meteo",
        previsione: i >= GIORNI_STORICO_FORECAST * 24,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Open-Meteo Archive API (storico profondo, gratuito) — backfill GDD stagionale
// ---------------------------------------------------------------------------

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}

/** "YYYY-MM-DD" in UTC da un timestamp. */
function isoGiorno(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Storico GIORNALIERO dall'Archive API per il backfill dell'accumulo stagionale.
 * Per minimizzare le righe (e quindi il peso locale) ogni giorno è normalizzato
 * in DUE letture sintetiche — minima al mattino, massima al pomeriggio — così
 * l'aggregazione giornaliera dei DSS ricava tMin/tMax corretti senza dati orari.
 */
async function fetchArchivioGdd(
  companyId: string,
  lon: number,
  lat: number,
  daISO: string,
  aISO: string,
): Promise<WeatherReadingInput[]> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: daISO,
    end_date: aISO,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
  });
  const resp = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`,
  );
  if (!resp.ok) throw new Error(i18n.t("weatherSyncService.openMeteoArchiveHttpError", { status: resp.status }));
  const data = (await resp.json()) as { daily?: OpenMeteoDaily };
  const d = data.daily;
  if (!d?.time?.length) return [];

  const righe: WeatherReadingInput[] = [];
  d.time.forEach((giorno, i) => {
    const tMin = d.temperature_2m_min[i];
    const tMax = d.temperature_2m_max[i];
    const pioggia = d.precipitation_sum[i] ?? null;
    if (tMin == null && tMax == null) return; // giorno senza dato → saltato
    // Riga "minima" (mattino).
    righe.push({
      id: idLettura(`${STAZIONE_OPEN_METEO}:arch:${giorno}:min`),
      company_id: companyId,
      station_id: STAZIONE_OPEN_METEO,
      measured_at: `${giorno}T06:00:00.000Z`,
      air_temperature: tMin ?? tMax ?? null,
      relative_humidity: null,
      rain_mm: null,
      leaf_wetness: null,
      solar_radiation: null,
      wind_speed: null,
      wind_direction: null,
      metadata: { provider: "open-meteo-archive", archivio: true },
    });
    // Riga "massima" (pomeriggio), porta anche la pioggia del giorno.
    righe.push({
      id: idLettura(`${STAZIONE_OPEN_METEO}:arch:${giorno}:max`),
      company_id: companyId,
      station_id: STAZIONE_OPEN_METEO,
      measured_at: `${giorno}T14:00:00.000Z`,
      air_temperature: tMax ?? tMin ?? null,
      relative_humidity: null,
      rain_mm: pioggia,
      leaf_wetness: null,
      solar_radiation: null,
      wind_speed: null,
      wind_direction: null,
      metadata: { provider: "open-meteo-archive", archivio: true },
    });
  });
  return righe;
}

// ---------------------------------------------------------------------------
// Centraline private (Davis, Pessl, …) — predisposizione adapter
// ---------------------------------------------------------------------------

/**
 * Adapter di centralina: scarica dal cloud del costruttore con le credenziali
 * configurate e normalizza nelle stesse righe `letture_meteo`. Gli endpoint
 * reali richiedono account/contratto, quindi qui c'è lo scaffolding tipizzato:
 * registrare un adapter = aggiungere una entry in `ADAPTER_CENTRALINE`.
 */
type AdapterCentralina = (
  companyId: string,
  config: CompanyWeatherConfig,
) => Promise<WeatherReadingInput[]>;

const ADAPTER_CENTRALINE: Record<string, AdapterCentralina> = {
  // Davis WeatherLink v2: GET /v2/historic/{station-id} con API key/secret.
  davis: async () => {
    throw new Error(i18n.t("weatherSyncService.davisAdapterNotIntegrated"));
  },
  // Pessl FieldClimate: GET /data/{device-id} firmato HMAC con public/private key.
  pessl: async () => {
    throw new Error(i18n.t("weatherSyncService.pesslAdapterNotIntegrated"));
  },
};

async function fetchStazionePrivata(
  companyId: string,
  config: CompanyWeatherConfig,
): Promise<WeatherReadingInput[]> {
  const modello = (config.station_model ?? "").trim().toLowerCase();
  const adapter = ADAPTER_CENTRALINE[modello];
  if (!adapter) {
    throw new Error(
      i18n.t("weatherSyncService.unknownStationModel", {
        model: config.station_model ?? "—",
        supported: Object.keys(ADAPTER_CENTRALINE).join(", "),
      }),
    );
  }
  if (!config.station_api_key || !config.station_device_id) {
    throw new Error(i18n.t("weatherSyncService.privateStationCredentialsRequired"));
  }
  return adapter(companyId, config);
}

// ---------------------------------------------------------------------------
// Orchestrazione: lucchetto orario → fetch → scrittura → rilettura
// ---------------------------------------------------------------------------

export const WeatherSyncService = {
  /**
   * Garantisce una serie meteo fresca per l'azienda, rispettando il lucchetto
   * orario. Ritorna sempre le letture lette da PGlite (anche servendo dalla
   * cache), così il chiamante ha la serie pronta per i DSS senza un secondo giro.
   */
  async assicuraDatiMeteo(
    opzioni: MeteoFetchOptions,
  ): Promise<MeteoFetchResult> {
    const { dal, companyId, appezzamentoPrincipale, force } = opzioni;
    const config =
      opzioni.config ?? (await dal.getConfigMeteo(companyId)) ?? null;
    const fonte: WeatherDataSource = config?.data_source ?? "public_api";

    const eta = minutiDa(config?.last_weather_pull_at ?? null);
    const dentroLock = eta < LOCK_METEO_MINUTI;

    // Lucchetto orario: dati ancora freschi → si legge dalla cache locale.
    if (dentroLock && !force) {
      const letture = await readSeries(dal, companyId);
      return {
        fetched: false,
        fonte,
        letture,
        inserite: 0,
        motivo: i18n.t("weatherSyncService.dataUpdatedMinutesAgo", {
          minutes: Math.round(eta),
          lockMinutes: LOCK_METEO_MINUTI,
        }),
      };
    }

    // Oltre il lucchetto (o forzato): si scarica e si scrive.
    let nuove: WeatherReadingInput[];
    if (fonte === "private_station") {
      if (!config) throw new Error(i18n.t("weatherSyncService.missingStationConfig"));
      nuove = await fetchStazionePrivata(companyId, config);
    } else {
      if (!appezzamentoPrincipale?.geometry) {
        throw new Error(i18n.t("weatherSyncService.noPlotGeometryForStation"));
      }
      const [lon, lat] = centroid(appezzamentoPrincipale.geometry);
      nuove = await fetchOpenMeteo(companyId, lon, lat);
    }

    // Dati API ricomputabili → scrittura locale bulk (no outbox), veloce.
    const inserite =
      fonte === "private_station"
        ? await dal.insertLettureMeteo(nuove) // stazione autorevole → sync
        : await dal.insertLettureMeteoLocali(nuove);
    await dal.touchWeatherPull(companyId, new Date().toISOString());

    const letture = await readSeries(dal, companyId);
    return { fetched: true, fonte, letture, inserite };
  },

  /**
   * Backfill dello storico stagionale per i modelli ad accumulo termico
   * (gradi-giorno): scarica dall'Archive API i giorni precedenti alla finestra
   * previsionale, così l'accumulo può partire dal biofix. È GATED — non
   * richiama l'API se in PGlite c'è già storico che copre il biofix — e
   * silenzioso in offline (ritorna 0). Sfrutta il free tier senza sprechi: una
   * sola chiamata copre l'intero buco, poi il lucchetto/min lo evitano.
   */
  async assicuraStoricoGdd(opzioni: {
    dal: AgroDal;
    companyId: string;
    appezzamentoPrincipale: Plot | null;
    /** Biofix dell'accumulo (ISO date): si scarica fin qui all'indietro. */
    dataInizio: string;
  }): Promise<{ backfilled: number }> {
    const { dal, companyId, appezzamentoPrincipale, dataInizio } = opzioni;
    if (!appezzamentoPrincipale?.geometry) return { backfilled: 0 };

    const inizio = dataInizio.slice(0, 10);
    const min = await dal.minRilevatoMeteo(companyId);
    // Storico già abbastanza profondo da coprire il biofix → niente da fare.
    if (min && min.slice(0, 10) <= inizio) return { backfilled: 0 };

    const oggi = Date.now();
    // Fine del backfill: dove NON arriva la previsione (92 gg fa), rispettando
    // la latenza dell'archivio e fermandosi appena prima dello storico esistente.
    let fineMs = oggi - GIORNI_STORICO_FORECAST * 24 * 3600 * 1000;
    const latenzaMs = oggi - ARCHIVIO_LATENZA_GIORNI * 24 * 3600 * 1000;
    if (fineMs > latenzaMs) fineMs = latenzaMs;
    if (min) {
      const minMs = new Date(min).getTime() - 24 * 3600 * 1000;
      if (minMs < fineMs) fineMs = minMs;
    }

    const aISO = isoGiorno(fineMs);
    if (inizio > aISO) return { backfilled: 0 }; // nessun buco da colmare

    const [lon, lat] = centroid(appezzamentoPrincipale.geometry);
    const righe = await fetchArchivioGdd(companyId, lon, lat, inizio, aISO);
    const backfilled = await dal.insertLettureMeteoLocali(righe);
    return { backfilled };
  },

  /**
   * Previsione sintetica per la scheda meteo dell'header (condizioni correnti +
   * oggi e i giorni seguenti, con codice WMO per le icone). Chiamata leggera e
   * separata dalla pipeline DSS: usa l'endpoint `daily`/`current` di Open-Meteo
   * (payload minimo) e una cache in-memory con lo stesso lucchetto orario, così
   * apertura e cambi azienda non consumano quota oltre una volta l'ora.
   */
  async previsioneDashboard(opzioni: {
    companyId: string;
    lon: number;
    lat: number;
    /** Ignora il lucchetto orario (pulsante "aggiorna"). */
    force?: boolean;
  }): Promise<PrevisioneDashboard> {
    const { companyId, lon, lat, force } = opzioni;
    const cached = cachePrevisione.get(companyId);
    if (
      cached &&
      !force &&
      (Date.now() - cached.at) / 60_000 < LOCK_METEO_MINUTI
    ) {
      return cached.data;
    }

    const resp = await fetch(buildForecastDashboardUrl(lon, lat));
    if (!resp.ok) throw new Error(i18n.t("weatherSyncService.openMeteoHttpError", { status: resp.status }));
    const json = (await resp.json()) as OpenMeteoForecastResp;
    const c = json.current ?? {};
    const d = json.daily ?? {};
    const time = d.time ?? [];

    const data: PrevisioneDashboard = {
      corrente: {
        ora: c.time ?? new Date().toISOString(),
        temperatura: c.temperature_2m ?? null,
        umidita: c.relative_humidity_2m ?? null,
        vento: c.wind_speed_10m ?? null,
        pioggia: c.precipitation ?? null,
        weatherCode: c.weather_code ?? null,
      },
      giorni: time.map((giorno, i) => ({
        data: giorno,
        tMin: d.temperature_2m_min?.[i] ?? null,
        tMax: d.temperature_2m_max?.[i] ?? null,
        pioggiaMm: d.precipitation_sum?.[i] ?? null,
        ventoMax: d.wind_speed_10m_max?.[i] ?? null,
        weatherCode: d.weather_code?.[i] ?? null,
      })),
      recuperatoIl: new Date().toISOString(),
    };

    cachePrevisione.set(companyId, { at: Date.now(), data });
    return data;
  },
};

/**
 * Legge la finestra meteo rilevante (storico recente + previsione) da PGlite.
 *
 * Volutamente AGNOSTICA rispetto alla stazione: i DSS devono usare "l'ultimo
 * set di dati meteorologici presenti in PGlite" (spec §4), qualunque sia la
 * fonte che li ha scritti (Open-Meteo, centralina, import). Filtrare per
 * `stazione_id` farebbe sparire i dati appena la fonte cambia o entro il
 * lucchetto orario — il bug per cui i DSS "cercavano i dati nel posto sbagliato".
 */
async function readSeries(
  dal: AgroDal,
  companyId: string,
): Promise<WeatherReading[]> {
  const dopo = new Date(
    Date.now() - GIORNI_LETTURA * 24 * 3600 * 1000,
  ).toISOString();
  return dal.listLettureMeteo(companyId, { dopo, limit: 30_000 });
}
