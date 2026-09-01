import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOgcApiUrl,
  buildWfsUrl,
  createManualParcel,
  createManualSource,
  createOgcApiSource,
  createParcelSource,
  createWfsSource,
  epsgToOgcUri,
  epsgToUrn,
  isSourcedParcel,
  nextPageUrl,
  normalizeFeatureCollection,
  nutsCountryToIso,
  PARCEL_SOURCE_CATALOG,
  reprojectGeometry,
  resolveMapping,
  sourceById,
  UnsupportedAccessTypeError,
  type NormalizeDeps,
  type ParcelSourceDeps,
  type ParcelSourceRecord,
  type Reprojector,
} from "@agrogea/parcel";
import { createProj4Reprojector, UnknownCrsError } from "@agrogea/core";
import { catalogHosts } from "../apps/agro-field-suite/src/lib/parcel-source-transport";
import type { Polygon } from "geojson";
import bboxPage from "./fixtures/parcel-sources/nl-brp-bbox.json";
import page1 from "./fixtures/parcel-sources/nl-brp-page-1.json";
import page2 from "./fixtures/parcel-sources/nl-brp-page-2.json";

/**
 * Adapter di fonte e normalizzatori (@agrogea/parcel), su risposte REALI del
 * servizio PDOK salvate in `tests/fixtures/parcel-sources/`. Nessuna rete: il
 * recupero è iniettato, come in produzione.
 */

/** Il record di catalogo vero del pilota olandese. */
const NL = sourceById("nl-brp-gewaspercelen") as ParcelSourceRecord;

/** Riproiettore finto: sposta di 100 per rendere evidente che è stato applicato. */
const shiftReprojector: Reprojector = ([x, y]) => [x + 100, y + 100];

/** Generatore di id deterministico, per confrontare i risultati. */
function counterIds(): () => string {
  let n = 0;
  return () => `parcel-${++n}`;
}

function normalizeDeps(
  overrides: Partial<NormalizeDeps> = {},
): NormalizeDeps {
  return {
    reproject: shiftReprojector,
    newId: counterIds(),
    retrievedAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

/** Recupero finto: restituisce le risposte in coda e registra gli URL chiamati. */
function fakeFetch(responses: readonly unknown[]): {
  fetch: ParcelSourceDeps["fetch"];
  urls: string[];
} {
  const urls: string[] = [];
  let i = 0;
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      return responses[i++] ?? { type: "FeatureCollection", features: [] };
    },
  };
}

function sourceDeps(responses: readonly unknown[]): {
  deps: ParcelSourceDeps;
  urls: string[];
} {
  const { fetch, urls } = fakeFetch(responses);
  return {
    urls,
    deps: {
      fetch,
      reproject: shiftReprojector,
      newId: counterIds(),
      now: () => "2026-09-01T08:00:00.000Z",
    },
  };
}

