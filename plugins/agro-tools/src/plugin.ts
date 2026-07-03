import type { GeoLibreAppAPI, GeoLibrePlugin } from "@geolibre/plugins";

/**
 * Plugin GeoLibre "Indici vegetazionali AgroGea".
 *
 * v1: espone il motore di calcolo (vedi `indici.ts`) sull'app API tramite il
 * registro globale del plugin, così la futura NDVIPopup e la pipeline
 * geotiff.js/time-slider lo risolvono senza import circolari. La parte di
 * fetch COG (HTTP-Range su Sentinel-2, via Planetary Computer) si aggancia
 * qui nei prossimi incrementi.
 */

export const AGRO_INDICI_PLUGIN_ID = "agro-indici-vegetazionali";

let hostApp: GeoLibreAppAPI | null = null;

export function getAgroIndiciHost(): GeoLibreAppAPI | null {
  return hostApp;
}

export const agroIndiciPlugin: GeoLibrePlugin = {
  id: AGRO_INDICI_PLUGIN_ID,
  name: "Indici vegetazionali AgroGea",
  version: "0.1.0",
  activeByDefault: true,

  activate(app) {
    hostApp = app;
    return true;
  },

  deactivate() {
    hostApp = null;
  },
};
