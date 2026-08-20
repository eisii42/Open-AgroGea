import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  DEFAULT_INDEX_NODATA,
  DEFAULT_INDEX_VALUE_SCALE,
  decodeIndexRaster,
  encodeIndexRaster,
} from "../plugins/agro-tools/src/index-raster-codec";
import { AGRO_LOCAL_SCHEMA_SQL } from "../packages/agro-core/src/db/schema";
import { AgroDal } from "../packages/agro-core/src/db/dal";
import { buildTimelineScenes } from "../apps/agro-field-suite/src/modules/soil/index-timeline-store";
import type { IndicesScene } from "../plugins/agro-tools/src/stac";
import type { VegetationIndexScene } from "../packages/agro-core/src/types";

/**
 * Cache locale degli indici vegetazionali (modulo Suolo, schema v21): il codec
 * compatto del raster e il round-trip sul DAL. È ciò che rende la pipeline
 * cache-first: una scena elaborata una volta deve tornare identica dal DB,
 * altrimenti le celle ridisegnate dalla cache non coinciderebbero con quelle
 * appena calcolate. Stesso idioma degli altri test DAL: node:test, PGlite
 * in-memory, `TestDal` per esporre il costruttore protetto.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";

class TestDal extends AgroDal {
  static async create(): Promise<TestDal> {
    const db = new PGlite();
    await db.exec(AGRO_LOCAL_SCHEMA_SQL);
    return new TestDal(db, TENANT, "device-test");
  }
}

async function seedPlot(dal: TestDal): Promise<string> {
  const company = await dal.rawQuery<{ id: string }>(
    `insert into companies (id, tenant_id, business_name)
     values (gen_random_uuid(), $1, 'Company Test') returning id`,
    [TENANT],
  );
  const plot = await dal.rawQuery<{ id: string }>(
    `insert into plots_registry (id, tenant_id, company_id, user_plot_name, geometry, area_ha)
     values (gen_random_uuid(), $1, $2, 'Campo 1', '{"type":"Polygon","coordinates":[]}'::jsonb, 5)
     returning id`,
    [TENANT, company.rows[0].id],
  );
  return plot.rows[0].id;
}

/** Metadati geometrici fissi: qui interessa il payload, non la georeferenziazione. */
function rasterRow(indexName: string, valuesBase64: string) {
  return {
    index_name: indexName,
    epsg: 32632,
    origin_easting: 500_000,
    origin_northing: 4_900_000,
    pixel_width: 10,
    pixel_height: 10,
    width: 2,
    height: 2,
    value_scale: DEFAULT_INDEX_VALUE_SCALE,
    nodata_value: DEFAULT_INDEX_NODATA,
    values_base64: valuesBase64,
  };
}

describe("Modulo Suolo / codec del raster d'indice", () => {
  it("conserva i valori a 4 decimali e i NaN dei pixel mascherati", () => {
    const values = new Float32Array([0.7321, -0.4213, Number.NaN, 0]);
    const decoded = decodeIndexRaster(encodeIndexRaster(values));

    assert.equal(decoded.length, values.length);
    assert.ok(Math.abs(decoded[0] - 0.7321) < 1e-4);
    assert.ok(Math.abs(decoded[1] + 0.4213) < 1e-4);
    assert.ok(Number.isNaN(decoded[2]), "il pixel mascherato deve tornare NaN");
    assert.equal(decoded[3], 0);
  });

  it("satura fuori dall'intervallo rappresentabile invece di andare in overflow", () => {
    const decoded = decodeIndexRaster(encodeIndexRaster(new Float32Array([50, -50])));
    // 50 * 10000 non sta in Int16: si satura a 32767/-32767, mai a un valore
    // di segno opposto (che un wrap-around produrrebbe).
    assert.ok(decoded[0] > 3 && decoded[0] < 3.3);
    assert.ok(decoded[1] < -3 && decoded[1] > -3.3);
  });

  it("il payload pesa ~2 byte per pixel, non ~300 come il GeoJSON delle celle", () => {
    const pixels = 5_000; // ordine di grandezza di un appezzamento da 50 ha
    const encoded = encodeIndexRaster(new Float32Array(pixels).fill(0.5));
    // base64 = 4/3 del binario: ~13 KB invece degli ~1,5 MB delle celle.
    assert.ok(encoded.valuesBase64.length < 15_000, "payload inatteso");
  });
});

