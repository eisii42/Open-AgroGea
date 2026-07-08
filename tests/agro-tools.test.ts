import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  degreeDayAccumulation,
  applySoilMask,
  requiredBandsForIndices,
  buildStacSearchBody,
  computeIndex,
  computeMsavi2,
  computeSavi,
  searchSceneSeries,
  searchLatestNdviScene,
  clipRasterToPolygon,
  colorFromRamp,
  applySasToken,
  extractSceneSeries,
  filterWindowFromLatest,
  windowToCoordinates,
  signPlanetaryComputerHref,
  planetaryComputerToken,
  indexToRgba,
  rampForIndex,
  utmToLonLat,
  normalizedDifference,
  dosesPerClass,
  et0PenmanMonteith,
  cropEt,
  coverFraction,
  getPhaseCalibration,
  degreeDaysMeanThreshold,
  degreeDaysSingleSine,
  lonLatToUtm,
  CROP_MATRICES,
  irrigationPlan,
  threeTenRule,
  powderyMildewRisk,
  selectBestItem,
  soilMaskThreshold,
  indexStatistics,
  soilWaterStatus,
  utmEpsg,
  utmZoneFromLon,
  kmeansZoning,
  type WeatherDataDay,
  type RasterWindow,
  type StacItemCollection,
} from "@agrogea/tools";
import { areaHectares, boundingBox } from "@agrogea/core";
import type { Polygon } from "geojson";

const f32 = (xs: number[]) => Float32Array.from(xs);

describe("indici spettrali", () => {
  it("NDVI è la differenza normalizzata NIR/Red", () => {
    // NIR=0.5, Red=0.1 → (0.5-0.1)/(0.6) = 0.6667
    const out = computeIndex("ndvi", { B08: f32([0.5]), B04: f32([0.1]) });
    assert.ok(Math.abs(out[0] - 0.4 / 0.6) < 1e-6);
  });

  it("marca NaN i pixel con somma nulla", () => {
    const out = normalizedDifference(f32([0, 0.2]), f32([0, 0.1]));
    assert.ok(Number.isNaN(out[0]));
    assert.ok(!Number.isNaN(out[1]));
  });

  it("SAVI con L=0 coincide con NDVI", () => {
    const nir = f32([0.5, 0.4]);
    const red = f32([0.1, 0.2]);
    const savi0 = computeSavi(nir, red, 0);
    const ndvi = normalizedDifference(nir, red);
    for (let i = 0; i < nir.length; i++) {
      assert.ok(Math.abs(savi0[i] - ndvi[i]) < 1e-6);
    }
  });

  it("MSAVI2 resta nel range atteso e degenera correttamente", () => {
    // NIR=Red → MSAVI2 = (2n+1 - sqrt((2n+1)^2)) / 2 = 0
    const out = computeMsavi2(f32([0.3]), f32([0.3]));
    assert.ok(Math.abs(out[0]) < 1e-6);
    const veg = computeMsavi2(f32([0.6]), f32([0.1]));
    assert.ok(veg[0] > 0 && veg[0] <= 1);
  });

  it("soil-mask azzera i pixel sotto soglia e calcola la copertura", () => {
    const idx = f32([0.1, 0.5, 0.2, 0.8]);
    const masked = applySoilMask(idx, 0.3);
    assert.ok(Number.isNaN(masked[0]) && Number.isNaN(masked[2]));
    assert.equal(masked[1], 0.5);
    assert.equal(coverFraction(masked), 0.5);
  });

  it("statistiche escludono i NaN", () => {
    const stats = indexStatistics(f32([0.4, Number.NaN, 0.6]));
    assert.equal(stats.pixelValidi, 2);
    assert.ok(Math.abs(stats.media - 0.5) < 1e-6);
  });
});

describe("fenologia", () => {
  it("ogni crop ha 4 fasi con Kc positivo", () => {
    for (const matrice of Object.values(CROP_MATRICES)) {
      assert.equal(matrice.fasi.length, 4);
      for (const phase of matrice.fasi) assert.ok(phase.kc > 0);
    }
  });

  it("il soil-mask è attivo solo per le arboree", () => {
    assert.ok(soilMaskThreshold("vite", "piena") !== null); // arborea
    assert.equal(soilMaskThreshold("frumento", "piena"), null); // seminativo
  });

  it("getPhaseCalibration restituisce la phase richiesta", () => {
    const cal = getPhaseCalibration("melo", "piena");
    assert.equal(cal.phase, "piena");
    assert.ok(cal.ndviAtteso[0] < cal.ndviAtteso[1]);
  });
});

