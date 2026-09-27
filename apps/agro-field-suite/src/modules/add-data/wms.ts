/**
 * Aggiunta di un layer **WMS** da URL.
 *
 * ## Perché non basta incollare l'indirizzo
 *
 * Un endpoint WMS non è un'immagine: è un servizio che espone *molti* layer,
 * ognuno con il proprio nome tecnico (`p:ortofoto2023`, `topp:states`). Chiedere
 * all'utente di digitarlo significa chiedergli un dato che non ha, e sbagliarlo
 * di una lettera produce una mappa vuota senza messaggio d'errore — il servizio
 * risponde comunque, con un'immagine trasparente.
 *
 * Si interroga quindi il **GetCapabilities**, che è il documento con cui ogni
 * WMS dichiara che cosa serve: nomi, titoli leggibili e sistemi di riferimento
 * supportati. L'utente sceglie da un elenco.
 *
 * ## Il parser è volutamente tollerante
 *
 * Le capabilities sono XML annidato, e i server reali si prendono libertà:
 * namespace diversi, indentazioni creative, gerarchie di gruppi profonde. Un
 * parser rigido fallirebbe su metà dei servizi regionali italiani. Qui si
 * estraggono le coppie `<Name>`/`<Title>` in ordine di documento, saltando
 * l'intestazione `<Service>` — pragmatico e testabile in Node senza DOM.
 *
 * Il rendering lo fa GeoLibre, che supporta `type: "wms"` nativamente
 * (`layer-sync.ts`), GetFeatureInfo compreso: qui si costruisce soltanto il
 * template dell'URL GetMap.
 */

/** Versioni WMS gestite. La 1.3.0 è lo standard attuale; la 1.1.1 è ovunque. */
export type WmsVersion = "1.3.0" | "1.1.1";

export interface WmsLayerInfo {
  /** Nome tecnico, quello che va nel parametro `LAYERS`. */
  name: string;
  /** Titolo leggibile, quello che si mostra all'utente. */
  title: string;
}

export interface WmsCapabilities {
  version: WmsVersion;
  layers: WmsLayerInfo[];
}

/** URL di GetCapabilities, preservando eventuali parametri già presenti. */
export function wmsCapabilitiesUrl(
  baseUrl: string,
  version: WmsVersion = "1.3.0",
): string {
  const url = new URL(baseUrl);
  // I parametri esistenti si conservano (molti servizi regionali incapsulano
  // un token o un percorso di servizio nella query), ma quelli di richiesta si
  // riscrivono: un URL GetMap incollato dall'utente deve diventare una
  // GetCapabilities, non restare quello che era.
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("REQUEST", "GetCapabilities");
  url.searchParams.set("VERSION", version);
  return url.toString();
}

/**
 * Estrae i layer nominati dalle capabilities.
 *
 * Salta tutto ciò che precede `</Service>`: là dentro c'è il `<Name>` del
 * servizio (tipicamente `WMS`), che non è un layer e comparirebbe in cima
 * all'elenco confondendo chi sceglie.
 */
export function parseWmsCapabilities(xml: string): WmsCapabilities {
  const version = /version\s*=\s*"1\.1\.1"/i.test(xml) ? "1.1.1" : "1.3.0";
  const serviceEnd = xml.search(/<\/(?:\w+:)?Service>/i);
  const body = serviceEnd >= 0 ? xml.slice(serviceEnd) : xml;

  // Coppie Name/Title in ordine di documento: dentro un <Layer> il nome
  // precede sempre il titolo, quindi il primo titolo dopo un nome è il suo.
  const tag = (name: string) =>
    new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "gi");
  const found: { index: number; kind: "name" | "title"; value: string }[] = [];
  for (const kind of ["name", "title"] as const) {
    const pattern = tag(kind === "name" ? "Name" : "Title");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      found.push({ index: match.index, kind, value: decodeXml(match[1].trim()) });
    }
  }
  found.sort((a, b) => a.index - b.index);

  const layers: WmsLayerInfo[] = [];
  for (let i = 0; i < found.length; i++) {
    if (found[i].kind !== "name" || !found[i].value) continue;
    const next = found[i + 1];
    layers.push({
      name: found[i].value,
      title: next?.kind === "title" && next.value ? next.value : found[i].value,
    });
  }
  return { version, layers };
}

/** Entità XML minime che compaiono nei titoli dei servizi reali. */
function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export interface WmsTileUrlOptions {
  baseUrl: string;
  layerName: string;
  version?: WmsVersion;
  format?: string;
  transparent?: boolean;
  styles?: string;
}

/**
 * Template dell'URL GetMap con il segnaposto `{bbox-epsg-3857}` che MapLibre
 * sostituisce a ogni tile.
 *
 * Il parametro del sistema di riferimento cambia nome fra le due versioni —
 * `CRS` nella 1.3.0, `SRS` nella 1.1.1 — ed è l'errore che fa rispondere al
 * server "missing parameter" in modo poco leggibile. Si usa EPSG:3857, l'unica
 * proiezione in cui i tile di MapLibre sono quadrati: con EPSG:4326 la 1.3.0
 * pretende anche l'ordine invertito degli assi, e le immagini tornano ruotate.
 */
export function buildWmsTileUrl(options: WmsTileUrlOptions): string {
  const version = options.version ?? "1.3.0";
  const url = new URL(options.baseUrl);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("REQUEST", "GetMap");
  url.searchParams.set("VERSION", version);
  url.searchParams.set("LAYERS", options.layerName);
  url.searchParams.set("STYLES", options.styles ?? "");
  url.searchParams.set("FORMAT", options.format ?? "image/png");
  url.searchParams.set("TRANSPARENT", String(options.transparent ?? true));
  url.searchParams.set(version === "1.3.0" ? "CRS" : "SRS", "EPSG:3857");
  url.searchParams.set("WIDTH", "256");
  url.searchParams.set("HEIGHT", "256");
  // Il segnaposto non deve essere percent-encoded, altrimenti MapLibre non lo
  // riconosce: si aggiunge dopo la serializzazione.
  url.searchParams.set("BBOX", "__BBOX__");
  return url.toString().replace("__BBOX__", "{bbox-epsg-3857}");
}

/** Scarica e interpreta le capabilities di un endpoint WMS. */
export async function fetchWmsCapabilities(
  baseUrl: string,
  options: { fetchImpl?: typeof fetch; version?: WmsVersion } = {},
): Promise<WmsCapabilities> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(wmsCapabilitiesUrl(baseUrl, options.version));
  if (!res.ok) {
    throw new Error(`Il servizio WMS ha risposto HTTP ${res.status}.`);
  }
  const capabilities = parseWmsCapabilities(await res.text());
  if (capabilities.layers.length === 0) {
    throw new Error(
      "Il servizio non dichiara alcun layer interrogabile: controlla l'indirizzo.",
    );
  }
  return capabilities;
}