describe("Modulo Suolo / timeline del time slider", () => {
  const stacScene = (
    itemId: string,
    datetime: string,
    cloudCover = 8,
  ): IndicesScene => ({
    itemId,
    datetime,
    cloudCover,
    bandHrefs: { B04: "https://esempio/B04.tif", B08: "https://esempio/B08.tif" },
  });
  const cachedScene = (
    sceneId: string,
    capturedAt: string,
  ): VegetationIndexScene => ({
    id: `row-${sceneId}`,
    plot_id: "plot-1",
    scene_id: sceneId,
    collection: "sentinel-2-l2a",
    captured_at: capturedAt,
    cloud_cover: 3,
    valid_pixels: 100,
    index_means: { ndvi: 0.6 },
    calculated_at: capturedAt,
  });

  it("unisce cache e ricerca STAC in ordine cronologico crescente", () => {
    const timeline = buildTimelineScenes(
      [stacScene("luglio", "2026-07-01T10:00:00.000Z")],
      [cachedScene("marzo", "2026-03-01T10:00:00.000Z")],
    );
    assert.deepEqual(
      timeline.map((s) => s.sceneId),
      ["marzo", "luglio"],
    );
  });

  it("una scena in cache resta 'calcolata' e acquisisce gli asset per il ricalcolo", () => {
    const timeline = buildTimelineScenes(
      [stacScene("luglio", "2026-07-01T10:00:00.000Z")],
      [cachedScene("luglio", "2026-07-01T10:00:00.000Z")],
    );
    assert.equal(timeline.length, 1, "la stessa scena non va duplicata");
    assert.equal(timeline[0].cached, true);
    assert.ok(timeline[0].source, "gli href servono a rielaborarla con altri indici");
  });

  it("distingue le scene disponibili ma mai calcolate da quelle in cache", () => {
    const timeline = buildTimelineScenes(
      [
        stacScene("giugno", "2026-06-10T10:00:00.000Z"),
        stacScene("luglio", "2026-07-01T10:00:00.000Z"),
      ],
      [cachedScene("giugno", "2026-06-10T10:00:00.000Z")],
    );
    assert.deepEqual(
      timeline.map((s) => [s.sceneId, s.cached]),
      [
        ["giugno", true],
        ["luglio", false],
      ],
    );
  });

  it("marca come doppioni le scene dello stesso giorno più nuvolose", () => {
    const timeline = buildTimelineScenes(
      [
        stacScene("mattina", "2026-06-12T10:05:00.000Z", 22),
        stacScene("poco-dopo", "2026-06-12T10:07:00.000Z", 4),
        stacScene("altro-giorno", "2026-06-14T10:05:00.000Z", 30),
      ],
      [],
    );
    assert.deepEqual(
      timeline.map((s) => [s.sceneId, s.bestOfDay]),
      [
        ["mattina", false],
        ["poco-dopo", true],
        ["altro-giorno", true],
      ],
      "un giorno senza doppioni resta sempre 'migliore del giorno'",
    );
  });

  it("a parità di nuvolosità nel giorno vince la scena già in cache", () => {
    const timeline = buildTimelineScenes(
      [stacScene("solo-stac", "2026-06-12T10:07:00.000Z", 3)],
      [cachedScene("in-cache", "2026-06-12T10:05:00.000Z")],
    );
    // `cachedScene` ha cloud_cover 3 come la scena STAC: decide la cache.
    assert.deepEqual(
      timeline.filter((s) => s.bestOfDay).map((s) => s.sceneId),
      ["in-cache"],
    );
  });

  it("le scene di sola cache non hanno asset: non sono ricalcolabili al volo", () => {
    const timeline = buildTimelineScenes(
      [],
      [cachedScene("vecchia", "2025-09-01T10:00:00.000Z")],
    );
    assert.equal(timeline[0].cached, true);
    assert.equal(timeline[0].source, null);
  });
});

