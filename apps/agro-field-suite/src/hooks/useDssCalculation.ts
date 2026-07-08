import {
  type Plot,
  type WeatherReading,
  type TreatmentLog,
  useAgroStore,
} from "@agrogea/core";
import type { AgroDal, CompanyWeatherConfig, Crop } from "@agrogea/core";
import type { PhenologicalPhase } from "@agrogea/tools";
import type { FeatureCollection } from "geojson";
import { useCallback, useState } from "react";
import { type ResolvedSoilParameters, SoilDataResolver } from "../modules/soil";
import {
  buildDssSeries,
  type CropModule,
  type DssOutcome,
  outcomesToDssResults,
  type DssWeatherDay,
} from "../modules/crops";
import {
  runDssEngine,
  type FieldWaterStatus,
  type VettoreRischioDss,
} from "../modules/dss/dss-engine";
import {
  irrigationInputsFromTreatments,
  computeWaterBalance,
  type WaterIndexDay,
} from "../modules/dss/water-balance";
import { WeatherSyncService } from "../lib/WeatherSyncService";
import i18n from "../i18n";

/**
 * Orchestratore del ciclo on-demand "Calcola Modelli" (Modulo Meteo §4), ora
 * MULTI-APPEZZAMENTO (come la pipeline indici del modulo Suolo):
 *
 *   per ogni plot target →
 *   Fetch meteo (lucchetto orario, company) → series da PGlite → run DSS locale →
 *   (opz.) bilancio idrico FAO 56/66 → scrittura `dss_results`/`soil_water_indices`.
 *
 * Tutto imperativo via `getState()`: il ciclo NON sottoscrive lo store globale,
 * quindi non innesca re-render della mappa GeoLibre. Lo stato vive qui, locale
 * al pannello. Funziona offline: se il fetch fallisce, ripiega sulle letture già
 * presenti in PGlite. Il bilancio idrico è opzionale (`skipWaterBalance`): i DSS
 * patologici non lo calcolano più (è uno strumento a sé nel pannello «Acqua»).
 */

export type FaseDss = "idle" | "calcolo" | "completato" | "errore";

export interface DssWeatherInfo {
  fetched: boolean;
  inserite: number;
  fonte: string;
  motivo?: string;
}

/** Sintesi del bilancio idrico per la UI (dettaglio in `soil_water_indices`). */
export interface BalanceSummary {
  /** Giorni di autonomia prima del primo stress nella finestra. */
  autonomyDays: number;
  /** Deplezione radicale dell'ultimo day (mm). */
  depletion: number;
  raw: number;
  awc: number;
  inStress: boolean;
  /** Numero di giorni calcolati. */
  giorni: number;
  /** true se la series è stata persistita in `soil_water_indices`. */
  persistito: boolean;
}

/** Esito del calcolo per UN plot. */
export interface DssPlotResult {
  plotId: string;
  name: string;
  modulo: CropModule;
  esiti: DssOutcome[];
  /** Vettori di risk normalizzati 0..1 (patologici + idrico se calcolato). */
  vettori: VettoreRischioDss[];
  /** Sintesi del bilancio idrico (null se non calcolato/calcolabile). */
  bilancio: BalanceSummary | null;
  /** Parametri idro-pedologici risolti (null se non calcolati). */
  soil: ResolvedSoilParameters | null;
  /** Serie giornaliera del bilancio idrico (vuota se non calcolata). */
  bilancioSerie: WaterIndexDay[];
  series: DssWeatherDay[];
  meteo: DssWeatherInfo | null;
  message?: string;
}

/** Plot + modulo crop da calcolare. */
export interface DssTarget {
  plot: Plot;
  modulo: CropModule;
}

export interface OpzioniCalcoloDss {
  /** Mappa custom del soil (Tier 1) per il bilancio idrico. */
  mappaCustom?: FeatureCollection | null;
  /**
   * Salta il bilancio idrico: i DSS patologici non lo calcolano più (è stato
   * spostato nel pannello «Acqua · Bilancio idrico»). Default false.
   */
  skipWaterBalance?: boolean;
}

export interface StatoDssCalcolo {
  phase: FaseDss;
  /** Esiti per plot, nell'ordine dei target. */
  risultati: DssPlotResult[];
  /** ISO del momento del calcolo (per la timeline). */
  calcolatoIl: string | null;
  message?: string;
}

const STATO_INIZIALE: StatoDssCalcolo = {
  phase: "idle",
  risultati: [],
  calcolatoIl: null,
};

/** Fasi fenologiche ammesse (per validare l'override da metadata). */
const FASI_VALIDE: readonly PhenologicalPhase[] = [
  "iniziale",
  "sviluppo",
  "piena",
  "maturazione",
];

