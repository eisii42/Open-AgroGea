import type { Plot } from "@agrogea/core";
import type { FeatureCollection } from "geojson";
import { useEffect, useState } from "react";

/**
 * Analisi spaziale (DuckDB Spatial) tra gli appezzamenti del tenant in PGlite e
 * un layer esterno selezionato nel pannello Geo-compliance. Calcola via
 * `selectByLocation` quali appezzamenti intersecano le geometrie del layer,
 * aggiornando reattivamente lo stato che alimenta i badge di allerta.
 *
 * Il motore WASM è caricato on-demand (import dinamico) per non gravare sul
 * bundle iniziale.
 */

export interface ComplianceAnalysisResult {
  loading: boolean;
  error: string | null;
  /** Id degli appezzamenti che intersecano il layer esterno selezionato. */
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

/** FeatureCollection degli appezzamenti con `id` in properties (per il join). */
function appezzamentiFeatureCollection(
  appezzamenti: Plot[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: appezzamenti.map((a) => ({
      type: "Feature",
      geometry: a.geometry,
      properties: { id: a.id, nome: a.user_plot_name },
    })),
  };
}

export function useComplianceLayerAnalysis(
  appezzamenti: Plot[],
  layerGeojson: FeatureCollection | null,
): ComplianceAnalysisResult {
  const [stato, setStato] = useState<ComplianceAnalysisResult>(VUOTO);

  useEffect(() => {
    if (!layerGeojson || appezzamenti.length === 0) {
      setStato(VUOTO);
      return;
    }
    let annullato = false;
    setStato({ ...VUOTO, loading: true });

    void (async () => {
      try {
        const { SpatialAnalysisEngine } = await import(
          "../../services/gis/SpatialAnalysisEngine"
        );
        const engine = SpatialAnalysisEngine.instance();
        await engine.registerGeoJson(
          "compliance_appezzamenti",
          appezzamentiFeatureCollection(appezzamenti),
        );
        await engine.registerGeoJson("compliance_layer", layerGeojson);
        const res = await engine.selectByLocation({
          targetTable: "compliance_appezzamenti",
          maskTable: "compliance_layer",
          predicate: "intersects",
        });
        if (annullato) return;
        const ids = new Set<string>();
        for (const f of res.features) {
          const id = f.properties?.id;
          if (typeof id === "string") ids.add(id);
        }
        setStato({
          loading: false,
          error: null,
          appezzamentiColpiti: [...ids],
          eseguita: true,
        });
      } catch (err) {
        if (annullato) return;
        setStato({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          appezzamentiColpiti: [],
          eseguita: true,
        });
      }
    })();

    return () => {
      annullato = true;
    };
  }, [appezzamenti, layerGeojson]);

  return stato;
}
