import type { Plot } from "@agrogea/core";
import {
  indexCellColorExpression,
  relativeRamp,
  type VegetationIndex,
} from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  type LayerStyle,
  useAppStore,
} from "@geolibre/core";
import type { IndexCellsResult } from "../../workers/soil.worker";

/**
 * Proiezione delle celle indice nello store GeoLibre: un layer `geojson` per
 * appezzamento, con il fill-color dato da un'espressione `interpolate` sulla
 * property `value`. Estratto dalla pipeline perché lo usano anche il time
 * slider (che sostituisce le celle a ogni scena scelta) e il pannello Suolo.
 *
 * Flusso unidirezionale rispettato: qui si scrive solo nello store, mai su
 * MapLibre — al resto pensa `MapController.syncLayers`.
 */

/** Prefisso id dei layer celle indice (uno per appezzamento). */
export const INDEX_CELLS_PREFIX = "agrogea-index-cells-";

/** Stile del layer celle: espressione `interpolate` sulla rampa relativa dell'index. */
function cellStyle(
  index: VegetationIndex,
  domain: [number, number],
): LayerStyle {
  const ramp = relativeRamp(index, domain);
  const middleColor =
    ramp[Math.floor(ramp.length / 2)]?.[1] ??
    ramp[0]?.[1] ??
    DEFAULT_LAYER_STYLE.fillColor;
  return {
    ...DEFAULT_LAYER_STYLE,
    fillColor: middleColor,
    fillOpacity: 0.85,
    strokeWidth: 0,
    vectorStyleMode: "expression",
    vectorStyleExpression: JSON.stringify(indexCellColorExpression(ramp)),
  };
}

/** Rimuove dallo store tutti i layer celle indice (prima di un nuovo calcolo). */
export function removeIndexCells(): void {
  const store = useAppStore.getState();
  for (const layer of store.layers) {
    if (layer.id.startsWith(INDEX_CELLS_PREFIX)) store.removeLayer(layer.id);
  }
}

/**
 * Inietta (o aggiorna) il layer delle celle indice dell'appezzamento, con la
 * color scale relativa al dominio corrente.
 */
export function injectIndexCells(
  plot: Plot,
  result: IndexCellsResult,
  domain: [number, number],
): void {
  const store = useAppStore.getState();
  const id = `${INDEX_CELLS_PREFIX}${plot.id}`;
  const style = cellStyle(result.index, domain);
  const metadata = {
    agrogea: true,
    overlay: true,
    indexCells: true,
    index: result.index,
    domain,
    cellSizeM: result.cellSizeM,
    datetime: result.datetime,
  };
  if (store.layers.some((l) => l.id === id)) {
    store.updateLayer(id, { geojson: result.cells, style, metadata });
    return;
  }
  const layer: GeoLibreLayer = {
    id,
    name: `Indice ${result.index.toUpperCase()} · ${plot.user_plot_name}`,
    type: "geojson",
    source: { type: "geojson" },
    geojson: result.cells,
    visible: true,
    opacity: 1,
    style,
    metadata,
    sourcePath: `agrogea://index-cells-${plot.id}`,
  };
  // Append (in cima): le celle indice restano visibili sopra il poligono.
  store.addLayer(layer);
}

/** Riallinea SOLO lo stile/dominio del layer celle di un appezzamento già iniettato. */
export function updateIndexCellsScale(
  plotId: string,
  index: VegetationIndex,
  domain: [number, number],
): void {
  const store = useAppStore.getState();
  const id = `${INDEX_CELLS_PREFIX}${plotId}`;
  const layer = store.layers.find((l) => l.id === id);
  if (!layer) return;
  store.updateLayer(id, {
    style: cellStyle(index, domain),
    metadata: { ...layer.metadata, domain },
  });
}

/**
 * Dominio colore attualmente applicato al layer di un appezzamento, se c'è.
 * Il time slider lo riusa per tutte le scene: cambiare scala a ogni data
 * farebbe apparire variazioni di colore che sono solo variazioni di scala, non
 * di vigore.
 */
export function currentIndexCellsDomain(
  plotId: string,
): [number, number] | null {
  const layer = useAppStore
    .getState()
    .layers.find((l) => l.id === `${INDEX_CELLS_PREFIX}${plotId}`);
  const domain = layer?.metadata?.domain;
  return Array.isArray(domain) && domain.length === 2
    ? (domain as [number, number])
    : null;
}