/** Fase fenologica dal metadata (override), default "piena" (piena stagione). */
function phenologicalPhase(plot: Plot): PhenologicalPhase {
  const meta = (plot.metadata ?? {}) as Record<string, unknown>;
  const phase = meta.phase;
  return typeof phase === "string" && FASI_VALIDE.includes(phase as PhenologicalPhase)
    ? (phase as PhenologicalPhase)
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
 * `sowing` registrato. In ordine: ultima semina/trapianto del logbook → override
 * esplicito nei metadata (`data_inizio_gdd`/`data_semina`) → 1° gennaio dell'anno
 * corrente (convenzione per i gradi-day stagionali).
 */
function biofixGdd(
  plot: Plot,
  treatments: TreatmentLog[],
): string {
  const ultimaSemina = treatments
    .filter((t) => t.operation_type === "sowing" && t.executed_at)
    .sort((a, b) => b.executed_at.localeCompare(a.executed_at))[0];
  if (ultimaSemina) return ultimaSemina.executed_at.slice(0, 10);

  const meta = (plot.metadata ?? {}) as Record<string, unknown>;
  const override = meta.data_inizio_gdd ?? meta.data_semina;
  if (typeof override === "string" && /^\d{4}-\d{2}-\d{2}/.test(override)) {
    return override.slice(0, 10);
  }
  return `${new Date().getUTCFullYear()}-01-01`;
}

/** Contesto company condiviso dal ciclo multi-plot (risolto una volta sola). */
interface ContestoCalcolo {
  dal: AgroDal;
  activeCompanyId: string;
  weatherConfig: CompanyWeatherConfig | null;
  crops: Crop[];
}

/**
 * Esegue l'intero ciclo DSS per UN plot e ritorna l'esito (nessun
 * setState: lo aggrega il chiamante). Il bilancio idrico è calcolato solo se
 * `!skipWaterBalance`.
 */
async function calcolaPlot(
  ctx: ContestoCalcolo,
  target: DssTarget,
  opzioni: OpzioniCalcoloDss,
): Promise<DssPlotResult> {
  const { dal, activeCompanyId, weatherConfig, crops } = ctx;
  const { plot, modulo } = target;
  const base: DssPlotResult = {
    plotId: plot.id,
    name: plot.user_plot_name,
    modulo,
    esiti: [],
    vettori: [],
    bilancio: null,
    soil: null,
    bilancioSerie: [],
    series: [],
    meteo: null,
  };

  // Campagna attiva, crop e operazioni: biofix (semina), profondità radicale
  // (tratto crop) e apporti irrigui.
  const campi = await dal.listCampiCampagna({ plotId: plot.id });
  const campagna = campi[0];
  const cropRecord = campagna
    ? crops.find((c) => c.id === campagna.crop_id) ?? null
    : null;
  const profonditaRadiciCrop = numeroMeta(
    cropRecord?.crop_metadata?.profondita_radici,
  );
  const treatments = await dal.listTreatments(activeCompanyId, {
    plotId: plot.id,
    limit: 1000,
  });

  const biofix = biofixGdd(plot, treatments);

  // 0) Storico stagionale (colture ad accumulo): backfill gated via Archive API.
  if (modulo.seasonalAccumulation) {
    try {
      await WeatherSyncService.assicuraStoricoGdd({
        dal,
        companyId: activeCompanyId,
        appezzamentoPrincipale: plot,
        dataInizio: biofix,
      });
    } catch {
      /* offline o archivio non raggiungibile: si procede col disponibile */
    }
  }

  // 1) Meteo: lucchetto orario (company) → fetch solo se stantio. Offline →
  //    fallback sulle letture già in PGlite.
  let series: DssWeatherDay[];
  let meteo: DssWeatherInfo;
  let lettureRaw: WeatherReading[] = [];
  try {
    const res = await WeatherSyncService.assicuraDatiMeteo({
      dal,
      companyId: activeCompanyId,
      appezzamentoPrincipale: plot,
      config: weatherConfig,
    });
    lettureRaw = res.letture;
    series = buildDssSeries(res.letture);
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
    const letture = await dal.listLettureMeteo(activeCompanyId, {
      dopo,
      limit: 30_000,
    });
    lettureRaw = letture;
    series = buildDssSeries(letture);
    meteo = {
      fetched: false,
      inserite: 0,
      fonte: weatherConfig?.data_source ?? "public_api",
      motivo:
        errFetch instanceof Error
          ? i18n.t("useDssCalculation.offlineFallback", { error: errFetch.message })
          : i18n.t("useDssCalculation.useLocalWeatherData"),
    };
  }

  // 2) Bilancio idrico (FAO 56/66) — solo se richiesto.
  let bilancio: BalanceSummary | null = null;
  let bilancioSerie: WaterIndexDay[] = [];
  let statoIdrico: FieldWaterStatus | undefined;
  let soil: ResolvedSoilParameters | null = null;
  if (!opzioni.skipWaterBalance && lettureRaw.length > 0) {
    const soilSamples = await dal.listSoilSamples(activeCompanyId);
    soil = await new SoilDataResolver().risolvi(plot, soilSamples, {
      mappaCustom: opzioni.mappaCustom,
      profonditaRadiciM: profonditaRadiciCrop,
    });
    const out = computeWaterBalance({
      letture: lettureRaw,
      irrigazioni: irrigationInputsFromTreatments(treatments, plot.area_ha),
      crop: modulo.mainSpecies,
      phase: phenologicalPhase(plot),
      soil: soil.parametri,
      altitude: 0,
    });
    bilancioSerie = out.series;
    // Stato idrico CORRENTE = ultimo day osservato (≤ oggi). La series include
    // ~16 giorni di PREVISIONE in coda: usarne l'ultimo (futuro) "laverebbe via"
    // l'irrigation di oggi sotto giorni di ETc successivi. Così invece l'apporto
    // irriguo appena registrato si riflette subito su Dr corrente e autonomia.
    const oggiISO = new Date().toISOString().slice(0, 10);
    let idxOggi = -1;
    for (let i = 0; i < out.series.length; i++) {
      if (out.series[i].data <= oggiISO) idxOggi = i;
      else break;
    }
    const ultimo =
      idxOggi >= 0 ? out.series[idxOggi] : out.series[out.series.length - 1];
    // Giorni di autonomia = giorni consecutivi senza stress dopo oggi (previsione).
    let autonomyDays = 0;
    if (ultimo && !ultimo.inStress) {
      for (let i = idxOggi + 1; i < out.series.length; i++) {
        if (out.series[i].inStress) break;
        autonomyDays++;
      }
    }
    if (ultimo) {
      statoIdrico = {
        depletion: ultimo.depletion,
        raw: ultimo.raw,
        awc: ultimo.awc,
      };
    }
    let persistito = false;
    if (campagna && out.series.length > 0) {
      await dal.saveWaterIndices(
        campagna.id,
        out.series.map((g) => ({
          date: g.data,
          et0: g.et0,
          etc: g.etc,
          rain_mm: g.rain,
          irrigation_mm: g.irrigation,
          deep_percolation_mm: g.percolation,
          depletion_mm: g.depletion,
          raw_mm: g.raw,
          awc_mm: g.awc,
          water_stress: g.inStress,
        })),
      );
      persistito = true;
    }
    bilancio = ultimo
      ? {
          autonomyDays,
          depletion: ultimo.depletion,
          raw: ultimo.raw,
          awc: ultimo.awc,
          inStress: ultimo.inStress,
          giorni: out.series.length,
          persistito,
        }
      : null;
  }

  // 3) Motore DSS unificato (engine puri composti dal modulo + eventuale vettore
  //    di stress idrico). Il biofix ancora l'accumulo GDD.
  const germogli = ((plot.metadata ?? {}) as Record<string, unknown>)
    .lunghezza_germogli_cm;
  const context = {
    gddStartDate: biofix,
    ...(typeof germogli === "number" ? { shootLengthCm: germogli } : {}),
  };
  const { esiti, vettori } = runDssEngine(modulo, series, context, statoIdrico);

  // 4) Persistenza cache dei modelli patologici (ultimo valore per model).
  if (series.length > 0) {
    await dal.saveDssResults(plot.id, outcomesToDssResults(esiti));
  }

  return {
    ...base,
    esiti,
    vettori,
    bilancio,
    soil,
    bilancioSerie,
    series,
    meteo,
    message:
      series.length === 0
        ? i18n.t("useDssCalculation.noWeatherData")
        : undefined,
  };
}

export function useDssCalculation() {
  const [stato, setStato] = useState<StatoDssCalcolo>(STATO_INIZIALE);

  const reset = useCallback(() => setStato(STATO_INIZIALE), []);

  const calcola = useCallback(
    async (targets: DssTarget[], opzioni: OpzioniCalcoloDss = {}) => {
      if (targets.length === 0) return;
      setStato((s) => ({ ...s, phase: "calcolo", message: undefined }));
      try {
        const { dal, activeCompanyId, weatherConfig, crops } =
          useAgroStore.getState();
        if (!dal || !activeCompanyId) {
          throw new Error(i18n.t("useDssCalculation.noActiveCompany"));
        }
        const ctx: ContestoCalcolo = {
          dal,
          activeCompanyId,
          weatherConfig,
          crops,
        };

        const risultati: DssPlotResult[] = [];
        for (const target of targets) {
          try {
            risultati.push(await calcolaPlot(ctx, target, opzioni));
          } catch (errPlot) {
            // Un errore su un campo non blocca gli altri: si registra come esito
            // vuoto con message dedicato.
            risultati.push({
              plotId: target.plot.id,
              name: target.plot.user_plot_name,
              modulo: target.modulo,
              esiti: [],
              vettori: [],
              bilancio: null,
              soil: null,
              bilancioSerie: [],
              series: [],
              meteo: null,
              message:
                errPlot instanceof Error
                  ? errPlot.message
                  : i18n.t("useDssCalculation.plotCalculationError"),
            });
          }
        }

        setStato({
          phase: "completato",
          risultati,
          calcolatoIl: new Date().toISOString(),
        });
      } catch (err) {
        setStato({
          ...STATO_INIZIALE,
          phase: "errore",
          message:
            err instanceof Error ? err.message : i18n.t("useDssCalculation.dssCalculationError"),
        });
      }
    },
    [],
  );

  return { stato, calcola, reset };
}
