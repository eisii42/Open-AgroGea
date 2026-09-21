import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWmsTileUrl,
  parseWmsCapabilities,
  wmsCapabilitiesUrl,
} from "../apps/agro-field-suite/src/modules/add-data/wms";

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
