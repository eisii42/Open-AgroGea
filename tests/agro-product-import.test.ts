import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  csvNumber,
  detectDelimiter,
  parseCsv,
} from "../apps/agro-field-suite/src/lib/csv";
import {
  parseProductCsv,
  productCsvTemplate,
  productKey,
} from "../apps/agro-field-suite/src/modules/warehouse/product-import";

/**
 * Import CSV dell'anagrafica prodotti di magazzino: la struttura accettata, il
 * giudizio riga per riga e la difesa delle regole di categoria (PAN/UMA/NPK),
 * che il CSV non deve poter aggirare. Modulo puro, testato senza React.
 */

const HEADER = "category,name,unit,registration_number,initial_quantity,unit_cost";

describe("CSV / parser condiviso", () => {
  it("riconosce il separatore dall'intestazione (Excel italiano usa ;)", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
    assert.equal(detectDelimiter("a\tb\tc"), "\t");
    // Una sola colonna: nessun separatore, la virgola non cambia il risultato.
    assert.equal(detectDelimiter("name\nRameico"), ",");
  });

  it("ignora il BOM che Excel antepone al file", () => {
    const { rows } = parseCsv("﻿name,unit\nRameico,kg");
    assert.deepEqual(rows[0], ["name", "unit"]);
  });

  it("gestisce virgolette, separatori incorporati e a-capo", () => {
    const { rows } = parseCsv('name,notes\r\n"Rameico WG","primo, secondo"\r\n');
    assert.deepEqual(rows[1], ["Rameico WG", "primo, secondo"]);
  });

  it("con separatore ; la virgola è il decimale, con , lo è il punto", () => {
    assert.equal(csvNumber("8,40", ";"), 8.4);
    assert.equal(csvNumber("1.234,50", ";"), 1234.5);
    assert.equal(csvNumber("8.40", ","), 8.4);
    assert.equal(csvNumber("", ","), null);
    assert.ok(Number.isNaN(csvNumber("abc", ",")));
  });
});

describe("import prodotti / struttura del file", () => {
  it("senza le colonne obbligatorie il file è rifiutato in blocco", () => {
    const out = parseProductCsv("name,unit\nRameico,kg");
    assert.deepEqual(out.missingColumns, ["category"]);
    assert.equal(out.rows.length, 0);
  });

  it("importa l'anagrafica senza carico iniziale (giacenza zero)", () => {
    const out = parseProductCsv(`${HEADER}\nother,Olio idraulico,l,,,`);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].valid, true);
    assert.equal(out.rows[0].lot, null);
    assert.equal(out.rows[0].product.name, "Olio idraulico");
  });

  it("con quantità e costo produce anche il lotto di carico", () => {
    const out = parseProductCsv(
      `${HEADER},expires_at,lot_number\nphytosanitary,Rameico,kg,12345,50,8.40,2027-06-30,L-1`,
    );
    const row = out.rows[0];
    assert.equal(row.valid, true);
    assert.deepEqual(row.lot, {
      lot_number: "L-1",
      expires_at: "2027-06-30",
      initial_quantity: 50,
      unit_cost: 8.4,
    });
  });

  it("accetta gli alias italiani della categoria mantenendo il valore inglese", () => {
    const out = parseProductCsv(`${HEADER}\nagrofarmaco,Rameico,kg,12345,,`);
    assert.equal(out.rows[0].product.category, "phytosanitary");
    assert.equal(out.rows[0].valid, true);
  });

  it("porta le colonne convenzionali dentro metadata, i numeri come numeri", () => {
    const out = parseProductCsv(
      "category,name,unit,species,variety_name,min_stock\n" +
        "seed,Frumento Bologna,kg,Frumento tenero,Bologna,120",
    );
    assert.deepEqual(out.rows[0].product.metadata, {
      species: "Frumento tenero",
      variety_name: "Bologna",
      min_stock: 120,
    });
  });

  it("legge un export Excel italiano: ; come separatore e virgola decimale", () => {
    const out = parseProductCsv(
      "﻿category;name;unit;initial_quantity;unit_cost\n" +
        "fuel;Gasolio agricolo;l;2000;1,05",
    );
    assert.equal(out.delimiter, ";");
    // Manca il codice UMA: la regola di categoria vale anche qui.
    assert.equal(out.rows[0].valid, false);
    assert.equal(out.rows[0].errorKey, "warehouse.import.errorUmaRequired");
  });
});

