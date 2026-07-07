import {
  type Plot,
  type WeatherReading,
  type TreatmentLog,
  useAgroStore,
} from "@agrogea/core";
import type { AgroDal, CompanyWeatherConfig, Crop } from "@agrogea/core";
import type { FaseFenologica } from "@agrogea/tools";
import type { FeatureCollection } from "geojson";
import { useCallback, useState } from "react";
import { type ParametriSuoloRisolti, SoilDataResolver } from "../modules/soil";
import {
  buildDssSeries,
  type CropModule,
  type DssOutcome,
  outcomesToDssResults,
  type DssWeatherDay,
} from "../modules/crops";
import {
  eseguiDssEngine,
  type StatoIdricoCampo,
  type VettoreRischioDss,
} from "../modules/dss/dss-engine";
import {
  apportiIrriguiDaTrattamenti,
  calcolaBilancioIdrico,
  type IndiceIdricoGiorno,
} from "../modules/dss/water-balance";
import { WeatherSyncService } from "../lib/WeatherSyncService";
import i18n from "../i18n";

/**
 * Orchestratore del ciclo on-demand "Calcola Modelli" (Modulo Meteo §4), ora
 * MULTI-APPEZZAMENTO (come la pipeline indici del modulo Suolo):
 *
 *   per ogni appezzamento target →
 *   Fetch meteo (lucchetto orario, azienda) → serie da PGlite → run DSS locale →
 *   (opz.) bilancio idrico FAO 56/66 → scrittura `dss_results`/`soil_water_indices`.
 *
 * Tutto imperativo via `getState()`: il ciclo NON sottoscrive lo store globale,
 * quindi non innesca re-render della mappa GeoLibre. Lo stato vive qui, locale
 * al pannello. Funziona offline: se il fetch fallisce, ripiega sulle letture già
 * presenti in PGlite. Il bilancio idrico è opzionale (`skipWaterBalance`): i DSS
 * patologici non lo calcolano più (è uno strumento a sé nel pannello «Acqua»).
 */

export type FaseDss = "idle" | "calcolo" | "completato" | "errore";

export interface InfoMeteoDss {
  fetched: boolean;
  inserite: number;
  fonte: string;
  motivo?: string;
}

/** Sintesi del bilancio idrico per la UI (dettaglio in `soil_water_indices`). */
export interface BilancioSintesi {
  /** Giorni di autonomia prima del primo stress nella finestra. */
  giorniAutonomia: number;
  /** Deplezione radicale dell'ultimo giorno (mm). */
  deplezione: number;
  raw: number;
  awc: number;
  inStress: boolean;
  /** Numero di giorni calcolati. */
  giorni: number;
  /** true se la serie è stata persistita in `soil_water_indices`. */
  persistito: boolean;
}

/** Esito del calcolo per UN appezzamento. */
export interface DssPlotResult {
  appezzamentoId: string;
  nome: string;
  modulo: CropModule;
  esiti: DssOutcome[];
  /** Vettori di rischio normalizzati 0..1 (patologici + idrico se calcolato). */
  vettori: VettoreRischioDss[];
  /** Sintesi del bilancio idrico (null se non calcolato/calcolabile). */
  bilancio: BilancioSintesi | null;
  /** Parametri idro-pedologici risolti (null se non calcolati). */
  suolo: ParametriSuoloRisolti | null;
  /** Serie giornaliera del bilancio idrico (vuota se non calcolata). */
  bilancioSerie: IndiceIdricoGiorno[];
  serie: DssWeatherDay[];
  meteo: InfoMeteoDss | null;
  messaggio?: string;
}

/** Plot + modulo coltura da calcolare. */
export interface DssTarget {
  appezzamento: Plot;
  modulo: CropModule;
}

export interface OpzioniCalcoloDss {
  /** Mappa custom del suolo (Tier 1) per il bilancio idrico. */
  mappaCustom?: FeatureCollection | null;
  /**
   * Salta il bilancio idrico: i DSS patologici non lo calcolano più (è stato
   * spostato nel pannello «Acqua · Bilancio idrico»). Default false.
   */
  skipWaterBalance?: boolean;
}

