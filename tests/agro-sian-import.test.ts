import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Polygon } from "geojson";
import {
  matchExistingPlot,
  mapSianFeature,
  italianNumber,
  parseCsvRows,
  resolveAreaHa,
} from "../apps/agro-field-suite/src/services/gis/sian-mapping";

const QUADRATO: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [11, 43],
      [11.001, 43],
      [11.001, 43.001],
      [11, 43.001],
      [11, 43],
    ],
  ],
};

describe("numeroItaliano", () => {
  it("interpreta la virgola decimale e i separatori di migliaia", () => {
    assert.equal(italianNumber("1.234,56"), 1234.56);
    assert.equal(italianNumber("12,5"), 12.5);
    assert.equal(italianNumber("10"), 10);
    assert.equal(italianNumber("12.34"), 12.34);
    assert.equal(italianNumber(""), null);
    assert.equal(italianNumber("abc"), null);
  });
});

describe("risolviSuperficieHa", () => {
  it("dà priorità alla area dichiarata in ettari", () => {
    assert.equal(resolveAreaHa({ SUP_HA: "2,5" }), 2.5);
  });
  it("converte un'area in m² quando manca quella in ettari", () => {
    assert.equal(resolveAreaHa({ AREA_MQ: "25000" }), 2.5);
  });
  it("usa l'area geodetica come last spiaggia", () => {
    assert.equal(resolveAreaHa({}, 1.2345), 1.2345);
  });
  it("ritorna 0 senza alcuna fonte", () => {
    assert.equal(resolveAreaHa({}), 0);
  });
});

describe("mapSianFeature", () => {
  it("decodifica i codici rigidi da alias case-insensitive", () => {
    const props = {
      Cod_Isola: "12",
      COD_APP: "7",
      cod_prod: "060",
      Cod_Var: "VV",
      sup_ha: "3,1",
    };
    const out = mapSianFeature(props, QUADRATO);
    assert.equal(out.reference_parcel_external_id, "12");
    assert.equal(out.agricultural_parcel_external_id, "7");
    assert.equal(out.crop_external_code, "060");
    assert.equal(out.variety_external_code, "VV");
    assert.equal(out.superficie_ha, 3.1);
    assert.equal(out.geometria, QUADRATO);
  });

  it("normalizza i codici assenti a null", () => {
    const out = mapSianFeature({ sup_ha: "1" }, null);
    assert.equal(out.reference_parcel_external_id, null);
    assert.equal(out.crop_external_code, null);
    assert.equal(out.geometria, null);
  });
});

describe("matchExistingPlot", () => {
  it("abbina per id SIAN dell'appezzamento memorizzato nei metadata", () => {
    const esistenti = [
      { id: "fisico-1", metadata: { agricultural_parcel_external_id: "7" } },
      { id: "fisico-2", metadata: { agricultural_parcel_external_id: "9" } },
    ];
    assert.equal(
      matchExistingPlot({ agricultural_parcel_external_id: "9" }, esistenti),
      "fisico-2",
    );
  });

  it("ritorna null quando non c'è corrispondenza (va creato)", () => {
    assert.equal(
      matchExistingPlot({ agricultural_parcel_external_id: "999" }, []),
      null,
    );
    assert.equal(
      matchExistingPlot({ agricultural_parcel_external_id: null }, [
        { id: "x", metadata: { agricultural_parcel_external_id: "1" } },
      ]),
      null,
    );
  });
});

describe("parseCsvRows", () => {
  it("parsa un CSV CAA con header e separatore ;", () => {
    const csv = "COD_APP;COD_PROD;SUP_HA\n7;060;2,5\n8;061;1,0";
    const rows = parseCsvRows(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { COD_APP: "7", COD_PROD: "060", SUP_HA: "2,5" });
    // Le rows CSV alimentano mapSianFeature senza geometria.
    const mapped = mapSianFeature(rows[0], null);
    assert.equal(mapped.agricultural_parcel_external_id, "7");
    assert.equal(mapped.crop_external_code, "060");
    assert.equal(mapped.superficie_ha, 2.5);
  });

  it("gestisce celle quotate con il separatore all'interno", () => {
    const csv = 'NOME;NOTE\n"Campo A";"nota; con; separatore"';
    const rows = parseCsvRows(csv);
    assert.deepEqual(rows[0], { NOME: "Campo A", NOTE: "nota; con; separatore" });
  });

  it("ritorna vuoto senza rows dati", () => {
    assert.deepEqual(parseCsvRows("solo_header"), []);
  });
});
