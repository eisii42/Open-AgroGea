import type { CheckSpec, CheckVerdict } from "../check-types";
import { detectDrops, pointsInWindow, usablePoints } from "../series";
import { DEFAULT_MAX_CLOUD_PCT, parameterValue } from "../runner";

/**
 * B8 — BCAA 3: divieto di bruciatura delle stoppie.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 3**: divieto di bruciare le stoppie
 * dei seminativi, salvo deroghe per motivi fitosanitari autorizzate
 * dall'autorità competente. L'obiettivo è preservare la sostanza organica del
 * suolo.
 *
 * ## Che cosa si osserva davvero
 *
 * Il **NBR** (Normalized Burn Ratio), (NIR − SWIR2)/(NIR + SWIR2): il residuo
 * carbonioso di una combustione assorbe nel vicino infrarosso e riflette nello
 * SWIR2, e l'indice crolla in modo caratteristico — molto più di quanto faccia
 * una semplice raccolta o una lavorazione, che abbassano l'NDVI ma lasciano il
 * NBR relativamente alto.
 *
 * La finestra è **post-raccolta** (luglio–ottobre per i cereali autunno-vernini
 * italiani), perché è lì che le stoppie esistono e possono bruciare. Il segnale
 * cercato è un crollo del NBR entro poche settimane da un crollo dell'NDVI: la
 * raccolta prima, il fuoco dopo.
 *
 * ## L'estensione della pipeline che questa scheda comporta
 *
 * Il NBR richiede **B12 (SWIR2)**, che nessun altro indice del prodotto usa: la
 * pipeline scarica B03, B04, B05, B08 e B11. Attivare questa scheda aggiunge una
 * banda allo scarico di **ogni** scena — più traffico, più tempo, più cache — e
 * per questo l'indice è stato aggiunto esplicitamente a `REQUIRED_BANDS` con il
 * suo commento, invece di comparire di soppiatto.
 *
 * Se le scene in cache non portano il NBR — perché sono state elaborate prima
 * che la scheda fosse attivata — l'esito è "non decidibile" con l'indicazione
 * che serve una rielaborazione, non un silenzio.
 */
export const b8Gaec3StubbleBurning: CheckSpec = {
  id: "b8_gaec3_stubble_burning",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 3 (divieto di bruciatura delle stoppie)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b8StubbleBurning" },
  method: { id: "method.b8StubbleBurning" },
  observability: "medium",
  requires: {
    // Unica scheda che richiede B12: l'indice è dichiarato qui, e il runner
    // produce "non decidibile" se le scene in cache non lo portano.
    indices: ["nbr"],
    archiveYears: 1,
    minUsableScenes: 4,
    declared: [],
  },
  parameters: [
    {
      id: "burnNbrDrop",
      defaultValue: 0.25,
      unit: "NBR",
      min: 0.1,
      max: 0.8,
      reference: null,
      description: { id: "parameter.burnNbrDrop" },
    },
  ],
  // Finestra post-raccolta dei cereali autunno-vernini: è quando le stoppie
  // esistono. Fuori da questa finestra un crollo del NBR racconta altro.
  window: (campaignYear) => ({
    from: `${campaignYear}-06-15`,
    to: `${campaignYear}-10-31`,
  }),

  run(input): CheckVerdict {
    const window = {
      from: `${input.campaignYear}-06-15`,
      to: `${input.campaignYear}-10-31`,
    };
    const maxCloud = parameterValue(
      input.parameters,
      "cloudCoverMax",
      DEFAULT_MAX_CLOUD_PCT,
    );
    const dropThreshold = parameterValue(input.parameters, "burnNbrDrop", 0.25);

    const points = usablePoints(
      pointsInWindow(input.series, window.from, window.to),
      "nbr",
      maxCloud,
    );
    const burns = detectDrops(points, "nbr", dropThreshold);
    const series = {
      plotId: input.plot.id,
      index: "nbr" as const,
      from: window.from,
      to: window.to,
      points,
    };
    const values = {
      events: burns.length,
      threshold: dropThreshold,
      date: burns[0]?.toDate.slice(0, 10) ?? "",
    };

    return burns.length === 0
      ? { outcome: "compliant", explanation: { id: "explain.b8NoBurnSignal", values }, series }
      : {
          // Una deroga fitosanitaria autorizzata produce lo stesso segnale: è
          // l'agricoltore a sapere se ce l'ha, non noi.
          outcome: "attention",
          explanation: { id: "explain.b8BurnSignal", values },
          series,
        };
  },
};
