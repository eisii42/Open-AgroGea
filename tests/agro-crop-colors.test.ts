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

  it("riconosce anche i nomi inglesi delle specie note", () => {
    assert.equal(cropStyle("Grapevine").icon, "grape");
    assert.equal(cropStyle("Wheat").icon, "cereal");
    assert.equal(cropStyle("Maize").icon, "corn");
    assert.equal(cropStyle("Olive").icon, "olive");
    assert.equal(cropStyle("Orange").icon, "citrus");
    assert.equal(cropStyle("Tomato").icon, "tomato");
    assert.equal(cropStyle("Apple").icon, "pome");
    assert.equal(cropStyle("Pear").icon, "pome");
    assert.equal(cropStyle("Peach").icon, "stone-fruit");
    assert.equal(cropStyle("Bean").icon, "legume");
    assert.equal(cropStyle("Pea").icon, "legume");
    assert.equal(cropStyle("Walnut").icon, "nut");
    assert.equal(cropStyle("Lavender").icon, "aromatic");
    // Un name inglese noto NON deve cadere sul fallback generico.
    assert.notEqual(cropStyle("Sunflower").icon, "generic");
  });

  it("è deterministico per crops sconosciute (stesso name → stesso colore)", () => {
    const a = cropColor("Quinoa");
    const b = cropColor("Quinoa");
    assert.equal(a, b);
    assert.equal(cropStyle("Quinoa").icon, "generic");
    assert.notEqual(a, NO_CROP_COLOR);
  });
});
