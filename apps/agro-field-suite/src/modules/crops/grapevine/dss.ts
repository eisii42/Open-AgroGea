import {
  type PhytopathologyAlert,
  threeTenRule,
  powderyMildewRisk,
} from "@agrogea/tools";
import type { DssModel } from "../types";

/**
 * DSS della vite: i due modelli patologici già implementati come motori puri in
 * `fitopatologia` (regola tre-dieci per la peronospora, finestra termica per
 * l'oidio). Qui si adatta solo la series meteo unificata alla forma attesa.
 */

const peronospora: DssModel = {
  id: "peronospora",
  name: "Peronospora",
  target: "Plasmopara viticola",
  description:
    "Regola tre-dieci (Baldacci/Goidanich): germogli ≥10 cm, T media ≥10 °C, rain ≥10 mm.",
  evaluate: (series, context): PhytopathologyAlert | null =>
    threeTenRule(
      series.map((g) => ({
        tMean: (g.tMin + g.tMax) / 2,
        rain: g.rain,
        shootLength: context?.shootLengthCm ?? 0,
      })),
    ),
};

const oidio: DssModel = {
  id: "oidio",
  name: "Oidio",
  target: "Erysiphe necator",
  description:
    "Finestra termica favorevole (20-27 °C, RH moderata) con escalation sui giorni consecutivi.",
  evaluate: (series): PhytopathologyAlert | null =>
    powderyMildewRisk(
      series.map((g) => ({ tMin: g.tMin, tMax: g.tMax, rhMean: g.rhMean })),
    ),
};

export const dssVite: DssModel[] = [peronospora, oidio];