describe("zonazione VRA", () => {
  it("separa due cluster ben distinti", () => {
    const valori = f32([0.2, 0.21, 0.22, 0.8, 0.81, 0.82]);
    const res = kmeansZoning(valori, 2);
    assert.equal(res.classi.length, 2);
    // I primi 3 e gli ultimi 3 in classi diverse.
    assert.equal(res.assegnazioni[0], res.assegnazioni[2]);
    assert.equal(res.assegnazioni[3], res.assegnazioni[5]);
    assert.notEqual(res.assegnazioni[0], res.assegnazioni[3]);
  });

  it("è deterministico (stesso input → stesso output)", () => {
    const valori = f32([0.1, 0.3, 0.5, 0.55, 0.9, 0.2, 0.7]);
    const a = kmeansZoning(valori, 3);
    const b = kmeansZoning(valori, 3);
    assert.deepEqual(Array.from(a.assegnazioni), Array.from(b.assegnazioni));
    assert.deepEqual(a.soglie, b.soglie);
  });

  it("scarta i NaN del soil-masking", () => {
    const res = kmeansZoning(f32([0.2, Number.NaN, 0.8, 0.81]), 2);
    const totale = res.classi.reduce((s, c) => s + c.pixel, 0);
    assert.equal(totale, 3); // il NaN non conta
  });

  it("dose conservativa: più dose dove il vigore è basso", () => {
    const res = kmeansZoning(f32([0.2, 0.21, 0.8, 0.81]), 2);
    const dosi = dosesPerClass(res.classi, 100, "conservativa", 0.3);
    // ordinate per centroid crescente: la prima (vigore basso) ha dose maggiore
    assert.ok(dosi[0].dose > dosi[1].dose);
  });

  it("dose spinta: più dose dove il vigore è alto", () => {
    const res = kmeansZoning(f32([0.2, 0.21, 0.8, 0.81]), 2);
    const dosi = dosesPerClass(res.classi, 100, "spinta", 0.3);
    assert.ok(dosi[1].dose > dosi[0].dose);
  });
});

describe("agrometeo", () => {
  // Caso noto FAO-56 (Example 18, Bruxelles): ET0 ≈ 3.9 mm/day.
  const day: WeatherDataDay = {
    tMin: 12.3,
    tMax: 21.5,
    rhMin: 63,
    rhMax: 84,
    windSpeed2m: 2.078,
    radiation: 22.07,
    altitude: 100,
  };

  it("ET0 Penman-Monteith nel range plausibile FAO-56", () => {
    const et0 = et0PenmanMonteith(day);
    assert.ok(et0 > 2.5 && et0 < 5.5, `ET0 fuori range: ${et0}`);
  });

  it("ETc scala con Kc", () => {
    assert.equal(cropEt(4, 1.15), 4 * 1.15);
  });

  it("stato idrico: AWC, RAW e soglia di stress", () => {
    const soil = {
      fieldCapacity: 0.3,
      wiltingPoint: 0.12,
      rootDepth: 1,
      depletionFraction: 0.5,
    };
    const stato = soilWaterStatus(soil, 0);
    // AWC = (0.30-0.12)*1*1000 = 180 mm; RAW = 90 mm
    assert.ok(Math.abs(stato.awc - 180) < 1e-6);
    assert.ok(Math.abs(stato.raw - 90) < 1e-6);
    assert.equal(stato.inStress, false);
  });

  it("piano irriguo: prescrive irrigation raggiunta la depletion critica", () => {
    const soil = {
      fieldCapacity: 0.3,
      wiltingPoint: 0.12,
      rootDepth: 1,
      depletionFraction: 0.5,
    };
    // 5 mm/day di ETc, nessuna rain: RAW=90mm → autonomia ~18 giorni
    const etc = new Array(40).fill(5);
    const rain = new Array(40).fill(0);
    const { series, autonomyDays } = irrigationPlan(soil, etc, rain, 0);
    assert.ok(autonomyDays >= 17 && autonomyDays <= 19, `autonomia ${autonomyDays}`);
    assert.ok(series.some((g) => g.irrigation > 0));
  });
});

