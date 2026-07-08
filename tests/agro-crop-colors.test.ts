import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cropColor,
  cropStyle,
  NO_CROP_COLOR,
} from "../packages/agro-core/src/crop-colors";

describe("crop-colors", () => {
  it("usa il grigio neutro per plots senza coltura", () => {
    assert.equal(cropColor(null), NO_CROP_COLOR);
    assert.equal(cropColor(""), NO_CROP_COLOR);
    assert.equal(cropColor(undefined), NO_CROP_COLOR);
    assert.equal(cropStyle(null).icon, "none");
  });

  it("assegna colore/icona ad hoc alle specie note (case/accento-insensibile)", () => {
    assert.equal(cropStyle("Vite").icon, "grape");
    assert.equal(cropStyle("VIGNETO").icon, "grape");
    assert.equal(cropStyle("Olivo").icon, "olive");
    assert.equal(cropStyle("Frumento tenero").icon, "cereal");
    assert.equal(cropStyle("Mais").icon, "corn");
    assert.equal(cropStyle("Arància").icon, "citrus");
    // Specie diverse → colori diversi.
    assert.notEqual(cropColor("Vite"), cropColor("Olivo"));
  });

  it("è deterministico per crops sconosciute (stesso name → stesso colore)", () => {
    const a = cropColor("Quinoa");
    const b = cropColor("Quinoa");
    assert.equal(a, b);
    assert.equal(cropStyle("Quinoa").icon, "generic");
    assert.notEqual(a, NO_CROP_COLOR);
  });
});
