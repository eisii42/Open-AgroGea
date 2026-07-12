import type { Plot } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { FeatureCollection, Geometry } from "geojson";
import { useCallback } from "react";
import type { ComplianceTreatment } from "@agrogea/ui";
import {
  totalNitrogenMax,
  type LayerCompliance,
  type ComplianceResult,
  type ConstraintType,
  checkCompliance,
} from "./geo-compliance";

const TAG_VALIDI: ConstraintType[] = ["zvn", "sic", "zps", "eudr"];

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
      out.push({ type: tag as ConstraintType, fc: layer.geojson as FeatureCollection });
    }
  }
  return out;
}

/**
 * Valuta i vincoli geografici completi (ZVN/SIC/ZPS/EUDR) di una geometria.
 * Restituisce null se non ci sono layer di compliance caricati.
 */
export function useComplianceConstraints() {
  const complianceLayers = useComplianceLayers();
  return useCallback(
    (geometria: Geometry): ComplianceResult | null => {
      if (complianceLayers.length === 0) return null;
      if (geometria.type !== "Polygon" && geometria.type !== "MultiPolygon") {
        return null;
      }
      return checkCompliance(geometria, complianceLayers);
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
    (plot: Plot): ComplianceTreatment | null => {
      if (complianceLayers.length === 0) return null;

      const outcome = checkCompliance(plot.geometry, complianceLayers);
      if (outcome.constraints.length === 0) return null;

      // Superficie autorevole: area geodetica del DAL.
      const area = plot.area_ha;
      return {
        note: outcome.note,
        azotoMaxTotaleKg: totalNitrogenMax(area, outcome.azotoMaxKgHa),
      };
    },
    [complianceLayers],
  );
}
