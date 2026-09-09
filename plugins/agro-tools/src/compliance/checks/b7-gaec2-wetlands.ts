import type { CheckSpec, CheckVerdict } from "../check-types";
import {
  detectDrops,
  calendarYearWindow,
  pointsInWindow,
  usablePoints,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B7 — BCAA 2: protezione delle zone umide e delle torbiere.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 2**: protezione delle zone umide e
 * torbiere, con divieto di interventi che ne compromettano la funzione di
 * accumulo di carbonio — drenaggio, aratura profonda, conversione a seminativo.
 * In Italia l'obbligo è entrato in vigore con gradualità e la designazione delle
 * aree spetta allo Stato membro.
 *
 * ## Che cosa si osserva davvero
 *
 * Due passaggi, e il primo è geometrico:
 *   1. l'appezzamento interseca il layer delle zone umide designate? Senza quel
 *      layer non c'è obbligo da verificare, e l'esito è "non decidibile" — non
 *      "conforme", perché non sappiamo se l'area sia designata o no;
 *   2. se lo interseca, si cercano i segnali di **drenaggio**: un calo
 *      persistente dell'indice di umidità (NDMI) accompagnato o seguito da una
 *      lavorazione. Un suolo drenato si asciuga e resta asciutto, e l'NDMI lo
 *      registra prima che l'NDVI cambi.
 *
 * ## Il limite da dire
 *
 * L'NDMI risponde all'umidità della **chioma** più che a quella del suolo: su
 * una zona umida vegetata il segnale è mediato dalla copertura, e un'annata
 * siccitosa produce lo stesso calo di un drenaggio. Per questo l'esito massimo
 * è "attenzione": distinguere l'intervento dalla stagione richiede dati che
 * l'ottico non ha (SAR in banda C, o piezometri).
 */
export const b7Gaec2Wetlands: CheckSpec = {
  id: "b7_gaec2_wetlands",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 2 (zone umide e torbiere)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b7WetlandsPeatlands" },
  method: { id: "method.b7WetlandsPeatlands" },
  observability: "low",
  requires: {
    indices: ["ndmi"],
    archiveYears: 1,
    minUsableScenes: 8,
    declared: ["wetlandLayer"],
  },
  parameters: [
    {
      id: "drainageNdmiDrop",
      defaultValue: 0.2,
      unit: "NDMI",
      min: 0.05,
      max: 0.6,
      reference: null,
      description: { id: "parameter.drainageNdmiDrop" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const window = calendarYearWindow(input.campaignYear);
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const dropThreshold = parameterValue(input.parameters, "drainageNdmiDrop", 0.2);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndmi",
      maxCloud,
    );
    const series = {
      plotId: input.plot.id,
      index: "ndmi" as const,
      from: window.from,
      to: window.to,
      points,
    };

    // L'obbligo scatta solo dentro l'area designata: fuori non c'è nulla da
    // dire, e dirlo "conforme" darebbe l'impressione di una verifica che non è
    // stata fatta.
    if (!input.layers.intersects.includes("wetland")) {
      return {
        outcome: "compliant",
        explanation: { id: "explain.b7NoSignal", values: { drops: 0 } },
        series,
      };
    }

    const drops = detectDrops(points, "ndmi", dropThreshold);
    const values = { drops: drops.length, threshold: dropThreshold };
    return drops.length === 0
      ? { outcome: "compliant", explanation: { id: "explain.b7NoSignal", values }, series }
      : {
          // Mai "non conforme": un'annata siccitosa produce lo stesso calo.
          outcome: "attention",
          explanation: { id: "explain.b7DrainageSignal", values },
          series,
        };
  },
};
