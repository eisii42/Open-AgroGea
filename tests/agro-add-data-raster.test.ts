import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWmsTileUrl,
  parseWmsCapabilities,
  wmsAttribution,
  wmsCapabilitiesUrl,
} from "../apps/agro-field-suite/src/modules/add-data/wms";
import {
  EMPTY_WMS_BASEMAPS,
  loadWmsBasemaps,
  persistWmsBasemaps,
  removeWmsBasemap,
  savedWmsIdFromLayerId,
  upsertWmsBasemap,
  wmsBasemapLayer,
} from "../apps/agro-field-suite/src/modules/add-data/wms-basemaps";
import {
  listOrthophotos,
  registerOrthophoto,
  resetOrthophotoRegistry,
  unregisterOrthophoto,
} from "../apps/agro-field-suite/src/modules/add-data/orthophoto-registry";

/**
 * Cartografia raster da "Aggiungi dati": WMS da indirizzo.
 *
 * Il punto delicato è che un WMS **risponde comunque**. Un nome di layer
 * sbagliato o un parametro con il nome della versione sbagliata non producono
 * un errore: producono un'immagine vuota o trasparente, e l'utente vede una
 * mappa che non cambia senza sapere perché. Questi test coprono i tre modi in
 * cui succede.
 */

/** Capabilities minime ma realistiche, con il rumore dei servizi veri. */
const CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service>
    <Name>WMS</Name>
    <Title>Servizio cartografico regionale</Title>
  </Service>
  <Capability>
    <Layer>
      <Title>Cartografia di base</Title>
      <Layer queryable="1">
        <Name>ortofoto2023</Name>
        <Title>Ortofoto 2023 &amp; 2024</Title>
      </Layer>
      <Layer queryable="0">
        <Name>p:idrografia</Name>
        <Title><![CDATA[Reticolo idrografico]]></Title>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

describe("WMS / lettura delle capabilities", () => {
  it("elenca i layer con il titolo leggibile, non il nome tecnico", () => {
    const parsed = parseWmsCapabilities(CAPABILITIES);
    assert.equal(parsed.version, "1.3.0");
    assert.deepEqual(
      parsed.layers.map((l) => [l.name, l.title]),
      [
        ["ortofoto2023", "Ortofoto 2023 & 2024"],
        ["p:idrografia", "Reticolo idrografico"],
      ],
    );
  });

  it("non scambia il nome del SERVIZIO per un layer", () => {
    // `<Name>WMS</Name>` sta dentro <Service>: comparirebbe in cima all'elenco
    // e sarebbe la prima cosa che l'utente prova a caricare.
    const parsed = parseWmsCapabilities(CAPABILITIES);
    assert.ok(!parsed.layers.some((l) => l.name === "WMS"));
  });

  it("riconosce la versione 1.1.1, che cambia il nome del parametro CRS", () => {
    const parsed = parseWmsCapabilities(
      `<WMT_MS_Capabilities version="1.1.1"><Service><Name>OGC:WMS</Name></Service>` +
        `<Layer><Name>base</Name><Title>Base</Title></Layer></WMT_MS_Capabilities>`,
    );
    assert.equal(parsed.version, "1.1.1");
  });

  it("regge i namespace con prefisso", () => {
    const parsed = parseWmsCapabilities(
      `<wms:WMS_Capabilities version="1.3.0"><wms:Service><wms:Name>WMS</wms:Name></wms:Service>` +
        `<wms:Layer><wms:Name>foglia</wms:Name><wms:Title>Foglia</wms:Title></wms:Layer>` +
        `</wms:WMS_Capabilities>`,
    );
    assert.deepEqual(parsed.layers, [{ name: "foglia", title: "Foglia" }]);
  });

  it("un layer senza titolo ricade sul proprio nome", () => {
    // Meglio un nome tecnico di una voce vuota nell'elenco.
    const parsed = parseWmsCapabilities(
      `<WMS_Capabilities version="1.3.0"><Service><Name>WMS</Name></Service>` +
        `<Layer><Name>solo_nome</Name></Layer></WMS_Capabilities>`,
    );
    assert.deepEqual(parsed.layers, [{ name: "solo_nome", title: "solo_nome" }]);
  });
});