describe("Modulo Suolo / cache delle scene sul DAL", () => {
  it("salva scena e raster in modo atomico e li rilegge identici", async () => {
    const dal = await TestDal.create();
    const plotId = await seedPlot(dal);
    const values = new Float32Array([0.81, 0.42, Number.NaN, 0.15]);
    const encoded = encodeIndexRaster(values);

    await dal.saveVegetationIndexScene(
      {
        plot_id: plotId,
        scene_id: "S2A_MSIL2A_20260701",
        collection: "sentinel-2-l2a",
        captured_at: "2026-07-01T10:15:00.000Z",
        cloud_cover: 4.5,
        valid_pixels: 3,
        index_means: { ndvi: 0.46, ndre: 0.21 },
      },
      [rasterRow("ndvi", encoded.valuesBase64)],
    );

    const scenes = await dal.listVegetationIndexScenes(plotId);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].scene_id, "S2A_MSIL2A_20260701");
    assert.equal(scenes[0].cloud_cover, 4.5);
    assert.deepEqual(scenes[0].index_means, { ndvi: 0.46, ndre: 0.21 });
    // timestamptz normalizzato a stringa ISO dal row-mapping del DAL.
    assert.equal(typeof scenes[0].captured_at, "string");

    const rasters = await dal.listVegetationIndexRasters(scenes[0].id);
    assert.equal(rasters.length, 1);
    const roundTrip = decodeIndexRaster({
      valueScale: rasters[0].value_scale,
      nodataValue: rasters[0].nodata_value,
      valuesBase64: rasters[0].values_base64,
    });
    assert.ok(Math.abs(roundTrip[0] - 0.81) < 1e-4);
    assert.ok(Number.isNaN(roundTrip[2]));
  });

  it("rielaborare la stessa scena fonde le medie invece di duplicare la riga", async () => {
    const dal = await TestDal.create();
    const plotId = await seedPlot(dal);
    const base = {
      plot_id: plotId,
      scene_id: "S2A_MSIL2A_20260701",
      collection: "sentinel-2-l2a",
      captured_at: "2026-07-01T10:15:00.000Z",
      cloud_cover: 4.5,
      valid_pixels: 3,
    };
    const encoded = encodeIndexRaster(new Float32Array([0.5, 0.5, 0.5, 0.5]));

    await dal.saveVegetationIndexScene(
      { ...base, index_means: { ndvi: 0.46 } },
      [rasterRow("ndvi", encoded.valuesBase64)],
    );
    // Seconda run con un indice in più: la riga è la stessa, le medie si
    // sommano e il nuovo raster si affianca a quello già in cache.
    const salvata = await dal.saveVegetationIndexScene(
      { ...base, index_means: { ndmi: 0.12 } },
      [rasterRow("ndmi", encoded.valuesBase64)],
    );
    // Il record restituito riporta le medie FUSE, non solo quelle in ingresso.
    assert.deepEqual(salvata.index_means, { ndvi: 0.46, ndmi: 0.12 });

    const scenes = await dal.listVegetationIndexScenes(plotId);
    assert.equal(scenes.length, 1, "l'unico (plot_id, scene_id) deve deduplicare");
    assert.deepEqual(scenes[0].index_means, { ndvi: 0.46, ndmi: 0.12 });

    const rasters = await dal.listVegetationIndexRasters(scenes[0].id);
    assert.deepEqual(
      rasters.map((r) => r.index_name),
      ["ndmi", "ndvi"],
    );
    const soloNdvi = await dal.listVegetationIndexRasters(scenes[0].id, ["ndvi"]);
    assert.equal(soloNdvi.length, 1);
  });

  it("la potatura toglie le scene oltre la finestra e con esse i raster", async () => {
    const dal = await TestDal.create();
    const plotId = await seedPlot(dal);
    const encoded = encodeIndexRaster(new Float32Array([0.5]));
    const scena = async (sceneId: string, capturedAt: string) =>
      dal.saveVegetationIndexScene(
        {
          plot_id: plotId,
          scene_id: sceneId,
          collection: "sentinel-2-l2a",
          captured_at: capturedAt,
          cloud_cover: null,
          valid_pixels: 1,
          index_means: { ndvi: 0.5 },
        },
        [rasterRow("ndvi", encoded.valuesBase64)],
      );

    const vecchia = await scena("vecchia", "2023-01-10T10:00:00.000Z");
    await scena("recente", "2026-07-01T10:00:00.000Z");

    const rimosse = await dal.pruneVegetationIndexScenes({
      retentionMonths: 24,
      now: new Date("2026-07-28T00:00:00.000Z"),
    });
    assert.equal(rimosse, 1);

    const scenes = await dal.listVegetationIndexScenes(plotId);
    assert.deepEqual(
      scenes.map((s) => s.scene_id),
      ["recente"],
    );
    // I raster della scena potata seguono per FK on delete cascade.
    const orfani = await dal.listVegetationIndexRasters(vecchia.id);
    assert.equal(orfani.length, 0);
  });

  it("filtra le scene già in cache per data di acquisizione (controllo incrementale)", async () => {
    const dal = await TestDal.create();
    const plotId = await seedPlot(dal);
    const encoded = encodeIndexRaster(new Float32Array([0.5]));
    for (const [sceneId, capturedAt] of [
      ["giugno", "2026-06-01T10:00:00.000Z"],
      ["luglio", "2026-07-01T10:00:00.000Z"],
    ]) {
      await dal.saveVegetationIndexScene(
        {
          plot_id: plotId,
          scene_id: sceneId,
          collection: "sentinel-2-l2a",
          captured_at: capturedAt,
          cloud_cover: null,
          valid_pixels: 1,
          index_means: { ndvi: 0.5 },
        },
        [rasterRow("ndvi", encoded.valuesBase64)],
      );
    }

    const nuove = await dal.listVegetationIndexScenes(plotId, {
      since: "2026-06-15T00:00:00.000Z",
    });
    assert.deepEqual(
      nuove.map((s) => s.scene_id),
      ["luglio"],
    );
  });
});
