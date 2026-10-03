import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVegetationIndex } from "../plugins/agro-tools/src/indices";
import type { RasterWindow } from "../plugins/agro-tools/src/clip";
import { rasterToIndexCells } from "../plugins/agro-tools/src/index-grid";

describe("isVegetationIndex", () => {
  it("accepts every known index", () => {
    for (const id of ["ndvi", "ndre", "ndwi", "ndmi", "nbr", "savi", "msavi2"]) {
      assert.equal(isVegetationIndex(id), true, id);
    }
  });

  it("rejects prototype keys and unknown values", () => {
    for (const id of ["__proto__", "constructor", "prototype", "NDVI", "", 1, null]) {
      assert.equal(isVegetationIndex(id), false, String(id));
    }
  });

  it("keeps hostile layer names out of the cell properties", () => {
    const window: RasterWindow = {
      epsg: 32632,
      originEasting: 500000,
      originNorthing: 5000020,
      pixelWidth: 10,
      pixelHeight: 10,
      width: 1,
      height: 1,
    };
    const values = new Float32Array([0.5]);
    const cells = rasterToIndexCells(
      [
        { index: "ndvi", values },
        { index: "__proto__" as never, values },
      ],
      window,
      { primaryIndex: "ndvi", plotId: "p1" },
    );
    const props = cells.features[0]?.properties as Record<string, unknown>;
    assert.equal(props.ndvi, 0.5);
    assert.equal(Object.getPrototypeOf(props), Object.prototype);
    assert.equal(Object.hasOwn(props, "__proto__"), false);
  });
});