describe("WMS / attribuzione sulla mappa", () => {
  it("legge il titolo del SERVIZIO, non quello di un layer", () => {
    const parsed = parseWmsCapabilities(CAPABILITIES);
    assert.equal(parsed.serviceTitle, "Servizio cartografico regionale");
  });

  it("senza titolo del servizio resta null", () => {
    const parsed = parseWmsCapabilities(
      `<WMS_Capabilities version="1.3.0"><Service><Name>WMS</Name></Service>` +
        `<Layer><Name>a</Name><Title>A</Title></Layer></WMS_Capabilities>`,
    );
    assert.equal(parsed.serviceTitle, null);
  });

  it("cita layer e servizio che lo pubblica", () => {
    assert.equal(
      wmsAttribution(
        "Ortofoto 2023",
        { serviceTitle: "Geoportale Regionale" },
        "https://geo.example.it/wms",
      ),
      "Ortofoto 2023 — WMS Geoportale Regionale",
    );
  });

  it("se il servizio non ha titolo cita l'host", () => {
    // Una fonte anonima non è un'attribuzione: l'host almeno dice di chi è.
    assert.equal(
      wmsAttribution("Ortofoto", { serviceTitle: null }, "https://geo.example.it/wms?map=x"),
      "Ortofoto — WMS geo.example.it",
    );
  });
});

describe("WMS / costruzione degli URL", () => {
  it("trasforma un GetMap incollato in una GetCapabilities", () => {
    // Capita di incollare l'URL che si aveva sotto mano: i parametri di
    // richiesta vanno riscritti, non accodati.
    const url = wmsCapabilitiesUrl(
      "https://esempio.it/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=x",
    );
    assert.match(url, /REQUEST=GetCapabilities/);
    assert.ok(!url.includes("REQUEST=GetMap"));
  });

  it("conserva i parametri propri del servizio", () => {
    // Molti servizi regionali incapsulano un token o un percorso nella query.
    const url = wmsCapabilitiesUrl("https://esempio.it/wms?map=/dati/piano.map");
    assert.match(url, /map=%2Fdati%2Fpiano\.map|map=\/dati\/piano\.map/);
  });

  it("il segnaposto del bbox resta leggibile da MapLibre", () => {
    // Percent-encodato, MapLibre non lo riconosce e il layer resta vuoto.
    const tile = buildWmsTileUrl({
      baseUrl: "https://esempio.it/wms",
      layerName: "ortofoto2023",
      version: "1.3.0",
    });
    assert.ok(tile.includes("{bbox-epsg-3857}"));
    assert.ok(!tile.includes("%7Bbbox"));
  });

  it("usa CRS nella 1.3.0 e SRS nella 1.1.1", () => {
    // È l'errore che fa rispondere al server «missing parameter» in un modo
    // che nessuno collega alla versione del protocollo.
    const v130 = buildWmsTileUrl({
      baseUrl: "https://esempio.it/wms",
      layerName: "x",
      version: "1.3.0",
    });
    assert.match(v130, /[?&]CRS=EPSG%3A3857/);
    assert.ok(!/[?&]SRS=/.test(v130));

    const v111 = buildWmsTileUrl({
      baseUrl: "https://esempio.it/wms",
      layerName: "x",
      version: "1.1.1",
    });
    assert.match(v111, /[?&]SRS=EPSG%3A3857/);
    assert.ok(!/[?&]CRS=/.test(v111));
  });

  it("dichiara STYLES anche vuoto, che è obbligatorio nello standard", () => {
    // Omesso, molti server rispondono con un errore XML invece di un'immagine.
    const tile = buildWmsTileUrl({
      baseUrl: "https://esempio.it/wms",
      layerName: "x",
    });
    assert.match(tile, /[?&]STYLES=/);
    assert.match(tile, /TRANSPARENT=true/);
    assert.match(tile, /WIDTH=256/);
  });
});

