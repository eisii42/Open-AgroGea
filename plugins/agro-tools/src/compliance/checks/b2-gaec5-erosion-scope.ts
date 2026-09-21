import type { CheckSpec, CheckVerdict } from "../check-types";
import { calendarYearWindow } from "../series";
import { parameterValue } from "../runner";

/**
 * B2 — BCAA 5: gestione delle lavorazioni sui terreni in pendenza.
 *
 * ## Che cosa dice la norma
 *
 * Reg. (UE) 2021/2115, All. III, **BCAA 5**: gestione della lavorazione del
 * suolo per ridurre il rischio di degrado ed erosione, **tenendo conto della
 * pendenza**. La declinazione italiana condiziona o vieta certe lavorazioni
 * (in particolare il rittochino) oltre una soglia di pendenza che varia per
 * regione, e sotto quella soglia l'obbligo semplicemente non si applica.
 *
 * ## Che cosa fa questa scheda, e che cosa ha smesso di fare
 *
 * Risponde a **una sola domanda: questo appezzamento rientra o no nell'ambito
 * della BCAA 5?** La risposta viene dalla morfologia — la pendenza da modello
 * digitale del terreno — che è un dato stabile e verificabile, non
 * un'interpretazione.
 *
 * Una versione precedente cercava anche di **rilevare la lavorazione** da un
 * crollo di NDVI. È stata tolta, e vale la pena dire perché: quello che la
 * norma disciplina è la *modalità* della lavorazione (rittochino contro
 * girapoggio), e la direzione dei solchi a 10 metri di risoluzione **non è
 * osservabile**. Il segnale spettrale diceva al massimo "qui è passato
 * qualcosa", il che su un seminativo è vero praticamente sempre e non
 * distingue una lavorazione conforme da una che non lo è. Un indizio che non
 * discrimina non è un indizio: è rumore presentato come informazione, ed è
 * peggio del silenzio quando gli sta accanto un riferimento normativo.
 *
 * Resta quindi la parte che il dato regge davvero: **delimitare l'ambito**. È
 * meno di prima, ed è più utile — sapere che un corpo aziendale è sopra soglia
 * dice all'agricoltore dove deve guardare le prescrizioni regionali, senza
 * suggerirgli un verdetto che nessuno ha gli elementi per dare.
 *
 * ## Perché non produce mai "non conforme"
 *
 * Perché non osserva la condotta, solo il contesto in cui la condotta è
 * regolata. `attention` su un appezzamento in pendenza significa "qui la BCAA 5
 * si applica", non "qui è stata violata".
 */
export const b2Gaec5ErosionScope: CheckSpec = {
  id: "b2_gaec5_erosion_scope",
  group: "conditionality",
  reference: {
    act: "Reg. (UE) 2021/2115",
    provision: "All. III — BCAA 5 (lavorazioni e rischio di erosione)",
    countries: "*",
    url: null,
  },
  subject: { id: "subject.b2SlopeScope" },
  method: { id: "method.b2SlopeScope" },
  observability: "high",
  requires: {
    // Nessun indice: la pendenza viene dal DEM, non dal satellite ottico. La
    // scheda non scarica scene e non dipende dal meteo.
    indices: [],
    archiveYears: 1,
    minUsableScenes: 0,
    declared: ["terrain"],
  },
  parameters: [
    {
      id: "slopeThresholdDeg",
      defaultValue: 10,
      unit: "°",
      min: 2,
      max: 45,
      reference: {
        act: "Reg. (UE) 2021/2115",
        provision: "All. III — BCAA 5, soglia di pendenza fissata dallo Stato membro",
        countries: "*",
        url: null,
      },
      description: { id: "parameter.slopeThresholdDeg" },
    },
  ],
  window: (campaignYear) => calendarYearWindow(campaignYear),

  run(input): CheckVerdict {
    const threshold = parameterValue(input.parameters, "slopeThresholdDeg", 10);
    const terrain = input.terrain;
    // Il runner ha già fermato la scheda se il DEM manca (`declared: terrain`):
    // qui il dato c'è per costruzione.
    if (!terrain) {
      return {
        outcome: "undecidable",
        explanation: { id: "explain.undecidable" },
        missing: [
          {
            what: { id: "missing.terrain" },
            where: "layers",
            howToFix: { id: "missing.terrainFix" },
          },
        ],
      };
    }

    const values = {
      slope: Number(terrain.meanSlopeDeg.toFixed(1)),
      maxSlope: Number(terrain.maxSlopeDeg.toFixed(1)),
      threshold,
      source: terrain.source,
    };

    // Si guarda la pendenza MEDIA per l'ambito e si riporta anche la massima:
    // un appezzamento pianeggiante con un solo impluvio ripido non rientra
    // nell'obbligo, ma quel punto l'agricoltore deve poterlo vedere.
    return terrain.meanSlopeDeg >= threshold
      ? { outcome: "attention", explanation: { id: "explain.b2InScope", values } }
      : { outcome: "compliant", explanation: { id: "explain.b2NotInScope", values } };
  },
};
