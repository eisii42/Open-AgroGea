import {
  type AlertFitopatologico,
  regolaTreDieci,
  rischioOidio,
} from "@agrogea/tools";
import type { DssModel } from "../types";

/**
 * DSS della vite: i due modelli patologici già implementati come motori puri in
 * `fitopatologia` (regola tre-dieci per la peronospora, finestra termica per
 * l'oidio). Qui si adatta solo la serie meteo unificata alla forma attesa.
 */

const peronospora: DssModel = {
  id: "peronospora",
  nome: "Peronospora",
  bersaglio: "Plasmopara viticola",
  descrizione:
    "Regola tre-dieci (Baldacci/Goidanich): germogli ≥10 cm, T media ≥10 °C, pioggia ≥10 mm.",
  valuta: (serie, contesto): AlertFitopatologico | null =>
    regolaTreDieci(
      serie.map((g) => ({
        tMedia: (g.tMin + g.tMax) / 2,
        pioggia: g.pioggia,
        lunghezzaGermogli: contesto?.lunghezzaGermogliCm ?? 0,
      })),
    ),
};

const oidio: DssModel = {
  id: "oidio",
  nome: "Oidio",
  bersaglio: "Erysiphe necator",
  descrizione:
    "Finestra termica favorevole (20-27 °C, RH moderata) con escalation sui giorni consecutivi.",
  valuta: (serie): AlertFitopatologico | null =>
    rischioOidio(
      serie.map((g) => ({ tMin: g.tMin, tMax: g.tMax, rhMedia: g.rhMedia })),
    ),
};

export const dssVite: DssModel[] = [peronospora, oidio];
