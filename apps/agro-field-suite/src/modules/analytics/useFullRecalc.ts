import { colturaPerAppezzamento, useAgroStore } from "@agrogea/core";
import { useCallback, useRef, useState } from "react";
import { useDssCalcolo } from "../../hooks/useDssCalculation";
import {
  type OpzioniSuolo,
  useSuoloPipeline,
} from "../../hooks/useSoilPipeline";
import { cropModulePerColtura } from "../crops";

/**
 * Orchestratore "Calcola tutto" del Command Center: per OGNI appezzamento esegue
 * in sequenza gli indici satellitari (NDVI, pipeline STAC) e, se la coltura ha un
 * modulo DSS, i modelli previsionali + il bilancio idrico FAO 56/66. Persiste
 * `last_ndvi_mean`, `dss_results` e `soil_water_indices` (riusa i due hook
 * esistenti) e riporta un avanzamento granulare per la barra di caricamento.
 *
 * Errori per appezzamento non interrompono il ciclo: si registrano e si prosegue.
 */

export interface FullRecalcState {
  running: boolean;
  /** Appezzamenti totali da processare. */
  total: number;
  /** Appezzamenti completati. */
  done: number;
  /** Etichetta della fase corrente (campo + cosa si sta calcolando). */
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
// per l'anomalia ΔNDVI e per i KPI; l'utente può poi approfondire dal modulo Suolo.
const SUOLO_OPZIONI: OpzioniSuolo = {
  indici: ["ndvi"],
  indicePrimario: "ndvi",
  cloudCoverMax: 20,
  strategia: { tipo: "ultima" },
};

export function useFullRecalc(onDone?: () => void) {
  const suolo = useSuoloPipeline();
  const dss = useDssCalcolo();
  const [state, setState] = useState<FullRecalcState>(IDLE);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const { appezzamenti, crops, campiCampagna } = useAgroStore.getState();
    const plots = appezzamenti.filter((a) => a.deleted_at == null);
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
        await suolo.calcola([plot], SUOLO_OPZIONI);
      } catch {
        errors++;
      }

      // 2) DSS patologici + bilancio idrico (solo se la coltura ha un modulo).
      const modulo = cropModulePerColtura(
        colturaPerAppezzamento(plot.id, campiCampagna, crops),
      );
      if (modulo) {
        setState((s) => ({
          ...s,
          label: `DSS & bilancio idrico · ${plot.user_plot_name}`,
        }));
        try {
          await dss.calcola([{ appezzamento: plot, modulo }], {
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
    suolo.reset();
    setState((s) => ({ ...s, running: false, label: "Completato" }));
    runningRef.current = false;
    onDone?.();
  }, [suolo, dss, onDone]);

  return { state, run };
}