describe("DSS fitopatologico", () => {
  it("gradi-day media-soglia rispetta base e cutoff", () => {
    assert.equal(degreeDaysMeanThreshold(8, 12, 10), 0); // media 10 = base → 0
    assert.equal(degreeDaysMeanThreshold(10, 20, 10), 5); // media 15 − 10
    assert.equal(degreeDaysMeanThreshold(30, 40, 10, 30), 20); // cutoff a 30
  });

  it("single-sine ≥ 0 e degenera con tMin ≥ base", () => {
    assert.equal(degreeDaysSingleSine(12, 20, 10), 16 - 10);
    assert.equal(degreeDaysSingleSine(5, 8, 10), 0); // tMax < base
  });

  it("accumulo segnala il day di superamento soglia", () => {
    const series = Array.from({ length: 10 }, () => ({ tMin: 10, tMax: 20 })); // 5 GDD/g
    const { cumulative, thresholdDay } = degreeDayAccumulation(series, 10, {
      targetThreshold: 22,
    });
    assert.ok(Math.abs(cumulative[9] - 50) < 1e-6);
    assert.equal(thresholdDay, 4); // 5*5 = 25 ≥ 22 al day index 4
  });

  it("regola tre-dieci scatta solo con tutte le condizioni", () => {
    const senza = threeTenRule([
      { tMean: 12, rain: 5, shootLength: 15 }, // rain < 10
    ]);
    assert.equal(senza, null);
    const con = threeTenRule([
      { tMean: 8, rain: 12, shootLength: 12 }, // T < 10
      { tMean: 14, rain: 18, shootLength: 14 }, // tutte ok
    ]);
    assert.ok(con);
    assert.equal(con?.day, 1);
    assert.equal(con?.risk, "alto");
  });

  it("risk oidio cresce con i giorni favorevoli consecutivi", () => {
    const series = Array.from({ length: 4 }, () => ({
      tMin: 20,
      tMax: 26,
      rhMean: 60,
    }));
    const alert = powderyMildewRisk(series);
    assert.ok(alert);
    assert.equal(alert?.risk, "alto"); // 4 consecutivi ≥ 3
  });
});

describe("geometria (area geodetica + bbox)", () => {
  // Quadrato di 0.01° a lat ~43.77 (Firenze): ~0.81  km lon × ~1.11 km lat.
  const quadrato: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [11.25, 43.77],
        [11.26, 43.77],
        [11.26, 43.78],
        [11.25, 43.78],
        [11.25, 43.77],
      ],
    ],
  };

  it("area in ettari plausibile per il quadrato 0.01°", () => {
    const ha = areaHectares(quadrato);
    // ~0.0089° lon reali × 0.01° lat → ~90 ha; banda larga ma sanity check.
    assert.ok(ha > 70 && ha < 100, `area inattesa: ${ha} ha`);
  });

  it("bbox racchiude la geometria", () => {
    const [minX, minY, maxX, maxY] = boundingBox(quadrato);
    assert.ok(Math.abs(minX - 11.25) < 1e-9);
    assert.ok(Math.abs(minY - 43.77) < 1e-9);
    assert.ok(Math.abs(maxX - 11.26) < 1e-9);
    assert.ok(Math.abs(maxY - 43.78) < 1e-9);
  });
});