describe("WMS salvati come sfondo / persistenza per azienda", () => {
  const item = {
    id: "w1",
    name: "Ortofoto 2023",
    baseUrl: "https://geo.example.it/wms",
    layerName: "ortofoto2023",
    version: "1.3.0" as const,
    attribution: "Ortofoto 2023 — WMS Geoportale",
  };

  /** Storage in memoria al posto di localStorage (assente in Node). */
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  }

  it("sopravvive alla riapertura: salvato, si rilegge uguale", () => {
    const storage = memoryStorage();
    const state = { ...upsertWmsBasemap(EMPTY_WMS_BASEMAPS, item), activeId: "w1" };
    persistWmsBasemaps("azienda-a", state, storage);
    assert.deepEqual(loadWmsBasemaps("azienda-a", storage), state);
  });

  it("è per azienda: un'altra azienda non lo vede", () => {
    const storage = memoryStorage();
    persistWmsBasemaps("azienda-a", upsertWmsBasemap(EMPTY_WMS_BASEMAPS, item), storage);
    assert.deepEqual(loadWmsBasemaps("azienda-b", storage), EMPTY_WMS_BASEMAPS);
  });

  it("un contenuto corrotto non blocca l'app", () => {
    const storage = memoryStorage();
    storage.setItem("agrogea.wmsBasemaps.azienda-a", "{non json");
    assert.deepEqual(loadWmsBasemaps("azienda-a", storage), EMPTY_WMS_BASEMAPS);
  });

  it("scarta voci incomplete e uno sfondo attivo che non esiste più", () => {
    const storage = memoryStorage();
    storage.setItem(
      "agrogea.wmsBasemaps.azienda-a",
      JSON.stringify({ items: [item, { id: "rotto" }], activeId: "sparito" }),
    );
    assert.deepEqual(loadWmsBasemaps("azienda-a", storage), {
      items: [item],
      activeId: null,
    });
  });

  it("la modifica sostituisce la voce, non ne aggiunge una", () => {
    const edited = { ...item, layerName: "ortofoto2024", name: "Ortofoto 2024" };
    const state = upsertWmsBasemap(upsertWmsBasemap(EMPTY_WMS_BASEMAPS, item), edited);
    assert.deepEqual(state.items, [edited]);
  });

  it("eliminare lo sfondo attivo azzera lo sfondo", () => {
    const state = removeWmsBasemap(
      { ...upsertWmsBasemap(EMPTY_WMS_BASEMAPS, item), activeId: "w1" },
      "w1",
    );
    assert.deepEqual(state, EMPTY_WMS_BASEMAPS);
  });

  it("il layer porta attribuzione e un id riconoscibile come sfondo WMS", () => {
    const layer = wmsBasemapLayer(item);
    assert.equal(savedWmsIdFromLayerId(layer.id), "w1");
    assert.equal(layer.type, "wms");
    assert.equal(layer.source.attribution, item.attribution);
    assert.match(String((layer.source.tiles as string[])[0]), /LAYERS=ortofoto2023/);
  });
});

describe("Ortofoto / registro di sessione", () => {
  const entry = (layerId: string, addedAt: string) => ({
    layerId,
    file: {} as File,
    gsdM: 0.2,
    addedAt,
  });

  it("due letture senza modifiche restituiscono lo STESSO elenco", () => {
    // È lo snapshot di useSyncExternalStore: un array nuovo a ogni lettura
    // manda React in loop infinito e smonta l'app all'apertura della Normativa.
    resetOrthophotoRegistry();
    registerOrthophoto(entry("a", "2026-01-01T00:00:00Z"));
    assert.equal(listOrthophotos(), listOrthophotos());
  });

  it("una modifica produce un elenco nuovo, ordinato per data", () => {
    resetOrthophotoRegistry();
    registerOrthophoto(entry("b", "2026-02-01T00:00:00Z"));
    const before = listOrthophotos();
    registerOrthophoto(entry("a", "2026-01-01T00:00:00Z"));
    const after = listOrthophotos();
    assert.notEqual(before, after);
    assert.deepEqual(after.map((o) => o.layerId), ["a", "b"]);
    unregisterOrthophoto("a");
    assert.deepEqual(listOrthophotos().map((o) => o.layerId), ["b"]);
    resetOrthophotoRegistry();
  });
});
