import type { CheckSpec, CheckVerdict } from "../check-types";
import { resolutionFitFactor } from "../confidence";
import { calendarYearWindow } from "../series";
import { parameterValue } from "../runner";

/**
 * B5 — BCAA 8: superfici ed elementi caratteristici non produttivi.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 8**: quota minima di superficie agricola
 * destinata a superfici o elementi non produttivi — siepi, filari di alberi,
 * alberi isolati, margini di campo, fossi, stagni, muretti a secco — e divieto
 * di potatura di siepi e alberi nel periodo di nidificazione.
 *
 * ## Che cosa si osserva davvero: quasi nulla, ed è l'informazione utile
 *
 * **Sentinel-2 non risolve questi elementi.** Una siepe è larga 1–3 metri, un
 * albero isolato ha una chioma di 4–8 metri, un margine di campo raramente
 * supera i 2 metri: tutti sotto il pixel da 10 m. Ciò che si vedrebbe è un
 * pixel misto — un po' di siepe, un po' di campo, un po' di strada — il cui
 * valore non permette né di contare gli elementi né di misurarne la superficie.
 *
 * La scheda esiste comunque, e restituisce quasi sempre **non decidibile**. Non
 * è un fallimento: è l'informazione che serve. Un agricoltore che vede venti
 * schede tutte con un esito e questa senza capisce, senza doverlo chiedere a
 * nessuno, che per la BCAA 8 il monitoraggio satellitare ottico non basta e che
 * l'Organismo Pagatore userà **ortofoto o immagini ad altissima risoluzione**.
 * Sapere quale controllo NON si può anticipare vale quanto sapere gli altri.
 *
 * ## Che cosa farebbe la differenza
 *
 * Ortofoto AGEA (20–50 cm) o VHR commerciali (Pléiades, WorldView, 30–50 cm), su
 * cui gli elementi lineari si misurano davvero. Finché la pipeline lavora su
 * Sentinel-2, questa scheda dichiara il proprio limite invece di simulare un
 * risultato.
 */
export const b5Gaec8NonProductive: CheckSpec = {
  id: "b5_gaec8_non_productive",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 8 (superfici ed elementi non produttivi)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b5NonProductiveAreas" },
  method: { id: "method.b5NonProductiveAreas" },
  observability: "low",
  requires: {
    indices: ["ndvi"],
    archiveYears: 1,
    minUsableScenes: 4,
    declared: [],
  },
  parameters: [
    {
      id: "featureWidthM",
      defaultValue: 2,
      unit: "m",
      min: 0.5,
      max: 20,
      reference: null,
      description: { id: "parameter.featureWidthM" },
    },
    {
      id: "nonProductiveSharePct",
      defaultValue: 4,
      unit: "%",
      min: 1,
      max: 20,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 8, quota minima fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.nonProductiveSharePct" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const featureWidth = parameterValue(input.parameters, "featureWidthM", 2);
    const gsd = input.series.points[0]?.gsdM ?? 10;

    // Il confronto è esplicito e mostrato all'utente: larghezza dell'oggetto
    // contro dimensione del pixel. Non c'è nulla da elaborare, c'è da dire.
    return {
      outcome: "undecidable",
      explanation: { id: "explain.b5NotResolvable", values: { featureWidth, gsd } },
      factors: [resolutionFitFactor(featureWidth, gsd)],
      missing: [
        {
          what: {
            id: "missing.resolutionTooCoarse",
            values: { featureWidth, gsd },
          },
          where: "pipeline",
          howToFix: { id: "missing.resolutionTooCoarseFix" },
        },
      ],
    };
  },
};
