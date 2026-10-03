/**
 * Escape per testo inserito in markup SVG/HTML (testo e attributi tra doppi
 * apici). Da usare ogni volta che una stringa NON fidata (titoli dei servizi
 * WMS, nomi importati, testo dell'utente) finisce in un punto che la
 * interpreta come HTML.
 */
export function escapeMarkup(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1] === "x" || code[1] === "X"
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function hrefOf(tag: string): string | null {
  const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const href = decodeEntities((match?.[1] ?? match?.[2] ?? "").trim());
  return /^https?:\/\//i.test(href) ? href : null;
}

/**
 * Riduce un'attribuzione HTML a testo più link `http(s)`: ogni altro tag e
 * attributo sparisce, il testo viene ri-escapato. Serve perché MapLibre 5.x
 * inserisce l'attribuzione con innerHTML e il suo sanitizer è aggirabile
 * (CVE-2026-85061). Idempotente: riapplicarla non cambia il risultato.
 */
export function sanitizeAttribution(html: string): string {
  const out: string[] = [];
  let anchorOpen = false;
  let last = 0;
  for (const match of html.matchAll(/<[^<>]*>/g)) {
    out.push(escapeMarkup(decodeEntities(html.slice(last, match.index))));
    last = match.index + match[0].length;
    const tag = match[0];
    if (/^<a[\s>]/i.test(tag)) {
      if (anchorOpen) out.push("</a>");
      const href = hrefOf(tag);
      anchorOpen = href !== null;
      if (href) {
        out.push(`<a href="${escapeMarkup(href)}" target="_blank" rel="noopener noreferrer">`);
      }
    } else if (/^<\/a\s*>/i.test(tag) && anchorOpen) {
      out.push("</a>");
      anchorOpen = false;
    }
  }
  out.push(escapeMarkup(decodeEntities(html.slice(last))));
  if (anchorOpen) out.push("</a>");
  return out.join("");
}
