import type { Plot } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { FeatureCollection, Geometry } from "geojson";
import { useCallback } from "react";
import type { ComplianceTreatment } from "@agrogea/ui";
import {
  azotoTotaleMax,
  type LayerCompliance,
  type RisultatoCompliance,
  type TipoVincolo,
  verificaCompliance,
} from "./geo-compliance";

const TAG_VALIDI: TipoVincolo[] = ["zvn", "sic", "zps", "eudr"];

/** Layer dello store taggati come cartografia vincolante (compliance). */
function useComplianceLayers(): LayerCompliance[] {
  const layers = useAppStore((s) => s.layers);
  const out: LayerCompliance[] = [];
  for (const layer of layers) {
    const tag = layer.metadata?.compliance;
    if (
      typeof tag === "string" &&
      (TAG_VALIDI as string[]).includes(tag) &&
      layer.geojson
    ) {
      out.push({ tipo: tag as TipoVincolo, fc: layer.geojson as FeatureCollection });
    }
  }
  return out;
}

/**
 * Valuta i vincoli geografici completi (ZVN/SIC/ZPS/EUDR) di una geometria.
 * Restituisce null se non ci sono layer di compliance caricati.
 */
export function useComplianceVincoli() {
  const complianceLayers = useComplianceLayers();
  return useCallback(
    (geometria: Geometry): RisultatoCompliance | null => {
      if (complianceLayers.length === 0) return null;
      if (geometria.type !== "Polygon" && geometria.type !== "MultiPolygon") {
        return null;
      }
      return verificaCompliance(geometria, complianceLayers);
    },
    [complianceLayers],
  );
}

/**
 * Espone la valutazione di geo-compliance per il form treatments. I layer
 * vincolanti sono i layer dello store GeoLibre marcati con
 * `metadata.compliance = "zvn" | "sic" | "zps"` (caricati dall'utente come
 * cartografia regionale). Senza tali layer non c'è vincolo.
 */
export function useGeoCompliance() {
  const complianceLayers = useComplianceLayers();

  return useCallback(
    (appezzamento: Plot): ComplianceTreatment | null => {
      if (complianceLayers.length === 0) return null;

      const esito = verificaCompliance(appezzamento.geometry, complianceLayers);
      if (esito.vincoli.length === 0) return null;

      // Superficie autorevole: area geodetica del DAL.
      const superficie = appezzamento.area_ha;
      return {
        note: esito.note,
        azotoMaxTotaleKg: azotoTotaleMax(superficie, esito.azotoMaxKgHa),
      };
    },
    [complianceLayers],
  );
}