export interface StatoDssCalcolo {
  fase: FaseDss;
  /** Esiti per appezzamento, nell'ordine dei target. */
  risultati: DssPlotResult[];
  /** ISO del momento del calcolo (per la timeline). */
  calcolatoIl: string | null;
  messaggio?: string;
}

const STATO_INIZIALE: StatoDssCalcolo = {
  fase: "idle",
  risultati: [],
  calcolatoIl: null,
};

/** Fasi fenologiche ammesse (per validare l'override da metadata). */
const FASI_VALIDE: readonly FaseFenologica[] = [
  "iniziale",
  "sviluppo",
  "piena",
  "maturazione",
];

/** Fase fenologica dal metadata (override), default "piena" (piena stagione). */
function faseFenologica(appezzamento: Plot): FaseFenologica {
  const meta = (appezzamento.metadata ?? {}) as Record<string, unknown>;
  const fase = meta.fase;
  return typeof fase === "string" && FASI_VALIDE.includes(fase as FaseFenologica)
    ? (fase as FaseFenologica)
    : "piena";
}

/** Finestra di lettura locale di fallback (offline): ampia come quella online. */
const GIORNI_FINESTRA = 430;

/** Valore numerico finito da un metadata (string/number), altrimenti undefined. */
function numeroMeta(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Biofix dell'accumulo termico per l'appezzamento. La fonte di verità della
 * SEMINA/TRAPIANTO è il Quaderno di Campagna: si usa la data dell'ultimo evento
 * `sowing` registrato. In ordine: ultima semina/trapianto del quaderno → override
 * esplicito nei metadata (`data_inizio_gdd`/`data_semina`) → 1° gennaio dell'anno
 * corrente (convenzione per i gradi-giorno stagionali).
 */
function biofixGdd(
  appezzamento: Plot,
  trattamenti: TreatmentLog[],
): string {
  const ultimaSemina = trattamenti
    .filter((t) => t.operation_type === "sowing" && t.executed_at)
    .sort((a, b) => b.executed_at.localeCompare(a.executed_at))[0];
  if (ultimaSemina) return ultimaSemina.executed_at.slice(0, 10);

  const meta = (appezzamento.metadata ?? {}) as Record<string, unknown>;
  const override = meta.data_inizio_gdd ?? meta.data_semina;
  if (typeof override === "string" && /^\d{4}-\d{2}-\d{2}/.test(override)) {
    return override.slice(0, 10);
  }
  return `${new Date().getUTCFullYear()}-01-01`;
}

/** Contesto azienda condiviso dal ciclo multi-plot (risolto una volta sola). */
interface ContestoCalcolo {
  dal: AgroDal;
  aziendaAttivaId: string;
  configMeteo: CompanyWeatherConfig | null;
  crops: Crop[];
}

/**
 * Esegue l'intero ciclo DSS per UN appezzamento e ritorna l'esito (nessun
 * setState: lo aggrega il chiamante). Il bilancio idrico è calcolato solo se
 * `!skipWaterBalance`.
 */
async function calcolaPlot(
  ctx: ContestoCalcolo,
  target: DssTarget,
  opzioni: OpzioniCalcoloDss,
): Promise<DssPlotResult> {
  const { dal, aziendaAttivaId, configMeteo, crops } = ctx;
  const { appezzamento, modulo } = target;
  const base: DssPlotResult = {
    appezzamentoId: appezzamento.id,
    nome: appezzamento.user_plot_name,
    modulo,
    esiti: [],
    vettori: [],
    bilancio: null,
    suolo: null,
    bilancioSerie: [],
    serie: [],
    meteo: null,
  };

  // Campagna attiva, coltura e operazioni: biofix (semina), profondità radicale
  // (tratto coltura) e apporti irrigui.
  const campi = await dal.listCampiCampagna({ appezzamentoId: appezzamento.id });
  const campagna = campi[0];
  const cropRecord = campagna
    ? crops.find((c) => c.id === campagna.crop_id) ?? null
    : null;
  const profonditaRadiciCrop = numeroMeta(
    cropRecord?.crop_metadata?.profondita_radici,
  );
  const trattamenti = await dal.listTrattamenti(aziendaAttivaId, {
    appezzamentoId: appezzamento.id,
    limit: 1000,
  });

  const biofix = biofixGdd(appezzamento, trattamenti);

  // 0) Storico stagionale (colture ad accumulo): backfill gated via Archive API.
  if (modulo.accumuloStagionale) {
    try {
      await WeatherSyncService.assicuraStoricoGdd({
        dal,
        aziendaId: aziendaAttivaId,
        appezzamentoPrincipale: appezzamento,
        dataInizio: biofix,
      });
    } catch {
      /* offline o archivio non raggiungibile: si procede col disponibile */
    }
  }

  // 1) Meteo: lucchetto orario (azienda) → fetch solo se stantio. Offline →
  //    fallback sulle letture già in PGlite.
  let serie: DssWeatherDay[];
  let meteo: InfoMeteoDss;
  let lettureRaw: WeatherReading[] = [];
  try {
    const res = await WeatherSyncService.assicuraDatiMeteo({
      dal,
      aziendaId: aziendaAttivaId,
      appezzamentoPrincipale: appezzamento,
      config: configMeteo,
    });
    lettureRaw = res.letture;
    serie = buildDssSeries(res.letture);
    meteo = {
      fetched: res.fetched,
      inserite: res.inserite,
      fonte: res.fonte,
      motivo: res.motivo,
    };
  } catch (errFetch) {
    const dopo = new Date(
      Date.now() - GIORNI_FINESTRA * 24 * 3600 * 1000,
    ).toISOString();
    const letture = await dal.listLettureMeteo(aziendaAttivaId, {
      dopo,
      limit: 30_000,
    });
    lettureRaw = letture;
    serie = buildDssSeries(letture);
    meteo = {
      fetched: false,
      inserite: 0,
      fonte: configMeteo?.data_source ?? "public_api",
      motivo:
        errFetch instanceof Error
          ? i18n.t("useDssCalcolo.offlineFallback", { error: errFetch.message })
          : i18n.t("useDssCalcolo.useLocalWeatherData"),
    };
  }

  // 2) Bilancio idrico (FAO 56/66) — solo se richiesto.
  let bilancio: BilancioSintesi | null = null;
  let bilancioSerie: IndiceIdricoGiorno[] = [];
  let statoIdrico: StatoIdricoCampo | undefined;
  let suolo: ParametriSuoloRisolti | null = null;
  if (!opzioni.skipWaterBalance && lettureRaw.length > 0) {
    const campionamenti = await dal.listCampionamenti(aziendaAttivaId);
    suolo = await new SoilDataResolver().risolvi(appezzamento, campionamenti, {
      mappaCustom: opzioni.mappaCustom,
      profonditaRadiciM: profonditaRadiciCrop,
    });
    const out = calcolaBilancioIdrico({
      letture: lettureRaw,
      irrigazioni: apportiIrriguiDaTrattamenti(trattamenti, appezzamento.area_ha),
      coltura: modulo.speciePrincipale,
      fase: faseFenologica(appezzamento),
      suolo: suolo.parametri,
      altitudine: 0,
    });
    bilancioSerie = out.serie;
    // Stato idrico CORRENTE = ultimo giorno osservato (≤ oggi). La serie include
    // ~16 giorni di PREVISIONE in coda: usarne l'ultimo (futuro) "laverebbe via"
    // l'irrigazione di oggi sotto giorni di ETc successivi. Così invece l'apporto
    // irriguo appena registrato si riflette subito su Dr corrente e autonomia.
    const oggiISO = new Date().toISOString().slice(0, 10);
    let idxOggi = -1;
    for (let i = 0; i < out.serie.length; i++) {
      if (out.serie[i].data <= oggiISO) idxOggi = i;
      else break;
    }
    const ultimo =
      idxOggi >= 0 ? out.serie[idxOggi] : out.serie[out.serie.length - 1];
    // Giorni di autonomia = giorni consecutivi senza stress dopo oggi (previsione).
    let giorniAutonomia = 0;
    if (ultimo && !ultimo.inStress) {
      for (let i = idxOggi + 1; i < out.serie.length; i++) {
        if (out.serie[i].inStress) break;
        giorniAutonomia++;
      }
    }
    if (ultimo) {
      statoIdrico = {
        deplezione: ultimo.deplezione,
        raw: ultimo.raw,
        awc: ultimo.awc,
      };
    }
    let persistito = false;
    if (campagna && out.serie.length > 0) {
      await dal.salvaIndiciIdrici(
        campagna.id,
        out.serie.map((g) => ({
          date: g.data,
          et0: g.et0,
          etc: g.etc,
          rain_mm: g.pioggia,
          irrigation_mm: g.irrigazione,
          deep_percolation_mm: g.percolazione,
          depletion_mm: g.deplezione,
          raw_mm: g.raw,
          awc_mm: g.awc,
          water_stress: g.inStress,
        })),
      );
      persistito = true;
    }
    bilancio = ultimo
      ? {
          giorniAutonomia,
          deplezione: ultimo.deplezione,
          raw: ultimo.raw,
          awc: ultimo.awc,
          inStress: ultimo.inStress,
          giorni: out.serie.length,
          persistito,
        }
      : null;
  }

  // 3) Motore DSS unificato (engine puri composti dal modulo + eventuale vettore
  //    di stress idrico). Il biofix ancora l'accumulo GDD.
  const germogli = ((appezzamento.metadata ?? {}) as Record<string, unknown>)
    .lunghezza_germogli_cm;
  const contesto = {
    dataInizioAccumuloGdd: biofix,
    ...(typeof germogli === "number" ? { lunghezzaGermogliCm: germogli } : {}),
  };
  const { esiti, vettori } = eseguiDssEngine(modulo, serie, contesto, statoIdrico);

  // 4) Persistenza cache dei modelli patologici (ultimo valore per modello).
  if (serie.length > 0) {
    await dal.salvaDssRisultati(appezzamento.id, outcomesToDssResults(esiti));
  }

  return {
    ...base,
    esiti,
    vettori,
    bilancio,
    suolo,
    bilancioSerie,
    serie,
    meteo,
    messaggio:
      serie.length === 0
        ? i18n.t("useDssCalcolo.noWeatherData")
        : undefined,
  };
}

export function useDssCalcolo() {
  const [stato, setStato] = useState<StatoDssCalcolo>(STATO_INIZIALE);

  const reset = useCallback(() => setStato(STATO_INIZIALE), []);

  const calcola = useCallback(
    async (targets: DssTarget[], opzioni: OpzioniCalcoloDss = {}) => {
      if (targets.length === 0) return;
      setStato((s) => ({ ...s, fase: "calcolo", messaggio: undefined }));
      try {
        const { dal, aziendaAttivaId, configMeteo, crops } =
          useAgroStore.getState();
        if (!dal || !aziendaAttivaId) {
          throw new Error(i18n.t("useDssCalcolo.noActiveCompany"));
        }
        const ctx: ContestoCalcolo = {
          dal,
          aziendaAttivaId,
          configMeteo,
          crops,
        };

        const risultati: DssPlotResult[] = [];
        for (const target of targets) {
          try {
            risultati.push(await calcolaPlot(ctx, target, opzioni));
          } catch (errPlot) {
            // Un errore su un campo non blocca gli altri: si registra come esito
            // vuoto con messaggio dedicato.
            risultati.push({
              appezzamentoId: target.appezzamento.id,
              nome: target.appezzamento.user_plot_name,
              modulo: target.modulo,
              esiti: [],
              vettori: [],
              bilancio: null,
              suolo: null,
              bilancioSerie: [],
              serie: [],
              meteo: null,
              messaggio:
                errPlot instanceof Error
                  ? errPlot.message
                  : i18n.t("useDssCalcolo.plotCalculationError"),
            });
          }
        }

        setStato({
          fase: "completato",
          risultati,
          calcolatoIl: new Date().toISOString(),
        });
      } catch (err) {
        setStato({
          ...STATO_INIZIALE,
          fase: "errore",
          messaggio:
            err instanceof Error ? err.message : i18n.t("useDssCalcolo.dssCalculationError"),
        });
      }
    },
    [],
  );

  return { stato, calcola, reset };
}
