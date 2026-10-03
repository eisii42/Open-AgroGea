import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeMarkup,
  sanitizeAttribution,
} from "../apps/agro-field-suite/src/lib/escape-markup";

describe("escapeMarkup", () => {
  it("turns a hostile WMS service title into inert attribution text", () => {
    // Payload della CVE-2026-85061 (bypass del sanitizer di MapLibre 5.x).
    const title = '<details open onload="1" ontoggle="alert(1)">Ortofoto';
    const out = escapeMarkup(`${title} — WMS`);
    assert.ok(!out.includes("<"));
    assert.equal(
      out,
      "&lt;details open onload=&quot;1&quot; ontoggle=&quot;alert(1)&quot;&gt;Ortofoto — WMS",
    );
  });

  it("leaves plain attributions readable", () => {
    assert.equal(
      escapeMarkup("Catasto © Agenzia delle Entrate"),
      "Catasto © Agenzia delle Entrate",
    );
    assert.equal(escapeMarkup("AGEA & Regione"), "AGEA &amp; Regione");
  });
});

describe("sanitizeAttribution", () => {
  const OPENFREEMAP =
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

  it("keeps http(s) links and text of a real style attribution", () => {
    assert.equal(
      sanitizeAttribution(OPENFREEMAP),
      '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
        '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> ' +
        'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    );
  });

  it("drops the CVE-2026-85061 payload and any event handler", () => {
    const out = sanitizeAttribution(
      '<details open onload="1" ontoggle="alert(1)">x</details>' +
        '<a href="https://ok.example" onclick="alert(2)">ok</a>',
    );
    assert.ok(!/on\w+=/i.test(out));
    assert.ok(!out.includes("<details"));
    assert.equal(
      out,
      'x<a href="https://ok.example" target="_blank" rel="noopener noreferrer">ok</a>',
    );
  });

  it("refuses non-http links", () => {
    assert.equal(
      sanitizeAttribution('<a href="javascript:alert(1)">click</a>'),
      "click",
    );
    assert.equal(
      sanitizeAttribution("<a href='&#106;avascript:alert(1)'>x</a>"),
      "x",
    );
  });

  it("is idempotent and leaves plain text readable", () => {
    const once = sanitizeAttribution(OPENFREEMAP);
    assert.equal(sanitizeAttribution(once), once);
    assert.equal(sanitizeAttribution("AGEA & Regione < 2026"), "AGEA &amp; Regione &lt; 2026");
  });
});