describe("fonti particelle / normalizzazione su risposta reale PDOK", () => {
  it("costruisce particelle complete di provenienza e licenza", () => {
    const { parcels, skipped } = normalizeFeatureCollection(
      page1,
      NL,
      normalizeDeps(),
    );
    assert.equal(skipped, 0);
    assert.equal(parcels.length, 2);

    const [first] = parcels;
    assert.equal(first.sourceId, "BRP.2025.45247317");
    assert.equal(first.referenceUnitType, "agricultural_parcel");
    assert.equal(first.country, "NL");
    assert.equal(first.nutsCode, "NL");
    assert.equal(first.sourceName, NL.name);
    assert.equal(first.license.id, "CC0-1.0");
    assert.equal(first.license.attribution, "RVO / PDOK");
    assert.equal(first.retrievedAt, "2026-09-01T08:00:00.000Z");
    // Nessun dato agronomico entra nella particella.
    assert.deepEqual(first.farmFields, []);
  });

  it("estrae il codice coltura dall'URI di codelist INSPIRE", () => {
    // specificLanduseHref = "https://www.rvo.nl/gewascodes/259": senza
    // l'estrazione dichiarativa questo campo andrebbe perso o scritto a codice.
    const { parcels } = normalizeFeatureCollection(page1, NL, normalizeDeps());
    assert.equal(parcels[0].nationalCropCode, "259");
  });

  it("estrae l'annata dall'identificativo nativo", () => {
    const { parcels } = normalizeFeatureCollection(page1, NL, normalizeDeps());
    // localid = "BRP.2025.45247317" → campagna 2025, non la data di osservazione.
    assert.equal(parcels[0].validityYear, 2025);
  });

  it("conserva la geometria originale e ne pubblica una riproiettata", () => {
    const { parcels } = normalizeFeatureCollection(page1, NL, normalizeDeps());
    const [first] = parcels;
    assert.ok(isSourcedParcel(first));
    assert.equal(first.originalCrs, "EPSG:4258");
    // L'originale è quella della fixture, intatta…
    assert.deepEqual(
      first.originalGeometry,
      page1.features[0].geometry,
    );
    // …e la pubblicata è passata dal riproiettore (finto: +100).
    const original = page1.features[0].geometry.coordinates[0][0][0];
    const published = (
      first.geometry as { coordinates: number[][][][] }
    ).coordinates[0][0][0];
    assert.deepEqual(published, [original[0] + 100, original[1] + 100]);
  });

  it("l'HCAT non si inventa: lo traduce un passo successivo", () => {
    const { parcels } = normalizeFeatureCollection(page1, NL, normalizeDeps());
    assert.equal(parcels[0].hcatCode, null);
  });

  it("tutte le particelle di un'interrogazione condividono l'istante", () => {
    const { parcels } = normalizeFeatureCollection(bboxPage, NL, normalizeDeps());
    const instants = new Set(parcels.map((p) => p.retrievedAt));
    assert.equal(instants.size, 1);
  });
});

describe("fonti particelle / mappatura degli attributi", () => {
  const properties = {
    localid: "BRP.2025.45247317",
    href: "https://www.rvo.nl/gewascodes/259",
    vuoto: "   ",
    area: "2,4312",
  };

  it("forma breve: prende l'attributo così com'è", () => {
    assert.equal(resolveMapping(properties, "localid"), "BRP.2025.45247317");
  });

  it("forma estesa: estrae il gruppo catturato", () => {
    assert.equal(
      resolveMapping(properties, { attribute: "href", pattern: "/([^/]+)$" }),
      "259",
    );
  });

  it("resta vuoto invece di inventare un ripiego", () => {
    // Attributo assente, valore vuoto, pattern che non combacia: in nessun caso
    // si restituisce un valore parziale o l'attributo grezzo.
    assert.equal(resolveMapping(properties, "inesistente"), null);
    assert.equal(resolveMapping(properties, "vuoto"), null);
    assert.equal(
      resolveMapping(properties, { attribute: "localid", pattern: "^XX(\\d+)$" }),
      null,
    );
    assert.equal(resolveMapping(null, "localid"), null);
    assert.equal(resolveMapping(properties, undefined), null);
  });

  it("scarta le feature senza identificativo nativo", () => {
    // Senza sourceId non si potrebbe deduplicare: meglio scartare che adottare
    // una particella che non si saprà riconoscere al prossimo import.
    const senzaId = {
      type: "FeatureCollection",
      features: [
        { geometry: page1.features[0].geometry, properties: { altro: "x" } },
      ],
    };
    const { parcels, skipped } = normalizeFeatureCollection(
      senzaId,
      NL,
      normalizeDeps(),
    );
    assert.equal(parcels.length, 0);
    assert.equal(skipped, 1);
  });

  it("scarta le geometrie non poligonali", () => {
    const punto = {
      type: "FeatureCollection",
      features: [
        {
          geometry: { type: "Point", coordinates: [5, 52] },
          properties: { localid: "BRP.2025.1" },
        },
      ],
    };
    const { parcels, skipped } = normalizeFeatureCollection(
      punto,
      NL,
      normalizeDeps(),
    );
    assert.equal(parcels.length, 0);
    assert.equal(skipped, 1);
  });

  it("una risposta che non è una FeatureCollection non fa esplodere nulla", () => {
    for (const bogus of [null, undefined, {}, { features: "no" }, 42]) {
      assert.deepEqual(normalizeFeatureCollection(bogus, NL, normalizeDeps()), {
        parcels: [],
        skipped: 0,
      });
    }
  });
});

