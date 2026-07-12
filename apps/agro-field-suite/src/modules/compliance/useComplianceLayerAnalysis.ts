import type { Plot } from "@agrogea/core";
import type { FeatureCollection } from "geojson";
import { useEffect, useState } from "react";

/**
 * Analisi spaziale (DuckDB Spatial) tra gli plots del tenant in PGlite e
 * un layer esterno selezionato nel pannello Geo-compliance. Calcola via
 * `selectByLocation` quali plots intersecano le geometrie del layer,
 * aggiornando reattivamente lo stato che alimenta i badge di allerta.
 *
 * Il motore WASM è caricato on-demand (import dinamico) per non gravare sul
 * bundle iniziale.
 */

export interface ComplianceAnalysisResult {
  loading: boolean;
  error: string | null;
  /** Id degli plots che intersecano il layer esterno selezionato. */
  appezzamentiColpiti: string[];
  /** True dopo almeno un'esecuzione conclusa (per distinguere "vuoto" da "mai"). */
  eseguita: boolean;
}

const VUOTO: ComplianceAnalysisResult = {
  loading: false,
  error: null,
  appezzamentiColpiti: [],
  eseguita: false,
};

/** FeatureCollection degli plots con `id` in properties (per il join). */
function plotsFeatureCollection(
  plots: Plot[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: plots.map((a) => ({
      type: "Feature",
      geometry: a.geometry,
      properties: { id: a.id, name: a.user_plot_name },
    })),
  };
}

export function useComplianceLayerAnalysis(
  plots: Plot[],
  layerGeojson: FeatureCollection | null,
): ComplianceAnalysisResult {
  const [status, setStatus] = useState<ComplianceAnalysisResult>(VUOTO);

  useEffect(() => {
    if (!layerGeojson || plots.length === 0) {
      setStatus(VUOTO);
      return;
    }
    let cancelled = false;
    setStatus({ ...VUOTO, loading: true });

    void (async () => {
      try {
        const { SpatialAnalysisEngine } = await import(
          "../../services/gis/SpatialAnalysisEngine"
        );
        const engine = SpatialAnalysisEngine.instance();
        await engine.registerGeoJson(
          "compliance_appezzamenti",
          plotsFeatureCollection(plots),
        );
        await engine.registerGeoJson("compliance_layer", layerGeojson);
        const res = await engine.selectByLocation({
          targetTable: "compliance_appezzamenti",
          maskTable: "compliance_layer",
          predicate: "intersects",
        });
        if (cancelled) return;
        const ids = new Set<string>();
        for (const f of res.features) {
          const id = f.properties?.id;
          if (typeof id === "string") ids.add(id);
        }
        setStatus({
          loading: false,
          error: null,
          appezzamentiColpiti: [...ids],
          eseguita: true,
        });
      } catch (err) {
        if (cancelled) return;
        setStatus({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          appezzamentiColpiti: [],
          eseguita: true,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plots, layerGeojson]);

  return status;
}
