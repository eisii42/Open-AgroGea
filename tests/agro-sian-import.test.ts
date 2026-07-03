import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Polygon } from "geojson";
import {
  abbinaAppezzamentoEsistente,
  mapSianFeature,
  numeroItaliano,
  parseCsvRows,
  risolviSuperficieHa,
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
    assert.equal(numeroItaliano("1.234,56"), 1234.56);
    assert.equal(numeroItaliano("12,5"), 12.5);
    assert.equal(numeroItaliano("10"), 10);
    assert.equal(numeroItaliano("12.34"), 12.34);
    assert.equal(numeroItaliano(""), null);
    assert.equal(numeroItaliano("abc"), null);
  });
});

describe("risolviSuperficieHa", () => {
  it("dà priorità alla superficie dichiarata in ettari", () => {
    assert.equal(risolviSuperficieHa({ SUP_HA: "2,5" }), 2.5);
  });
  it("converte un'area in m² quando manca quella in ettari", () => {
    assert.equal(risolviSuperficieHa({ AREA_MQ: "25000" }), 2.5);
  });
  it("usa l'area geodetica come ultima spiaggia", () => {
    assert.equal(risolviSuperficieHa({}, 1.2345), 1.2345);
  });
  it("ritorna 0 senza alcuna fonte", () => {
    assert.equal(risolviSuperficieHa({}), 0);
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

describe("abbinaAppezzamentoEsistente", () => {
  it("abbina per id SIAN dell'appezzamento memorizzato nei metadata", () => {
    const esistenti = [
      { id: "fisico-1", metadata: { agricultural_parcel_external_id: "7" } },
      { id: "fisico-2", metadata: { agricultural_parcel_external_id: "9" } },
    ];
    assert.equal(
      abbinaAppezzamentoEsistente({ agricultural_parcel_external_id: "9" }, esistenti),
      "fisico-2",
    );
  });

  it("ritorna null quando non c'è corrispondenza (va creato)", () => {
    assert.equal(
      abbinaAppezzamentoEsistente({ agricultural_parcel_external_id: "999" }, []),
      null,
    );
    assert.equal(
      abbinaAppezzamentoEsistente({ agricultural_parcel_external_id: null }, [
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
    // Le righe CSV alimentano mapSianFeature senza geometria.
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

  it("ritorna vuoto senza righe dati", () => {
    assert.deepEqual(parseCsvRows("solo_header"), []);
  });
});
