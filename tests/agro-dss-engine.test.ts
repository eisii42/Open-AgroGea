import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alertA01,
  normalizzaIndiceRischio,
  riduzioneResaFao66,
  rischioLivelloA01,
  rischioOcchioPavone,
} from "@agrogea/tools";
import { cropModuleById, type MeteoGiornoDss } from "../apps/agro-field-suite/src/modules/crops";
import {
  eseguiDssEngine,
  inStressIdrico,
  kyColtura,
  rischioIdrico01,
  vettoreStressIdrico,
} from "../apps/agro-field-suite/src/modules/dss/dss-engine";

/**
 * Espansione DSS (Modulo 2): occhio di pavone, normalizzazione del rischio
 * 0..1, riduzione di resa per stress idrico (FAO 66) e composizione del motore
 * unificato.
 */

const RAW = 100;
const AWC = 200;

describe("rischioOcchioPavone (Spilocaea oleagina)", () => {
  it("scatta con bagnatura prolungata e temperatura mite", () => {
    const serie = [
      { tMin: 12, tMax: 20, bagnaturaOre: 14 },
      { tMin: 12, tMax: 20, bagnaturaOre: 14 },
    ];
    const alert = rischioOcchioPavone(serie);
    assert.ok(alert, "atteso un alert");
    assert.ok(alert?.modello.includes("pavone"));
    assert.ok((alert?.indice ?? 0) >= 3);
  });

  it("tace senza bagnatura sufficiente o con caldo secco", () => {
    assert.equal(
      rischioOcchioPavone([{ tMin: 14, tMax: 22, bagnaturaOre: 3 }]),
      null,
    );
    assert.equal(
      rischioOcchioPavone([{ tMin: 28, tMax: 38, bagnaturaOre: 14 }]),
      null,
    );
  });

  it("escala a critico su bagnatura lunga in banda ottimale", () => {
    const alert = rischioOcchioPavone([
      { tMin: 14, tMax: 20, bagnaturaOre: 20 },
    ]);
    assert.equal(alert?.indice, 5);
    assert.equal(alert?.rischio, "alto");
  });
});

describe("normalizzazione del rischio 0..1", () => {
  it("mappa gli estremi indice 1..5", () => {
    assert.equal(normalizzaIndiceRischio(0), 0);
    assert.equal(normalizzaIndiceRischio(5), 1);
    assert.equal(normalizzaIndiceRischio(10), 1); // clamp
    assert.equal(normalizzaIndiceRischio(2.5), 0.5);
  });
  it("alertA01 vale 0 senza alert", () => {
    assert.equal(alertA01(null), 0);
    assert.equal(
      alertA01({ modello: "x", rischio: "alto", indice: 5, messaggio: "", giorno: 0 }),
      1,
    );
  });
  it("rischioLivelloA01 ordina i livelli", () => {
    assert.equal(rischioLivelloA01("nullo"), 0);
    assert.ok(
      rischioLivelloA01("basso") < rischioLivelloA01("medio") &&
        rischioLivelloA01("medio") < rischioLivelloA01("alto"),
    );
  });
});

describe("riduzioneResaFao66 (Ky)", () => {
  it("è 0 sopra RAW e cresce monotòna fino a Ky al punto di appassimento", () => {
    const ky = 1.0;
    assert.equal(riduzioneResaFao66(RAW, RAW, AWC, ky), 0); // nessuno stress
    const a = riduzioneResaFao66(130, RAW, AWC, ky);
    const b = riduzioneResaFao66(160, RAW, AWC, ky);
    assert.ok(a > 0 && b > a, "monotòna crescente sotto RAW");
    assert.ok(b <= 1, "limitata a 1");
    assert.equal(riduzioneResaFao66(AWC, RAW, AWC, ky), 1); // Ks=0 → perdita Ky
  });
});

describe("rischioIdrico01 e vettore di stress", () => {
  it("vale 0 a campo pieno, 0.5 alla soglia RAW, 1 al punto di appassimento", () => {
    assert.equal(rischioIdrico01({ deplezione: 0, raw: RAW, awc: AWC }), 0);
    assert.equal(rischioIdrico01({ deplezione: RAW, raw: RAW, awc: AWC }), 0.5);
    assert.equal(rischioIdrico01({ deplezione: AWC, raw: RAW, awc: AWC }), 1);
  });
  it("inStressIdrico true solo da RAW in su", () => {
    assert.equal(inStressIdrico({ deplezione: 99, raw: RAW, awc: AWC }), false);
    assert.equal(inStressIdrico({ deplezione: 100, raw: RAW, awc: AWC }), true);
  });
  it("vettoreStressIdrico produce un rischio01 coerente e usa Ky della coltura", () => {
    const v = vettoreStressIdrico({ deplezione: 150, raw: RAW, awc: AWC }, "mais");
    assert.equal(v.categoria, "idrico");
    assert.ok(v.rischio01 > 0.5 && v.rischio01 <= 1);
    assert.equal(kyColtura("mais"), 1.25);
  });
});

describe("eseguiDssEngine — composizione unificata", () => {
  it("unisce vettori patologici e idrico; il complessivo è il massimo", () => {
    const olivo = cropModuleById("olivo");
    assert.ok(olivo, "modulo olivo presente");
    // Serie che innesca l'occhio di pavone (bagnatura+temp mite) su più giorni.
    const serie: MeteoGiornoDss[] = Array.from({ length: 4 }, (_, i) => ({
      data: `2026-04-0${i + 1}`,
      tMin: 12,
      tMax: 20,
      rhMedia: 85,
      pioggia: 1,
      bagnaturaOre: 16,
    }));
    const out = eseguiDssEngine(olivo!, serie, undefined, {
      deplezione: 180,
      raw: RAW,
      awc: AWC,
    });
    // C'è il vettore idrico + i vettori patologici dell'olivo.
    assert.ok(out.vettori.some((v) => v.categoria === "idrico"));
    assert.ok(out.vettori.some((v) => v.categoria === "fitopatologico"));
    const maxVettori = Math.max(...out.vettori.map((v) => v.rischio01));
    assert.equal(out.rischioComplessivo01, maxVettori);
    assert.ok(out.rischioComplessivo01 > 0);
  });

  it("senza stato idrico non aggiunge il vettore idrico", () => {
    const vite = cropModuleById("vite");
    const out = eseguiDssEngine(vite!, [], undefined);
    assert.equal(out.vettori.every((v) => v.categoria === "fitopatologico"), true);
  });
});