describe("fonti particelle / riproiezione", () => {
  const square: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  };

  it("percorre tutti i vertici di un poligono", () => {
    const out = reprojectGeometry(square, "EPSG:28992", shiftReprojector);
    assert.deepEqual(out.coordinates[0], [
      [100, 100],
      [101, 100],
      [101, 101],
      [100, 100],
    ]);
  });

  it("non tocca nulla se la fonte pubblica già in WGS84", () => {
    const out = reprojectGeometry(square, "EPSG:4326", shiftReprojector);
    assert.equal(out, square);
  });

  it("proj4: RD New cade dove deve, con lo scarto di datum", () => {
    const reproject = createProj4Reprojector();
    // x_0/y_0 di RD New (155000, 463000) è la torre di Amersfoort. Il risultato
    // non coincide con lon_0/lat_0 della proiezione: fra Bessel e WGS84 c'è uno
    // spostamento di datum, ed è giusto che la trasformazione lo applichi.
    const [lon, lat] = reproject([155000, 463000], "EPSG:28992");
    assert.ok(Math.abs(lon - 5.3876) < 0.005, `lon fuori tolleranza: ${lon}`);
    assert.ok(Math.abs(lat - 52.1562) < 0.005, `lat fuori tolleranza: ${lat}`);
  });

  it("proj4: ETRS89 e WGS84 coincidono nei fatti", () => {
    const reproject = createProj4Reprojector();
    const [lon, lat] = reproject([5.0999, 51.4439], "EPSG:4258");
    assert.ok(Math.abs(lon - 5.0999) < 1e-6);
    assert.ok(Math.abs(lat - 51.4439) < 1e-6);
  });

  it("proj4: un CRS non definito è un errore esplicito", () => {
    const reproject = createProj4Reprojector();
    assert.throws(() => reproject([0, 0], "EPSG:99999"), UnknownCrsError);
  });
});

describe("fonti particelle / adapter WFS", () => {
  it("costruisce una GetFeature con il riquadro in CRS84", () => {
    const url = new URL(
      buildWfsUrl(NL, [5.09, 51.44, 5.11, 51.45], { count: 100, startIndex: 0 }),
    );
    const params = url.searchParams;
    assert.equal(params.get("service"), "WFS");
    assert.equal(params.get("version"), "2.0.0");
    assert.equal(params.get("request"), "GetFeature");
    assert.equal(params.get("typeNames"), NL.featureType);
    assert.equal(params.get("outputFormat"), "application/json");
    // Il CRS del riquadro evita l'ambiguità sull'ordine degli assi di EPSG:4326.
    assert.equal(
      params.get("bbox"),
      "5.09,51.44,5.11,51.45,urn:ogc:def:crs:OGC:1.3:CRS84",
    );
    // Le geometrie si chiedono nel CRS NATIVO: è quello che si conserva.
    assert.equal(params.get("srsName"), "urn:ogc:def:crs:EPSG::4258");
  });

  it("traduce i codici EPSG nella forma URN", () => {
    assert.equal(epsgToUrn("EPSG:4258"), "urn:ogc:def:crs:EPSG::4258");
    assert.equal(epsgToUrn("EPSG:28992"), "urn:ogc:def:crs:EPSG::28992");
    // Ciò che non è un codice EPSG passa invariato.
    assert.equal(epsgToUrn("CRS84"), "CRS84");
  });

  it("impagina finché il servizio riempie la pagina", async () => {
    // PDOK non dichiara numberReturned: ci si ferma sul "meno del richiesto".
    const { deps, urls } = sourceDeps([page1, page2]);
    const source = createWfsSource(NL, deps);
    const parcels = await source.queryByBbox([5.09, 51.44, 5.11, 51.45], {
      pageSize: 2,
    });
    assert.equal(parcels.length, 4);
    // Terza richiesta vuota: è così che si scopre che la seconda era l'ultima.
    assert.equal(urls.length, 3);
    assert.equal(new URL(urls[0]).searchParams.get("startIndex"), "0");
    assert.equal(new URL(urls[1]).searchParams.get("startIndex"), "2");
  });

  it("una pagina più corta della richiesta chiude subito il ciclo", async () => {
    const { deps, urls } = sourceDeps([page1]);
    const source = createWfsSource(NL, deps);
    const parcels = await source.queryByBbox([5.09, 51.44, 5.11, 51.45], {
      pageSize: 500,
    });
    assert.equal(parcels.length, 2);
    assert.equal(urls.length, 1, "una sola richiesta");
  });

  it("rispetta il tetto di sicurezza sulle particelle", async () => {
    const { deps, urls } = sourceDeps([page1, page2]);
    const source = createWfsSource(NL, deps);
    const parcels = await source.queryByBbox([5.09, 51.44, 5.11, 51.45], {
      pageSize: 2,
      maxFeatures: 3,
    });
    assert.ok(parcels.length <= 3, `attese al più 3 particelle, ${parcels.length}`);
    // La seconda richiesta chiede solo ciò che manca, non un'altra pagina piena.
    assert.equal(new URL(urls[1]).searchParams.get("count"), "1");
  });

  it("l'interrogazione puntuale usa un riquadro minuscolo", async () => {
    const { deps, urls } = sourceDeps([bboxPage]);
    const source = createWfsSource(NL, deps);
    await source.queryByPoint([5.1, 51.445]);
    const bbox = new URL(urls[0]).searchParams.get("bbox") ?? "";
    const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
    assert.ok(minLon < 5.1 && maxLon > 5.1);
    assert.ok(minLat < 51.445 && maxLat > 51.445);
    assert.ok(maxLon - minLon < 0.001, "riquadro troppo largo per un punto");
  });

  it("dichiara di saper rispondere dal vivo", () => {
    const { deps } = sourceDeps([]);
    assert.equal(createWfsSource(NL, deps).supportsLiveQuery, true);
  });
});

