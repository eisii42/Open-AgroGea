import {
  buildPlotAlerts,
  loadOperatorMemory,
  type PlotAlert,
  useAgroStore,
} from "@agrogea/core";
import { useMemo } from "react";
import { useTenantCountry } from "./useTenantCountry";

/**
 * Segnali di attenzione degli appezzamenti (lavoro previsto, dati mancanti),
 * calcolati dai dati dell'azienda attiva. Condiviso fra i simboli sulla mappa
 * (`PlotAlertMarkers`) e il tooltip dell'appezzamento, così i due dicono
 * sempre la stessa cosa.
 */
export function usePlotAlerts(): PlotAlert[] {
  const plots = useAgroStore((s) => s.plots);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);
  const treatments = useAgroStore((s) => s.treatments);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const { countryCode } = useTenantCountry();
  const operatorMemory = useMemo(loadOperatorMemory, []);

  return useMemo(
    () =>
      buildPlotAlerts({
        plots,
        plannedTasks,
        recipes,
        treatments,
        campaignFields,
        countryCode,
        operatorName: operatorMemory.name ?? null,
        operatorLicenseNumber: operatorMemory.license ?? null,
      }),
    [
      plots,
      plannedTasks,
      recipes,
      treatments,
      campaignFields,
      countryCode,
      operatorMemory,
    ],
  );
}