describe("pipeline STAC NDVI", () => {
  it("la query filtra collezione, bbox e cloud cover", () => {
    const body = buildStacSearchBody([11.25, 43.77, 11.26, 43.78], {
      cloudCoverMax: 15,
    });
    assert.deepEqual(body.collections, ["sentinel-2-l2a"]);
    assert.deepEqual(body.bbox, [11.25, 43.77, 11.26, 43.78]);
    assert.deepEqual(body.query, { "eo:cloud_cover": { lte: 15 } });
  });

  it("seleziona l'item più recente con entrambe le bande", () => {
    const collection: StacItemCollection = {
      features: [
        {
          id: "vecchia",
          properties: { datetime: "2026-05-01T10:00:00Z", "eo:cloud_cover": 5 },
          assets: {
            B04: { href: "red-old.tif" },
            B08: { href: "nir-old.tif" },
          },
        },
        {
          id: "recente-incompleta",
          properties: { datetime: "2026-06-10T10:00:00Z" },
          assets: { B04: { href: "red.tif" } }, // manca B08
        },
        {
          id: "recente-completa",
          properties: { datetime: "2026-06-05T10:00:00Z", "eo:cloud_cover": 8 },
          assets: { B04: { href: "red.tif" }, B08: { href: "nir.tif" } },
        },
      ],
    };
    const scena = selectBestItem(collection);
    assert.equal(scena?.itemId, "recente-completa");
    assert.equal(scena?.cloudCover, 8);
  });

  it("ritorna null se nessun item ha le bande NDVI", () => {
    assert.equal(
      selectBestItem({
        features: [
          {
            id: "x",
            properties: { datetime: "2026-06-01T10:00:00Z" },
            assets: { B03: { href: "green.tif" } },
          },
        ],
      }),
      null,
    );
  });

  it("searchLatestNdviScene usa il fetch iniettato e propaga l'errore HTTP", async () => {
    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              id: "ok",
              properties: { datetime: "2026-06-01T10:00:00Z" },
              assets: { B04: { href: "r.tif" }, B08: { href: "n.tif" } },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const scena = await searchLatestNdviScene([0, 0, 1, 1], { fetchImpl: okFetch });
    assert.equal(scena?.itemId, "ok");

    const badFetch = (async () =>
      new Response("boom", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(
      searchLatestNdviScene([0, 0, 1, 1], { fetchImpl: badFetch, attesaBaseMs: 0 }),
      /HTTP 503/,
    );
  });

  it("searchLatestNdviScene riprova sui 429 conservando la POST (backoff)", async () => {
    let chiamate = 0;
    const flakyFetch = (async (_url: string, init?: RequestInit) => {
      chiamate++;
      assert.equal(init?.method, "POST");
      assert.ok(init?.body, "il body della search va rimandato a ogni tentativo");
      if (chiamate === 1) {
        return new Response("rate", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(
        JSON.stringify({
          features: [
            {
              id: "dopo-retry",
              properties: { datetime: "2026-06-01T10:00:00Z" },
              assets: { B04: { href: "r.tif" }, B08: { href: "n.tif" } },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const scena = await searchLatestNdviScene([0, 0, 1, 1], {
      fetchImpl: flakyFetch,
      attesaBaseMs: 0,
    });
    assert.equal(scena?.itemId, "dopo-retry");
    assert.equal(chiamate, 2);
  });
});

describe("pipeline STAC multi-index e series temporale", () => {
  it("requiredBandsForIndices unisce e deduplica le bande", () => {
    // ndvi: B08/B04, ndre: B08/B05, ndwi: B03/B08, savi: B08/B04, msavi2: B08/B04
    const bande = requiredBandsForIndices(["ndvi", "ndre", "ndwi", "savi", "msavi2"]);
    assert.deepEqual([...bande].sort(), ["B03", "B04", "B05", "B08"]);
  });

  it("requiredBandsForIndices per il solo NDVI chiede B08 e B04", () => {
    assert.deepEqual([...requiredBandsForIndices(["ndvi"])].sort(), ["B04", "B08"]);
  });

  it("extractSceneSeries tiene solo le scene complete, ordinate per data desc", () => {
    const collection: StacItemCollection = {
      features: [
        {
          id: "a-vecchia",
          properties: { datetime: "2026-05-01T10:00:00Z", "eo:cloud_cover": 4 },
          assets: { B04: { href: "r1" }, B08: { href: "n1" }, B05: { href: "re1" } },
        },
        {
          id: "b-incompleta",
          properties: { datetime: "2026-06-10T10:00:00Z", "eo:cloud_cover": 2 },
          assets: { B04: { href: "r2" }, B08: { href: "n2" } }, // manca B05
        },
        {
          id: "c-recente",
          properties: { datetime: "2026-06-05T10:00:00Z", "eo:cloud_cover": 7 },
          assets: { B04: { href: "r3" }, B08: { href: "n3" }, B05: { href: "re3" } },
        },
      ],
    };
    // NDRE richiede anche B05: la scena "b" va scartata.
    const series = extractSceneSeries(collection, requiredBandsForIndices(["ndre"]));
    assert.deepEqual(
      series.map((s) => s.itemId),
      ["c-recente", "a-vecchia"],
    );
    assert.equal(series[0].bandHrefs.B05, "re3");
    assert.equal(series[0].cloudCover, 7);
  });

  it("searchSceneSeries usa il fetch iniettato e propaga l'errore HTTP", async () => {
    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              id: "s1",
              properties: { datetime: "2026-06-01T10:00:00Z", "eo:cloud_cover": 3 },
              assets: { B04: { href: "r" }, B08: { href: "n" } },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const series = await searchSceneSeries([0, 0, 1, 1], {
      indici: ["ndvi"],
      fetchImpl: okFetch,
    });
    assert.equal(series.length, 1);
    assert.equal(series[0].itemId, "s1");

    const badFetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(
      searchSceneSeries([0, 0, 1, 1], {
        indici: ["ndvi"],
        fetchImpl: badFetch,
        attesaBaseMs: 0,
      }),
      /HTTP 500/,
    );
  });

  it("searchSceneSeries riprova su 429/5xx e poi riesce (backoff)", async () => {
    let chiamate = 0;
    const flakyFetch = (async (_url: string, init?: RequestInit) => {
      chiamate++;
      assert.equal(init?.method, "POST");
      if (chiamate <= 2) {
        // Primo 429, poi 503: entrambi vanno ritentati.
        return new Response("giù", { status: chiamate === 1 ? 429 : 503 });
      }
      return new Response(
        JSON.stringify({
          features: [
            {
              id: "s-retry",
              properties: { datetime: "2026-06-01T10:00:00Z", "eo:cloud_cover": 3 },
              assets: { B04: { href: "r" }, B08: { href: "n" } },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const series = await searchSceneSeries([0, 0, 1, 1], {
      indici: ["ndvi"],
      fetchImpl: flakyFetch,
      attesaBaseMs: 0,
    });
    assert.equal(series.length, 1);
    assert.equal(series[0].itemId, "s-retry");
    assert.equal(chiamate, 3);
  });

  it("buildStacSearchBody usa l'intervallo esplicito se fornito (analisi personalizzata)", () => {
    const inizio = new Date("2026-04-01T00:00:00Z");
    const fine = new Date("2026-05-01T00:00:00Z");
    const body = buildStacSearchBody([0, 0, 1, 1], {
      datetimeRange: { inizio, fine },
    });
    assert.equal(body.datetime, `${inizio.toISOString()}/${fine.toISOString()}`);
  });

  it("filterWindowFromLatest ancora la finestra all'ultima scena, non a oggi", () => {
    // Scene ordinate desc; l'ultima utile è 40 gg fa (passaggi recenti nuvolosi).
    const mk = (giorniFa: number) => ({
      itemId: `s${giorniFa}`,
      datetime: new Date(Date.now() - giorniFa * 86400000).toISOString(),
      cloudCover: 5,
      bandHrefs: { B04: "r", B08: "n" },
    });
    const scene = [mk(40), mk(46), mk(58), mk(120)];
    // Finestra 15 gg da oggi sarebbe vuota; ancorata all'ultima (40 gg fa) tiene
    // le scene entro 15 gg da essa: 40 e 46 (58 a 18 gg e 120 escluse).
    const out = filterWindowFromLatest(scene, 15);
    assert.deepEqual(
      out.map((s) => s.itemId),
      ["s40", "s46"],
    );
    // Serie con 0/1 elementi: invariata.
    assert.equal(filterWindowFromLatest([], 15).length, 0);
    assert.equal(filterWindowFromLatest([mk(40)], 15).length, 1);
  });

  it("signPlanetaryComputerHref aggiunge il SAS token e propaga gli errori", async () => {
    const okFetch = (async (url: string) => {
      assert.match(url, /\/sign\?href=/);
      return new Response(JSON.stringify({ href: "https://blob/cog.tif?sas=token" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const signed = await signPlanetaryComputerHref("https://blob/cog.tif", {
      fetchImpl: okFetch,
    });
    assert.equal(signed, "https://blob/cog.tif?sas=token");

    const badFetch = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await assert.rejects(
      signPlanetaryComputerHref("https://blob/cog.tif", { fetchImpl: badFetch }),
      /HTTP 404/,
    );
  });

  it("applySasToken appende il token gestendo query preesistenti", () => {
    assert.equal(
      applySasToken("https://blob/cog.tif", "se=X&sig=Y"),
      "https://blob/cog.tif?se=X&sig=Y",
    );
    assert.equal(
      applySasToken("https://blob/cog.tif?a=1", "se=X"),
      "https://blob/cog.tif?a=1&se=X",
    );
  });

  it("planetaryComputerToken estrae token e scadenza", async () => {
    const okFetch = (async (url: string) => {
      assert.match(url, /\/token\/sentinel-2-l2a$/);
      return new Response(
        JSON.stringify({ token: "se=Z&sig=W", "msft:expiry": "2026-06-13T12:00:00Z" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { token, scadenzaMs } = await planetaryComputerToken("sentinel-2-l2a", {
      fetchImpl: okFetch,
    });
    assert.equal(token, "se=Z&sig=W");
    assert.equal(scadenzaMs, Date.parse("2026-06-13T12:00:00Z"));
  });

  it("planetaryComputerToken riprova sui 429 e poi riesce (backoff)", async () => {
    let chiamate = 0;
    const flakyFetch = (async () => {
      chiamate++;
      if (chiamate === 1) {
        return new Response("rate", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ token: "se=ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    const { token } = await planetaryComputerToken("sentinel-2-l2a", {
      fetchImpl: flakyFetch,
      attesaBaseMs: 0,
    });
    assert.equal(token, "se=ok");
    assert.equal(chiamate, 2);
  });
});

describe("proiezione UTM", () => {
  it("zona ed EPSG corretti per Firenze (zona 32 N)", () => {
    assert.equal(utmZoneFromLon(11.25), 32);
    assert.equal(utmEpsg(11.25, 43.77), 32632);
    assert.equal(utmEpsg(11.25, -43.77), 32732); // emisfero sud
  });

  it("ancore esatte: meridiano centrale ed equatore", () => {
    // Sul meridiano centrale della zona 32 (9°E) l'easting è il falso est;
    // all'equatore il northing è 0. Verifica diretta della formula.
    const centro = lonLatToUtm(9.0, 0.0, 32632);
    assert.ok(Math.abs(centro.easting - 500000) < 1e-3);
    assert.ok(Math.abs(centro.northing) < 1e-3);
  });

  it("proietta un punto noto con accuratezza sub-metrica", () => {
    // 11.0°E, 44.0°N → EPSG:32632. Riferimento (epsg.io): 660349 E, 4873817 N.
    const { easting, northing } = lonLatToUtm(11.0, 44.0, 32632);
    assert.ok(Math.abs(easting - 660349) < 2, `easting ${easting}`);
    assert.ok(Math.abs(northing - 4873817) < 2, `northing ${northing}`);
  });

  it("il falso nord è applicato nell'emisfero sud", () => {
    const nord = lonLatToUtm(11, 1, 32632).northing;
    const sud = lonLatToUtm(11, -1, 32732).northing;
    assert.ok(sud > 9_800_000); // ~10M − distanza dall'equatore
    assert.ok(nord < 200_000);
  });

  it("utmToLonLat è l'inverso di lonLatToUtm (round-trip sub-metrico)", () => {
    for (const [lon, lat] of [
      [11.0, 44.0],
      [9.0, 0.0],
      [11.25, 43.77],
      [7.5, -33.5],
    ] as const) {
      const epsg = lat >= 0 ? 32632 : 32700 + 32;
      const { easting, northing } = lonLatToUtm(lon, lat, epsg);
      const back = utmToLonLat(easting, northing, epsg);
      assert.ok(Math.abs(back.lon - lon) < 1e-6, `lon ${back.lon} vs ${lon}`);
      assert.ok(Math.abs(back.lat - lat) < 1e-6, `lat ${back.lat} vs ${lat}`);
    }
  });
});

describe("overlay raster d'index", () => {
  it("windowToCoordinates dà 4 angoli [lng,lat] coerenti col bbox della finestra", () => {
    const centro = lonLatToUtm(11.25, 43.77, 32632);
    const win: RasterWindow = {
      epsg: 32632,
      originEasting: centro.easting - 100,
      originNorthing: centro.northing + 100,
      pixelWidth: 10,
      pixelHeight: 10,
      width: 20,
      height: 20,
    };
    const [tl, tr, br, bl] = windowToCoordinates(win);
    // Alto-sx più a ovest e più a nord; basso-dx più a est e più a sud.
    assert.ok(tl[0] < tr[0], "alto-sx più a ovest di alto-dx");
    assert.ok(tl[1] > bl[1], "alto-sx più a nord di basso-sx");
    assert.ok(br[0] > bl[0], "basso-dx più a est di basso-sx");
    assert.ok(br[1] < tr[1], "basso-dx più a sud di alto-dx");
    // Gli angoli devono cadere attorno al centro noto.
    assert.ok(Math.abs(tl[0] - 11.25) < 0.01 && Math.abs(tl[1] - 43.77) < 0.01);
  });

  it("colorFromRamp: NaN trasparente, soglie applicate in ordine", () => {
    const rampa = rampForIndex("ndvi");
    assert.equal(colorFromRamp(Number.NaN, rampa), null);
    // Valore alto → colore dell'ultima soglia raggiunta (verde scuro).
    const alto = colorFromRamp(0.95, rampa);
    assert.ok(alto && alto.g > alto.r, "vigore alto = verde");
  });

  it("indexToRgba: i pixel NaN restano trasparenti, i validi opachi", () => {
    const values = Float32Array.from([0.8, Number.NaN, 0.2, 0.6]);
    const rgba = indexToRgba(values, rampForIndex("ndvi"), 200);
    assert.equal(rgba.length, 16);
    assert.equal(rgba[3], 200); // pixel 0 valido
    assert.equal(rgba[7], 0); // pixel 1 NaN → trasparente
    assert.equal(rgba[11], 200); // pixel 2 valido
  });
});

describe("clip raster sul poligono", () => {
  // Punto reale e suo UTM, da cui deriviamo una finestra georeferenziata.
  const centroLon = 11.25;
  const centroLat = 43.77;
  const centro = lonLatToUtm(centroLon, centroLat, 32632);
  // Finestra 4×4 a 10 m/pixel centrata sul punto (40 m di lato).
  const win: RasterWindow = {
    epsg: 32632,
    originEasting: centro.easting - 20,
    originNorthing: centro.northing + 20,
    pixelWidth: 10,
    pixelHeight: 10,
    width: 4,
    height: 4,
  };

  it("maschera tutti i pixel se il poligono è altrove (→ NaN)", () => {
    const lontano: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [10.0, 42.0],
          [10.01, 42.0],
          [10.01, 42.01],
          [10.0, 42.01],
          [10.0, 42.0],
        ],
      ],
    };
    const valori = Float32Array.from({ length: 16 }, () => 0.5);
    const { masked, pixelInterni } = clipRasterToPolygon(valori, win, lontano);
    assert.equal(pixelInterni, 0);
    assert.ok(masked.every((v) => Number.isNaN(v)));
  });

  it("tiene tutti i pixel se il poligono racchiude la finestra", () => {
    // Poligono geografico ~±0.003° (≈ ±250-330 m) attorno al centro: copre
    // ampiamente la finestra da 40 m, quindi nessun pixel viene mascherato.
    const attorno: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [centroLon - 0.003, centroLat - 0.003],
          [centroLon + 0.003, centroLat - 0.003],
          [centroLon + 0.003, centroLat + 0.003],
          [centroLon - 0.003, centroLat + 0.003],
          [centroLon - 0.003, centroLat - 0.003],
        ],
      ],
    };
    const valori = Float32Array.from({ length: 16 }, () => 0.5);
    const { masked, pixelInterni } = clipRasterToPolygon(valori, win, attorno);
    assert.equal(pixelInterni, 16);
    assert.ok(masked.every((v) => v === 0.5));
  });

  it("rifiuta finestre incoerenti (valori ≠ width·height)", () => {
    const qualsiasi: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [11, 43],
          [11.1, 43],
          [11.1, 43.1],
          [11, 43.1],
          [11, 43],
        ],
      ],
    };
    assert.throws(() =>
      clipRasterToPolygon(new Float32Array(9), win, qualsiasi),
    );
  });
});
