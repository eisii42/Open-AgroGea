/**
 * Pipeline NDVI on-demand via STAC (Modulo 1, refactor).
 *
 * Sostituisce il time-slider: invece di sfogliare una timeline, il calcolo è
 * innescato dal perimetro dell'appezzamento. Flusso:
 *   1. bbox del poligono → STAC search (ultimo Sentinel-2 L2A, cloud cover bassa);
 *   2. download SOLO delle bande B04 (Red) e B08 (NIR), ritagliate sul bbox
 *      (parametri di window passati al lettore COG nel chiamante);
 *   3. NDVI = (NIR − Red)/(NIR + Red) pixel per pixel, mascherato sul poligono;
 *   4. media sui pixel validi → scheda appezzamento + cache `ultimo_ndvi_medio`.
 *
 * Qui vivono le sole parti pure e testabili: costruzione della query STAC e
 * selezione dell'item migliore. Il fetch dei COG (geotiff.js HTTP-Range) e il
 * clip sul poligono restano nel chiamante (Web Worker dell'app), che usa
 * `calcolaIndice("ndvi", …)` di `indici.ts` per la matematica.
 */

import {
  BANDE_RICHIESTE,
  BANDE_SUOLO,
  isIndiceSuolo,
  type IndiceVegetazionale,
} from "./indici";

/** Endpoint STAC di GeoLibre: Microsoft Planetary Computer. */
export const STAC_API_URL = "https://planetarycomputer.microsoft.com/api/stac/v1";
export const SENTINEL2_COLLECTION = "sentinel-2-l2a";

/**
 * Endpoint di firma del Planetary Computer. Gli asset COG risiedono in container
 * Azure Blob non pubblici: una richiesta non firmata torna `409
 * PublicAccessNotPermitted`. Firmando l'href si ottiene un URL con SAS token a
 * scadenza, leggibile con richieste Range da geotiff.
 */
export const STAC_SIGN_URL =
  "https://planetarycomputer.microsoft.com/api/sas/v1/sign";
/**
 * Endpoint del token SAS per intera collezione. Un solo token (valido ~1 ora)
 * firma TUTTI gli asset della collezione: si appende come query agli href,
 * evitando una richiesta di firma per ogni banda di ogni scena — la causa dei
 * 429 (rate limit) quando si elaborano molte scene/indici.
 */
export const STAC_TOKEN_URL =
  "https://planetarycomputer.microsoft.com/api/sas/v1/token";

const pausa = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch con retry a backoff esponenziale sui 429 (rate limit) e 5xx. Onora
 * `Retry-After` se presente. Ritorna l'ultima risposta dopo i tentativi.
 * `init` è inoltrato invariato a ogni tentativo (method/headers/body).
 */