describe("fonti particelle / adapter OGC API", () => {
  const ogcRecord: ParcelSourceRecord = {
    ...NL,
    id: "nl-ogc-example",
    accessType: "ogcapi",
    endpoint: "https://api.example.org/v1",
    featureType: "gewaspercelen",
  };

  it("compone /collections/{id}/items con i CRS giusti", () => {
    const url = new URL(
      buildOgcApiUrl(ogcRecord, [5.09, 51.44, 5.11, 51.45], { limit: 100 }),
    );
    assert.equal(url.pathname, "/v1/collections/gewaspercelen/items");
    assert.equal(url.searchParams.get("bbox"), "5.09,51.44,5.11,51.45");
    assert.equal(
      url.searchParams.get("bbox-crs"),
      "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    );
    assert.equal(
      url.searchParams.get("crs"),
      "http://www.opengis.net/def/crs/EPSG/0/4258",
    );
  });

  it("traduce i codici EPSG nella forma URI OGC", () => {
    assert.equal(
      epsgToOgcUri("EPSG:28992"),
      "http://www.opengis.net/def/crs/EPSG/0/28992",
    );
  });

  it("segue il collegamento next, assoluto o relativo", () => {
    const base = "https://api.example.org/v1/collections/x/items?limit=2";
    assert.equal(
      nextPageUrl({ links: [{ rel: "next", href: "?limit=2&offset=2" }] }, base),
      "https://api.example.org/v1/collections/x/items?limit=2&offset=2",
    );
    assert.equal(
      nextPageUrl(
        { links: [{ rel: "next", href: "https://altro.example.org/p2" }] },
        base,
      ),
      "https://altro.example.org/p2",
    );
    assert.equal(nextPageUrl({ links: [{ rel: "self", href: "x" }] }, base), null);
    assert.equal(nextPageUrl({}, base), null);
  });

  it("impagina seguendo i collegamenti dichiarati dal servizio", async () => {
    const withNext = {
      ...page1,
      links: [{ rel: "next", href: "?offset=2" }],
    };
    const { deps, urls } = sourceDeps([withNext, page2]);
    const source = createOgcApiSource(ogcRecord, deps);
    const parcels = await source.queryByBbox([5.09, 51.44, 5.11, 51.45]);
    assert.equal(parcels.length, 4);
    assert.equal(urls.length, 2, "si ferma quando non c'è più un next");
  });

  it("non entra in ciclo se il servizio rimanda alla stessa pagina", async () => {
    const selfLoop = { ...page1, links: [{ rel: "next", href: "?loop=1" }] };
    // Ogni risposta ripropone lo stesso next: senza la guardia sugli URL già
    // visitati questa interrogazione non finirebbe mai.
    const { deps, urls } = sourceDeps([selfLoop, selfLoop, selfLoop, selfLoop]);
    const source = createOgcApiSource(ogcRecord, deps);
    const parcels = await source.queryByBbox([5.09, 51.44, 5.11, 51.45]);
    assert.ok(urls.length <= 2, `attese al più 2 richieste, ${urls.length}`);
    assert.ok(parcels.length > 0);
  });
});

describe("fonti particelle / digitalizzazione manuale", () => {
  const drawn: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [11.0, 43.0],
        [11.01, 43.0],
        [11.01, 43.01],
        [11.0, 43.0],
      ],
    ],
  };

  it("produce una particella dello stesso contratto, senza provenienza", () => {
    const parcel = createManualParcel(
      { geometry: drawn, country: "IT", nutsCode: "ITI1" },
      { newId: () => "manual-1", now: () => "2026-09-01T08:00:00.000Z" },
    );
    assert.equal(parcel.referenceUnitType, "manual");
    assert.equal(parcel.country, "IT");
    assert.equal(parcel.sourceId, null);
    assert.equal(parcel.license, null);
    // Nessuna riproiezione: la mappa lavora già in WGS84, quindi non esiste
    // una geometria "originale" diversa da questa.
    assert.equal(parcel.originalGeometry, null);
    assert.equal(parcel.originalCrs, null);
    assert.deepEqual(parcel.geometry, drawn);
  });

  it("non è interrogabile, ma non è nemmeno un errore interrogarla", async () => {
    const source = createManualSource();
    assert.equal(source.supportsLiveQuery, false);
    assert.deepEqual(await source.queryByBbox([0, 0, 1, 1]), []);
    assert.deepEqual(await source.queryByPoint([0, 0]), []);
  });
});

