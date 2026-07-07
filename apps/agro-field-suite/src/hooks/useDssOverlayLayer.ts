import type { Plot } from "@agrogea/core";
import type { CropType } from "@agrogea/tools";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
  type VectorStyleStop,
} from "@geolibre/core";
import { useEffect } from "react";
import {
  costruisciOverlayDss,
  rampaRischioDss,
  type FieldSummary,
} from "../modules/dss/dss-overlay";

/**
 * Proietta l'overlay coropletico del risk DSS nel Layer Store NATIVO di
 * GeoLibre (Modulo 3). Riusa il meccanismo data-driven già provato dalla VRA
 * (`vectorStyleMode: "categorized"`): gli appezzamenti si colorano verde/giallo/
 * rosso in base alla proprietà `livello` sintetizzata. Flusso unidirezionale,
 * mai su MapLibre direttamente, come `useFieldLayers`.
 *
 * `metadata.dssOverlay` segnala il layer alla legenda colorbar (vedi Colorbar).
 */

export const DSS_OVERLAY_LAYER_ID = "agrogea-dss-overlay";

/** Stop categorizzati verde/giallo/rosso sui tre livelli di risk DSS. */
const STOPS_DSS: VectorStyleStop[] = [
  { value: "ottimale", color: "#1a9850", label: "Ottimale" },
  { value: "allerta", color: "#fee08b", label: "Allerta" },
  { value: "critico", color: "#d73027", label: "Critico" },
];

export interface DssOverlayParams {
  appezzamenti: Plot[];
  /** Punteggio sintetico 0..1 per appezzamento (id → sintesi). */
  sintesiPerCampo: Map<string, FieldSummary>;
  /** CropType prevalente, per la calibrazione della rampa/legenda. */
  coltura: CropType;
  /** true per mostrare l'overlay; false lo rimuove dalla mappa. */
  attivo: boolean;
  /** Epoch dello stile mappa: forza la re-iniezione dopo un cambio basemap. */
  styleEpoch?: number;
}

function rimuoviLayer(): void {
  const store = useAppStore.getState();
  if (store.layers.some((l) => l.id === DSS_OVERLAY_LAYER_ID)) {
    store.removeLayer(DSS_OVERLAY_LAYER_ID);
  }
}

export function useDssOverlayLayer(params: DssOverlayParams): void {
  const { appezzamenti, sintesiPerCampo, coltura, attivo, styleEpoch = 0 } = params;

  useEffect(() => {
    if (!attivo || sintesiPerCampo.size === 0) {
      rimuoviLayer();
      return;
    }
    const rampa = rampaRischioDss(coltura);
    const geojson = costruisciOverlayDss(appezzamenti, sintesiPerCampo, rampa);
    if (geojson.features.length === 0) {
      rimuoviLayer();
      return;
    }

    const store = useAppStore.getState();
    const style = {
      ...DEFAULT_LAYER_STYLE,
      fillColor: "#1a9850",
      fillOpacity: 0.55,
      strokeColor: "#ffffff",
      strokeWidth: 0.6,
      vectorStyleMode: "categorized" as const,
      vectorStyleProperty: "livello",
      vectorStyleStops: STOPS_DSS,
    };
    if (store.layers.some((l) => l.id === DSS_OVERLAY_LAYER_ID)) {
      store.updateLayer(DSS_OVERLAY_LAYER_ID, { geojson, style, visible: true });
      return;
    }
    const layer: GeoLibreLayer = {
      id: DSS_OVERLAY_LAYER_ID,
      name: "Rischio DSS",
      type: "geojson",
      source: { type: "geojson" },
      visible: true,
      opacity: 1,
      style,
      metadata: { agrogea: true, dssOverlay: true, coltura },
      geojson,
      sourcePath: `agrogea://${DSS_OVERLAY_LAYER_ID}`,
    };
    store.addLayer(layer);
  }, [appezzamenti, sintesiPerCampo, coltura, attivo, styleEpoch]);
}
