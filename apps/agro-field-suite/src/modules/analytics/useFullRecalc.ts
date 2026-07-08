import { cropForPlot, useAgroStore } from "@agrogea/core";
import { useCallback, useRef, useState } from "react";
import { useDssCalculation } from "../../hooks/useDssCalculation";
import {
  type SoilOptions,
  useSoilPipeline,
} from "../../hooks/useSoilPipeline";
import { cropModuleForCrop } from "../crops";

/**
 * Orchestratore "Calcola tutto" del Command Center: per OGNI plot esegue
 * in sequenza gli indici satellitari (NDVI, pipeline STAC) e, se la crop ha un
 * module DSS, i modelli previsionali + il bilancio idrico FAO 56/66. Persiste
 * `last_ndvi_mean`, `dss_results` e `soil_water_indices` (riusa i due hook
 * esistenti) e riporta un avanzamento granulare per la barra di caricamento.
 *
 * Errori per plot non interrompono il ciclo: si registrano e si prosegue.
 */

export interface FullRecalcState {
  running: boolean;
  /** Appezzamenti totali da processare. */
  total: number;
  /** Appezzamenti completati. */
  done: number;
  /** Etichetta della fase current (field + cosa si sta calcolando). */
  label: string;
  /** Numero di errori non bloccanti incontrati. */
  errors: number;
}

const IDLE: FullRecalcState = {
  running: false,
  total: 0,
  done: 0,
  label: "",
  errors: 0,
};

// "Calcola tutto" rinfresca l'NDVI (vigore) sull'ultima scena utile: sufficiente
// per l'anomalia ΔNDVI e per i KPI; l'utente può poi approfondire dal module Suolo.
const SUOLO_OPZIONI: SoilOptions = {
  indici: ["ndvi"],
  indicePrimario: "ndvi",
  cloudCoverMax: 20,
  strategia: { tipo: "ultima" },
};

export function useFullRecalc(onDone?: () => void) {
  const soil = useSoilPipeline();
  const dss = useDssCalculation();
  const [state, setState] = useState<FullRecalcState>(IDLE);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const { plots: allPlots, crops, campaignFields } = useAgroStore.getState();
    const plots = allPlots.filter((a) => a.deleted_at == null);
    if (plots.length === 0) return;

    runningRef.current = true;
    let errors = 0;
    setState({ running: true, total: plots.length, done: 0, label: "Avvio…", errors });

    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i];
      // 1) Indici satellitari (NDVI) dell'appezzamento.
      setState((s) => ({
        ...s,
        done: i,
        label: `Indici satellitari · ${plot.user_plot_name}`,
      }));
      try {
        await soil.compute([plot], SUOLO_OPZIONI);
      } catch {
        errors++;
      }

      // 2) DSS patologici + bilancio idrico (solo se la crop ha un module).
      const module = cropModuleForCrop(
        cropForPlot(plot.id, campaignFields, crops),
      );
      if (module) {
        setState((s) => ({
          ...s,
          label: `DSS & bilancio idrico · ${plot.user_plot_name}`,
        }));
        try {
          await dss.compute([{ plot: plot, module }], {
            skipWaterBalance: false,
          });
        } catch {
          errors++;
        }
      }

      setState((s) => ({ ...s, done: i + 1, errors }));
    }

    // Pulisce gli overlay STAC iniettati nello store GeoLibre (il Command Center
    // non monta la mappa, ma evitiamo residui al ritorno alla vista mappa).
    soil.reset();
    setState((s) => ({ ...s, running: false, label: "Completato" }));
    runningRef.current = false;
    onDone?.();
  }, [soil, dss, onDone]);

  return { state, run };
}
