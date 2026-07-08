/**
 * Print Composer — layout di stampa vettoriale (SVG) della mappa.
 *
 * Parte PURA (costruzione stringa SVG + modello legenda): testabile sotto Node.
 * La cattura dell'immagine mappa e l'export PNG/PDF avvengono nel pannello.
 */
import type { GeoLibreLayer } from "@geolibre/core";

export interface VoceLegenda {
  id: string;
  name: string;
  colore: string;
}

const COLORE_DEFAULT = "#1f6feb";

/** Colore rappresentativo di un layer per la legenda. */
function coloreLayer(layer: GeoLibreLayer): string {
  const style = layer.style as unknown as Record<string, unknown> | undefined;
  const candidato =
    (style?.fillColor as string) ||
    (style?.strokeColor as string) ||
    (style?.circleColor as string);
  return typeof candidato === "string" && candidato ? candidato : COLORE_DEFAULT;
}

/**
 * Legenda dinamica dai layer visibili: esclude basemap e gli sketch grezzi del
 * geo-editor (non sono dati da legenda). Mantiene l'ordine dei layer.
 */
export function buildLegenda(layers: GeoLibreLayer[]): VoceLegenda[] {
  return layers
    .filter((layer) => {
      if (!layer.visible) return false;
      if (layer.sourcePath?.startsWith("geoeditor://")) return false;
      if (layer.metadata?.basemap === true) return false;
      return true;
    })
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      colore: coloreLayer(layer),
    }));
}

export interface PrintOptions {
  title: string;
  note?: string;
  legenda: VoceLegenda[];
  mostraScala: boolean;
  /** Testo della scala grafica (es. "200 m"). */
  scalaTesto?: string;
  mostraNord: boolean;
  mostraLogo: boolean;
  /** Data-URL dell'immagine mappa (PNG); assente → riquadro neutro. */
  mappaDataUrl?: string | null;
  larghezza?: number;
  altezza?: number;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Compone il layout di stampa come stringa SVG (vettoriale, A4 orizzontale). */
export function buildPrintSvg(opts: PrintOptions): string {
  const W = opts.larghezza ?? 1123;
  const H = opts.altezza ?? 794;
  const margine = 24;
  const panelW = 280;
  const mapW = W - panelW - margine * 3;
  const mapX = margine;
  const mapY = 64;
  const mapH = H - mapY - margine;
  const panelX = mapX + mapW + margine;

  const mappa = opts.mappaDataUrl
    ? `<image x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" preserveAspectRatio="xMidYMid slice" href="${opts.mappaDataUrl}"/>`
    : `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="#eef2f6"/>` +
      `<text x="${mapX + mapW / 2}" y="${mapY + mapH / 2}" text-anchor="middle" font-size="14" fill="#90a0b0">Anteprima mappa non disponibile</text>`;

  // Pannello laterale: legenda, scala, nord, logo, note.
  const blocchi: string[] = [];
  let y = mapY;

  blocchi.push(
    `<text x="${panelX}" y="${y}" font-size="13" font-weight="700" fill="#1a2733">Legenda</text>`,
  );
  y += 22;
  for (const voce of opts.legenda) {
    blocchi.push(
      `<rect x="${panelX}" y="${y - 11}" width="14" height="14" rx="3" fill="${esc(voce.colore)}" stroke="#ffffff"/>`,
      `<text x="${panelX + 22}" y="${y}" font-size="12" fill="#333d47">${esc(voce.name)}</text>`,
    );
    y += 22;
  }
  if (opts.legenda.length === 0) {
    blocchi.push(
      `<text x="${panelX}" y="${y}" font-size="12" fill="#90a0b0">Nessun layer visibile</text>`,
    );
    y += 22;
  }

  y += 16;
  if (opts.mostraScala && opts.scalaTesto) {
    blocchi.push(
      `<rect x="${panelX}" y="${y - 8}" width="120" height="6" fill="#1a2733"/>`,
      `<text x="${panelX}" y="${y + 18}" font-size="11" fill="#333d47">Scala ${esc(opts.scalaTesto)}</text>`,
    );
    y += 40;
  }

  if (opts.mostraNord) {
    blocchi.push(
      `<g transform="translate(${panelX + 12}, ${y + 10})">` +
        `<polygon points="0,-16 7,10 0,4 -7,10" fill="#1a2733"/>` +
        `<text x="0" y="28" text-anchor="middle" font-size="12" font-weight="700" fill="#1a2733">N</text>` +
        `</g>`,
    );
    y += 56;
  }

  if (opts.note) {
    blocchi.push(
      `<text x="${panelX}" y="${y}" font-size="11" font-weight="700" fill="#1a2733">Note</text>`,
    );
    y += 18;
    // Spezza le note su più rows (~38 caratteri).
    for (const row of spezza(opts.note, 38)) {
      blocchi.push(
        `<text x="${panelX}" y="${y}" font-size="11" fill="#333d47">${esc(row)}</text>`,
      );
      y += 16;
    }
  }

  const logo = opts.mostraLogo
    ? `<text x="${W - margine}" y="${H - margine}" text-anchor="end" font-size="13" font-weight="800" fill="#1f8a5b">AgroGea</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<text x="${margine}" y="40" font-size="20" font-weight="800" fill="#1a2733">${esc(opts.title)}</text>` +
    mappa +
    `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="none" stroke="#cdd6df"/>` +
    blocchi.join("") +
    logo +
    `</svg>`
  );
}

/** Spezza un testo in rows di al più `max` caratteri, senza tagliare le parole. */
export function spezza(testo: string, max: number): string[] {
  const parole = testo.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let corrente = "";
  for (const parola of parole) {
    if (corrente.length + parola.length + 1 > max && corrente) {
      rows.push(corrente);
      corrente = parola;
    } else {
      corrente = corrente ? `${corrente} ${parola}` : parola;
    }
  }
  if (corrente) rows.push(corrente);
  return rows;
}