describe("fonti particelle / scelta dell'adapter", () => {
  it("istanzia l'adapter dichiarato dal record", () => {
    const { deps } = sourceDeps([]);
    assert.equal(createParcelSource(NL, deps).id, NL.id);
  });

  it("un modo di accesso non ancora coperto fallisce a voce alta", () => {
    // Silenziosamente zero particelle sembrerebbe "qui non ci sono dati", che è
    // una bugia: i dati ci sono, non sappiamo ancora leggerli.
    const { deps } = sourceDeps([]);
    assert.throws(
      () => createParcelSource({ ...NL, accessType: "gml" }, deps),
      UnsupportedAccessTypeError,
    );
  });
});

describe("fonti particelle / allow-list del trasporto", () => {
  it("copre esattamente gli host del catalogo", () => {
    // È l'invariante che tiene in piedi la difesa nativa: se un host del
    // catalogo mancasse, quella fonte sarebbe bloccata dal comando Rust; se ce
    // ne fosse uno in più, l'allow-list smetterebbe di derivare dal catalogo.
    const hosts = new Set(catalogHosts());
    const expected = new Set(
      PARCEL_SOURCE_CATALOG.map((source) => new URL(source.endpoint).host),
    );
    assert.deepEqual([...hosts].sort(), [...expected].sort());
  });

  it("non duplica un host condiviso da più fonti", () => {
    const hosts = catalogHosts();
    assert.equal(new Set(hosts).size, hosts.length);
  });
});

describe("fonti particelle / paese di un nodo NUTS", () => {
  it("traduce le due divergenze di Eurostat", () => {
    // Senza questa traduzione una particella greca porterebbe country "EL",
    // che non è un codice ISO e romperebbe il contratto a valle.
    assert.equal(nutsCountryToIso("EL"), "GR");
    assert.equal(nutsCountryToIso("EL30"), "GR");
    assert.equal(nutsCountryToIso("UKI"), "GB");
  });

  it("lascia intatti i codici che già coincidono", () => {
    assert.equal(nutsCountryToIso("NL32"), "NL");
    assert.equal(nutsCountryToIso("ITI1"), "IT");
  });

  it("respinge un paese inesistente", () => {
    assert.equal(nutsCountryToIso("ZZ1"), null);
  });
});
