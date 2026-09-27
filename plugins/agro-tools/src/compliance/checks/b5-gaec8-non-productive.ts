import type { CheckSpec, CheckVerdict } from "../check-types";
import { resolutionFitFactor } from "../confidence";
import { resolvesFeature } from "../orthophoto";
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
 * ## Il problema, e come si risolve
 *
 * **Sentinel-2 non risolve questi elementi.** Una siepe è larga 1–3 metri, un
 * margine di campo raramente supera i 2: tutti sotto il pixel da 10 m. Ciò che
 * si leggerebbe è un pixel misto — un po' di siepe, un po' di campo, un po' di
 * strada — da cui non si contano gli elementi né se ne misura la superficie.
 *
 * La soluzione non è un algoritmo più furbo: è **un'immagine migliore**. È
 * anche ciò che fa l'Organismo Pagatore, che per la BCAA 8 usa ortofoto ad
 * altissima risoluzione e non il satellite ottico. La scheda accetta quindi
 * un'**ortofoto caricata dall'utente** (AGEA, regionale, o un volo proprio) e
 * lavora su quella:
 *
 *   * senza ortofoto → `undecidable`, dicendo che serve e perché;
 *   * con ortofoto a risoluzione insufficiente → `undecidable`, dicendo quale
 *     risoluzione servirebbe per l'elemento dichiarato;
 *   * con ortofoto adeguata → misura la quota di superficie vegetata con
 *     Excess Green e la confronta con la soglia.
 *
 * ## Il limite che resta, e che va detto
 *
 * ExG separa il verde dal non-verde: **non distingue una siepe da un'infestante
 * o da un prato**. La quota misurata è quindi un'indicazione di superficie
 * vegetata, non un conteggio di elementi caratteristici. Per questo una quota
 * sotto soglia non produce mai "non conforme": potrebbe essere un errore di
 * classificazione, e accusare su un'euristica RGB sarebbe sproporzionato.
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
    // Nessun indice satellitare: l'unica immagine che serve è l'ortofoto, e
    // non si scarica — la carica l'utente.
    indices: [],
    archiveYears: 1,
    minUsableScenes: 0,
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
    const requiredShare = parameterValue(input.parameters, "nonProductiveSharePct", 4);
    const ortho = input.orthophoto;

    // 1. Nessuna ortofoto: si dice che cosa serve, non si tenta il satellite.
    if (!ortho) {
      return {
        outcome: "undecidable",
        explanation: {
          id: "explain.b5NeedsOrthophoto",
          values: { featureWidth, requiredGsdCm: Math.round((featureWidth / 3) * 100) },
        },
        factors: [resolutionFitFactor(featureWidth, 10)],
        missing: [
          {
            what: { id: "missing.orthophoto", values: { featureWidth } },
            where: "layers",
            howToFix: {
              id: "missing.orthophotoFix",
              values: { requiredGsdCm: Math.round((featureWidth / 3) * 100) },
            },
          },
        ],
      };
    }

    const factors = [resolutionFitFactor(featureWidth, ortho.gsdM)];

    // 2. Ortofoto troppo grossolana per l'elemento dichiarato.
    if (!resolvesFeature(ortho.gsdM, featureWidth)) {
      return {
        outcome: "undecidable",
        explanation: {
          id: "explain.b5OrthophotoTooCoarse",
          values: {
            gsdCm: Math.round(ortho.gsdM * 100),
            featureWidth,
            requiredGsdCm: Math.round((featureWidth / 3) * 100),
          },
        },
        factors,
        missing: [
          {
            what: { id: "missing.orthophotoResolution", values: { gsdCm: Math.round(ortho.gsdM * 100) } },
            where: "layers",
            howToFix: {
              id: "missing.orthophotoFix",
              values: { requiredGsdCm: Math.round((featureWidth / 3) * 100) },
            },
          },
        ],
      };
    }

    // 3. Bande insufficienti per stimare il verde: l'ortofoto serve comunque
    // alla verifica visiva, ma una quota non si può calcolare.
    if (ortho.vegetatedShare == null) {
      return {
        outcome: "undecidable",
        explanation: {
          id: "explain.b5OrthophotoNoBands",
          values: { bandCount: ortho.bandCount, fileName: ortho.fileName },
        },
        factors,
        missing: [
          {
            what: { id: "missing.orthophotoBands", values: { bandCount: ortho.bandCount } },
            where: "layers",
            howToFix: { id: "missing.orthophotoBandsFix" },
          },
        ],
      };
    }

    const sharePct = ortho.vegetatedShare * 100;
    const values = {
      sharePct: Number(sharePct.toFixed(1)),
      requiredShare,
      gsdCm: Math.round(ortho.gsdM * 100),
      fileName: ortho.fileName,
      pixels: ortho.pixelsInPlot,
    };

    // Sopra soglia si può dire "conforme", ma la spiegazione porta con sé che la
    // classificazione è RGB e indicativa. Sotto soglia mai "non conforme": ExG
    // non distingue una siepe da un'infestante, e su quell'euristica non si
    // accusa nessuno.
    return sharePct >= requiredShare
      ? { outcome: "compliant", explanation: { id: "explain.b5Sufficient", values }, factors }
      : { outcome: "attention", explanation: { id: "explain.b5Insufficient", values }, factors };
  },
};
