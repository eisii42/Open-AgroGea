import type { CheckSpec, CheckVerdict } from "../check-types";
import {
  detectDrops,
  dropsWithRecovery,
  multiYearWindow,
  pointsInWindow,
  usablePoints,
  valuesOf,
  minOf,
} from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B6 — BCAA 9: prati permanenti sensibili, divieto di conversione e aratura.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 9**: divieto di conversione o aratura
 * dei prati permanenti designati come sensibili dal punto di vista ambientale
 * nei siti Natura 2000. È una delle poche BCAA in cui la violazione è un evento
 * puntuale e irreversibile — e quindi una di quelle in cui accorgersene tardi
 * costa di più.
 *
 * ## Che cosa si osserva davvero
 *
 * La differenza fra uno **sfalcio** e una **conversione** sta tutta nella
 * ricrescita, ed è lo stesso segnale letto con due domande diverse (vedi la
 * D1, che cerca l'altra metà):
 *   * lo sfalcio toglie la biomassa e la cotica torna in poche settimane;
 *   * l'aratura porta il segnale a valori di suolo nudo e ce lo lascia, con la
 *     ripresa successiva che ha la forma di una coltura seminata, non di un
 *     prato che si riprende.
 *
 * La scheda cerca quindi i cali **senza** ricrescita che portano sotto la soglia
 * di suolo nudo, e li confronta con l'archivio pluriennale: un prato stabile ha
 * un fondo di NDVI che non scende mai sotto quella soglia, anno dopo anno.
 *
 * ## Perché serve l'archivio
 *
 * "Permanente" è una qualità che si misura nel tempo: senza almeno due annate
 * non si distingue un prato da un erbaio annuale, e la scheda dice "non
 * decidibile" invece di indovinare.
 */
export const b6Gaec9PermanentGrassland: CheckSpec = {
  id: "b6_gaec9_permanent_grassland",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 9 (prati permanenti sensibili)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b6PermanentGrassland" },
  method: { id: "method.b6PermanentGrassland" },
  observability: "high",
  requires: {
    indices: ["ndvi"],
    archiveYears: 2,
    minUsableScenes: 10,
    declared: [],
  },
  parameters: [
    {
      id: "grasslandConversionDrop",
      defaultValue: 0.3,
      unit: "NDVI",
      min: 0.1,
      max: 0.7,
      reference: null,
      description: { id: "parameter.grasslandConversionDrop" },
    },
    {
      id: "bareSoilNdvi",
      defaultValue: 0.2,
      unit: "NDVI",
      min: 0.05,
      max: 0.4,
      reference: null,
      description: { id: "parameter.bareSoilNdvi" },
    },
  ],
  window: (campaignYear) => multiYearWindow(campaignYear, 2),

  run(input): CheckVerdict {
    const window = multiYearWindow(input.campaignYear, 2);
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const conversionDrop = parameterValue(
      input.parameters,
      "grasslandConversionDrop",
      0.3,
    );
    const bareSoil = parameterValue(input.parameters, "bareSoilNdvi", 0.2);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "ndvi",
      maxCloud,
    );
    const allDrops = detectDrops(points, "ndvi", conversionDrop);
    const mowing = dropsWithRecovery(points, "ndvi", conversionDrop, 45);
    const mownDates = new Set(mowing.map((m) => m.toDate));
    // Cali profondi SENZA ricrescita, che finiscono su suolo nudo: è la firma
    // dell'aratura, non dello sfalcio.
    const conversions = allDrops.filter(
      (drop) => !mownDates.has(drop.toDate) && drop.toValue <= bareSoil,
    );

    const series = {
      plotId: input.plot.id,
      index: "ndvi" as const,
      from: window.from,
      to: window.to,
      points,
    };
    const values = {
      conversions: conversions.length,
      mowing: mowing.length,
      floor: Number(minOf(valuesOf(points, "ndvi")).toFixed(2)),
      bareSoil,
      date: conversions[0]?.toDate.slice(0, 10) ?? "",
    };

    return conversions.length === 0
      ? { outcome: "compliant", explanation: { id: "explain.b6Stable", values }, series }
      : {
          outcome: "non_compliant",
          explanation: { id: "explain.b6Converted", values },
          series,
        };
  },
};