describe("import prodotti / regole di categoria", () => {
  const rowsOf = (csv: string) => parseProductCsv(csv).rows;

  it("un agrofarmaco senza n. registrazione non entra", () => {
    const [row] = rowsOf(`${HEADER}\nphytosanitary,Rameico,kg,,10,5`);
    assert.equal(row.valid, false);
    assert.equal(row.errorKey, "warehouse.import.errorRegistrationRequired");
  });

  it("un concime senza titoli N-P-K non entra", () => {
    const [row] = rowsOf("category,name,unit,npk_n\nfertilizer,NPK,kg,15");
    assert.equal(row.valid, false);
    assert.equal(row.errorKey, "warehouse.import.errorNpk");
  });

  it("un concime con titoli fuori scala non entra", () => {
    const [row] = rowsOf(
      "category,name,unit,npk_n,npk_p,npk_k\nfertilizer,NPK,kg,150,15,15",
    );
    assert.equal(row.valid, false);
    assert.equal(row.errorKey, "warehouse.import.errorNpk");
  });

  it("categoria assente o sconosciuta: due errori distinti", () => {
    const [missing] = rowsOf(`${HEADER}\n,Rameico,kg,,,`);
    assert.equal(missing.errorKey, "warehouse.import.errorCategoryRequired");
    const [unknown] = rowsOf(`${HEADER}\nsementi-bio,Rameico,kg,,,`);
    assert.equal(unknown.errorKey, "warehouse.import.errorCategoryUnknown");
    assert.equal(unknown.errorValue, "sementi-bio");
  });

  it("nome e unità restano obbligatori", () => {
    assert.equal(
      rowsOf(`${HEADER}\nother,,kg,,,`)[0].errorKey,
      "warehouse.import.errorNameRequired",
    );
    assert.equal(
      rowsOf(`${HEADER}\nother,Olio,,,,`)[0].errorKey,
      "warehouse.import.errorUnitRequired",
    );
  });
});

describe("import prodotti / carico iniziale e doppioni", () => {
  it("un carico dichiarato a metà è un errore, non un import parziale", () => {
    const quantityOnly = parseProductCsv(`${HEADER}\nother,Olio,l,,10,`).rows[0];
    assert.equal(quantityOnly.errorKey, "warehouse.import.errorUnitCost");
    const costOnly = parseProductCsv(`${HEADER}\nother,Olio,l,,,5`).rows[0];
    assert.equal(costOnly.errorKey, "warehouse.import.errorQuantity");
  });

  it("quantità non positiva rifiutata (un carico a zero non è un carico)", () => {
    const [row] = parseProductCsv(`${HEADER}\nother,Olio,l,,0,5`).rows;
    assert.equal(row.errorKey, "warehouse.import.errorQuantity");
  });

  it("una scadenza inesistente non passa il controllo di calendario", () => {
    const csv = `${HEADER},expires_at\nother,Olio,l,,10,5,2026-02-31`;
    const [row] = parseProductCsv(csv).rows;
    assert.equal(row.errorKey, "warehouse.import.errorExpiry");
    assert.equal(row.errorValue, "2026-02-31");
  });

  it("scarta i prodotti già in magazzino e i doppioni interni al file", () => {
    const existing = new Set([productKey("other", "Olio Idraulico")]);
    const csv =
      `${HEADER}\n` +
      "other,olio idraulico,l,,,\n" + // già presente (caso ignorato)
      "other,Grasso,kg,,,\n" +
      "other,Grasso,kg,,,"; // doppione interno
    const rows = parseProductCsv(csv, existing).rows;
    assert.equal(rows[0].errorKey, "warehouse.import.errorDuplicate");
    assert.equal(rows[1].valid, true);
    assert.equal(rows[2].errorKey, "warehouse.import.errorDuplicate");
  });

  it("la numerazione delle righe punta al file, intestazione compresa", () => {
    const rows = parseProductCsv(`${HEADER}\nother,A,l,,,\nother,B,l,,,`).rows;
    assert.deepEqual(
      rows.map((r) => r.index),
      [2, 3],
    );
  });
});

describe("import prodotti / modello scaricabile", () => {
  it("il modello è un file valido e tutte le sue righe sono importabili", () => {
    const template = productCsvTemplate();
    const out = parseProductCsv(template);
    assert.deepEqual(out.missingColumns, []);
    assert.equal(out.delimiter, ";");
    assert.ok(out.rows.length >= 5, "una riga d'esempio per categoria");
    for (const row of out.rows) {
      assert.equal(
        row.valid,
        true,
        `riga ${row.index} del modello non valida: ${row.errorKey}`,
      );
    }
    // Copre tutte le categorie, così il modello documenta ogni caso.
    assert.deepEqual(
      [...new Set(out.rows.map((r) => r.product.category))].sort(),
      ["fertilizer", "fuel", "other", "phytosanitary", "seed"],
    );
    // I decimali all'italiana del modello vengono riletti come numeri.
    const phyto = out.rows.find((r) => r.product.category === "phytosanitary");
    assert.equal(phyto?.lot?.unit_cost, 8.4);
  });
});