async function fetchConBackoff(
  fetchImpl: typeof fetch,
  url: string,
  options: { tentativi?: number; attesaBaseMs?: number } = {},
  init?: RequestInit,
): Promise<Response> {
  const tentativi = options.tentativi ?? 4;
  let attesa = options.attesaBaseMs ?? 600;
  for (let i = 0; ; i++) {
    const res = await fetchImpl(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (i >= tentativi) return res;
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    await pausa(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attesa,
    );
    attesa = Math.min(attesa * 2, 8000);
  }
}

/**
 * Firma un href di asset del Planetary Computer (aggiunge il SAS token). Se la
 * firma fallisce propaga l'errore: senza firma il COG non è leggibile. Il
 * `fetchImpl` è iniettabile per i test. Per molte firme preferire
 * {@link tokenPlanetaryComputer} (una richiesta sola, evita i 429).
 */
export async function firmaHrefPlanetaryComputer(
  href: string,
  options: {
    fetchImpl?: typeof fetch;
    signUrl?: string;
    attesaBaseMs?: number;
  } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signUrl = options.signUrl ?? STAC_SIGN_URL;
  const res = await fetchConBackoff(
    fetchImpl,
    `${signUrl}?href=${encodeURIComponent(href)}`,
    { attesaBaseMs: options.attesaBaseMs },
  );
  if (!res.ok) {
    throw new Error(`Firma asset STAC fallita: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { href?: string };
  return data.href ?? href;
}

export interface TokenSas {
  /** Query string del SAS (es. "st=…&se=…&sig=…"), da appendere agli href. */
  token: string;
  /** Scadenza del token in ms epoch. */
  scadenzaMs: number;
}

/**
 * Richiede il token SAS per un'intera collezione del Planetary Computer. Una
 * sola chiamata copre tutti gli asset della collezione → niente burst di firme
 * (e niente 429). Con retry/backoff sui 429. `fetchImpl` iniettabile per i test.
 */
export async function tokenPlanetaryComputer(
  collection: string,
  options: {
    fetchImpl?: typeof fetch;
    tokenUrl?: string;
    attesaBaseMs?: number;
  } = {},
): Promise<TokenSas> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenUrl = options.tokenUrl ?? STAC_TOKEN_URL;
  const res = await fetchConBackoff(fetchImpl, `${tokenUrl}/${collection}`, {
    attesaBaseMs: options.attesaBaseMs,
  });
  if (!res.ok) {
    throw new Error(`Token SAS STAC fallito: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    token?: string;
    "msft:expiry"?: string;
  };
  if (!data.token) {
    throw new Error("Token SAS STAC assente nella risposta.");
  }
  const expiry = data["msft:expiry"] ? Date.parse(data["msft:expiry"]) : Number.NaN;
  return {
    token: data.token,
    scadenzaMs: Number.isFinite(expiry) ? expiry : Date.now() + 50 * 60 * 1000,
  };
}

/** Appende un token SAS a un href di asset (gestendo query già presenti). */
export function applicaTokenSas(href: string, token: string): string {
  const separatore = href.includes("?") ? "&" : "?";
  return `${href}${separatore}${token}`;
}

export interface StacSearchParams {
  bbox: [number, number, number, number];
  collection: string;
  /** ISO datetime range "start/end" o singolo istante; default ultimi 60 giorni. */
  datetime: string;
  /** Filtro massimo di copertura nuvolosa (%). */
  cloudCoverMax: number;
  limit: number;
}

/**
 * Parametri della POST /search per l'ultimo Sentinel-2 sul bbox. Ordina per
 * data decrescente lato client (vedi `selezionaMigliorItem`); il filtro CQL2
 * limita la copertura nuvolosa già sul server.
 */
export function buildStacSearchBody(
  bbox: [number, number, number, number],
  options: {
    cloudCoverMax?: number;
    giorniIndietro?: number;
    /** Intervallo esplicito inizio/fine (prevale su giorniIndietro). */
    datetimeRange?: { inizio: Date; fine: Date };
    limit?: number;
    ora?: Date;
  } = {},
): Record<string, unknown> {
  const cloudCoverMax = options.cloudCoverMax ?? 20;
  const fine = options.datetimeRange?.fine ?? options.ora ?? new Date();
  const inizio =
    options.datetimeRange?.inizio ??
    new Date(fine.getTime() - (options.giorniIndietro ?? 60) * 24 * 3600 * 1000);
  return {
    collections: [SENTINEL2_COLLECTION],
    bbox,
    datetime: `${inizio.toISOString()}/${fine.toISOString()}`,
    limit: options.limit ?? 10,
    query: { "eo:cloud_cover": { lte: cloudCoverMax } },
    sortby: [{ field: "properties.datetime", direction: "desc" }],
  };
}

export interface StacAsset {
  href: string;
  type?: string;
}

export interface StacItem {
  id: string;
  properties: {
    datetime: string;
    "eo:cloud_cover"?: number;
    [k: string]: unknown;
  };
  assets: Record<string, StacAsset>;
  bbox?: number[];
}

export interface StacItemCollection {
  features?: StacItem[];
}

/** Asset Sentinel-2 L2A delle bande necessarie all'NDVI. */
export const BAND_ASSET_KEYS = { red: "B04", nir: "B08" } as const;

export interface ScenaNdvi {
  itemId: string;
  datetime: string;
  cloudCover: number | null;
  redHref: string;
  nirHref: string;
}

/**
 * Sceglie l'item migliore: il più recente che esponga entrambe le bande
 * B04/B08. La risposta è già ordinata per data desc, ma non ci fidiamo
 * dell'ordine del server e riordiniamo. Ritorna null se nessun item è idoneo.
 */
export function selezionaMigliorItem(
  collection: StacItemCollection,
): ScenaNdvi | null {
  const features = collection.features ?? [];
  const ordinati = [...features].sort(
    (a, b) =>
      new Date(b.properties.datetime).getTime() -
      new Date(a.properties.datetime).getTime(),
  );
  for (const item of ordinati) {
    const red = item.assets[BAND_ASSET_KEYS.red];
    const nir = item.assets[BAND_ASSET_KEYS.nir];
    if (red?.href && nir?.href) {
      const cc = item.properties["eo:cloud_cover"];
      return {
        itemId: item.id,
        datetime: item.properties.datetime,
        cloudCover: typeof cc === "number" ? cc : null,
        redHref: red.href,
        nirHref: nir.href,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pipeline multi-indice e multi-temporale (refactor modulo Suolo)
// ---------------------------------------------------------------------------

/**
 * Bande Sentinel-2 (chiavi asset STAC) necessarie a calcolare un insieme di
 * indici. Unione delle bande richieste dai singoli indici, deduplicata: il
 * worker scarica solo questi asset per ogni scena.
 */
export function bandeRichiestePerIndici(
  indici: IndiceVegetazionale[],
): string[] {
  const bande = new Set<string>();
  for (const indice of indici) {
    if (isIndiceSuolo(indice)) {
      const { nir, red } = BANDE_SUOLO[indice];
      bande.add(nir);
      bande.add(red);
    } else {
      const { a, b } = BANDE_RICHIESTE[indice];
      bande.add(a);
      bande.add(b);
    }
  }
  return [...bande];
}

/** Una scena STAC con gli href delle bande necessarie agli indici scelti. */
export interface ScenaIndici {
  itemId: string;
  datetime: string;
  cloudCover: number | null;
  /** Href COG per ciascuna banda richiesta (chiave = nome banda, es. "B04"). */
  bandHrefs: Record<string, string>;
}

/**
 * Estrae dalla collection la serie di scene che espongono TUTTE le bande
 * richieste, ordinata per data decrescente (la più recente per prima). Le scene
 * prive anche di una sola banda necessaria sono scartate.
 */
export function estraiSerieScene(
  collection: StacItemCollection,
  bandeNecessarie: string[],
): ScenaIndici[] {
  const features = collection.features ?? [];
  const ordinati = [...features].sort(
    (a, b) =>
      new Date(b.properties.datetime).getTime() -
      new Date(a.properties.datetime).getTime(),
  );
  const scene: ScenaIndici[] = [];
  for (const item of ordinati) {
    const bandHrefs: Record<string, string> = {};
    let completa = true;
    for (const banda of bandeNecessarie) {
      const href = item.assets[banda]?.href;
      if (!href) {
        completa = false;
        break;
      }
      bandHrefs[banda] = href;
    }
    if (!completa) continue;
    const cc = item.properties["eo:cloud_cover"];
    scene.push({
      itemId: item.id,
      datetime: item.properties.datetime,
      cloudCover: typeof cc === "number" ? cc : null,
      bandHrefs,
    });
  }
  return scene;
}

/**
 * Restringe una serie di scene (ordinata per data desc) agli ultimi `giorni`
 * **a partire dalla scena più recente disponibile**, non da oggi. I passaggi
 * Sentinel-2 recenti possono essere tutti scartati (nuvole) o il catalogo può
 * essere in ritardo: ancorare la finestra all'ultima scena utile evita serie
 * vuote quando l'ultimo passaggio buono è più vecchio del periodo richiesto.
 * Restituisce la serie invariata se ha 0/1 elementi.
 */
export function filtraFinestraDaUltima(
  scene: ScenaIndici[],
  giorni: number,
): ScenaIndici[] {
  if (scene.length <= 1) return scene;
  const ancora = new Date(scene[0].datetime).getTime();
  const minimo = ancora - giorni * 24 * 3600 * 1000;
  return scene.filter((s) => new Date(s.datetime).getTime() >= minimo);
}

/**
 * Cerca la serie storica di scene Sentinel-2 sul bbox per gli indici scelti,
 * filtrata per copertura nuvolosa e finestra temporale (giorni indietro da
 * `ora`). Restituisce tutte le scene idonee, dalla più recente alla più vecchia
 * — la UI usa l'ultima per il raster e l'intera serie per il grafico di trend.
 * Con retry/backoff sui 429 e 5xx. Il `fetchImpl` è iniettabile per i test.
 */
export async function cercaSerieScene(
  bbox: [number, number, number, number],
  options: {
    indici: IndiceVegetazionale[];
    cloudCoverMax?: number;
    giorniIndietro?: number;
    /** Intervallo esplicito inizio/fine (analisi personalizzata). */
    datetimeRange?: { inizio: Date; fine: Date };
    limit?: number;
    ora?: Date;
    fetchImpl?: typeof fetch;
    apiUrl?: string;
    attesaBaseMs?: number;
  },
): Promise<ScenaIndici[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? STAC_API_URL;
  const bandeNecessarie = bandeRichiestePerIndici(options.indici);
  const body = buildStacSearchBody(bbox, {
    cloudCoverMax: options.cloudCoverMax,
    giorniIndietro: options.giorniIndietro,
    datetimeRange: options.datetimeRange,
    // Serie temporale: alza il limite di default per coprire più passaggi.
    limit: options.limit ?? 50,
    ora: options.ora,
  });
  const res = await fetchConBackoff(
    fetchImpl,
    `${apiUrl}/search`,
    { attesaBaseMs: options.attesaBaseMs },
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`STAC search fallita: HTTP ${res.status}`);
  }
  const collection = (await res.json()) as StacItemCollection;
  return estraiSerieScene(collection, bandeNecessarie);
}

/**
 * Esegue la POST /search e restituisce la scena migliore. Con retry/backoff
 * sui 429 e 5xx. Il `fetchImpl` è iniettabile per i test; di default usa la
 * `fetch` globale.
 */
export async function cercaUltimaScenaNdvi(
  bbox: [number, number, number, number],
  options: {
    cloudCoverMax?: number;
    giorniIndietro?: number;
    fetchImpl?: typeof fetch;
    apiUrl?: string;
    attesaBaseMs?: number;
  } = {},
): Promise<ScenaNdvi | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? STAC_API_URL;
  const body = buildStacSearchBody(bbox, {
    cloudCoverMax: options.cloudCoverMax,
    giorniIndietro: options.giorniIndietro,
  });
  const res = await fetchConBackoff(
    fetchImpl,
    `${apiUrl}/search`,
    { attesaBaseMs: options.attesaBaseMs },
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`STAC search fallita: HTTP ${res.status}`);
  }
  const collection = (await res.json()) as StacItemCollection;
  return selezionaMigliorItem(collection);
}
