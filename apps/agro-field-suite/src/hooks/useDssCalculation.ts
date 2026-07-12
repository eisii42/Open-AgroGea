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
 * MULTI-APPEZZAMENTO (come la pipeline indici del module Suolo):
 *
 *   per ogni plot target →
 *   Fetch meteo (lucchetto orario, company) → series da PGlite → run DSS locale →
 *   (opz.) bilancio idrico FAO 56/66 → scrittura `dss_results`/`soil_water_indices`.
 *
 * Tutto imperativo via `getState()`: il ciclo NON sottoscrive lo store globale,
 * quindi non innesca re-render della mappa GeoLibre. Lo stato vive qui, locale
 * al pannello. Funziona offline: se il fetch fallisce, ripiega sulle readings già
 * presenti in PGlite. Il bilancio idrico è opzionale (`skipWaterBalance`): i DSS
 * patologici non lo calcolano più (è uno strumento a sé nel pannello «Acqua»).
 */

export type DssPhase = "idle" | "calcolo" | "completato" | "errore";

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
  days: number;
  /** true se la series è stata persistita in `soil_water_indices`. */
  persistito: boolean;
}

/** Esito del calcolo per UN plot. */
export interface DssPlotResult {
  plotId: string;
  name: string;
  module: CropModule;
  esiti: DssOutcome[];
  /** Vettori di risk normalizzati 0..1 (patologici + idrico se calcolato). */
  vettori: VettoreRischioDss[];
  /** Sintesi del bilancio idrico (null se non calcolato/calcolabile). */
  balance: BalanceSummary | null;
  /** Parametri idro-pedologici risolti (null se non calcolati). */
  soil: ResolvedSoilParameters | null;
  /** Serie giornaliera del bilancio idrico (vuota se non calcolata). */
  balanceSeries: WaterIndexDay[];
  series: DssWeatherDay[];
  weather: DssWeatherInfo | null;
  message?: string;
}

/** Plot + module crop da calcolare. */
export interface DssTarget {
  plot: Plot;
  module: CropModule;
}

export interface DssCalcOptions {
  /** Mappa custom del soil (Tier 1) per il bilancio idrico. */
  mappaCustom?: FeatureCollection | null;
  /**
   * Salta il bilancio idrico: i DSS patologici non lo calcolano più (è stato
   * spostato nel pannello «Acqua · Bilancio idrico»). Default false.
   */
  skipWaterBalance?: boolean;
}

export interface DssCalcStatus {
  phase: DssPhase;
  /** Esiti per plot, nell'ordine dei target. */
  results: DssPlotResult[];
  /** ISO del momento del calcolo (per la timeline). */
  calcolatoIl: string | null;
  message?: string;
}

const INITIAL_STATE: DssCalcStatus = {
  phase: "idle",
  results: [],
  calcolatoIl: null,
};

/** Fasi fenologiche ammesse (per validare l'override da metadata). */
const VALID_PHASES: readonly PhenologicalPhase[] = [
  "iniziale",
  "sviluppo",
  "piena",
  "maturazione",
];

/** Fase fenologica dal metadata (override), default "piena" (piena stagione). */
function phenologicalPhase(plot: Plot): PhenologicalPhase {
  const meta = (plot.metadata ?? {}) as Record<string, unknown>;
  const phase = meta.phase;
  return typeof phase === "string" && VALID_PHASES.includes(phase as PhenologicalPhase)
    ? (phase as PhenologicalPhase)
    : "piena";
}

/** Finestra di reading locale di fallback (offline): ampia come quella online. */
const WINDOW_DAYS = 430;

/** Valore numerico finito da un metadata (string/number), altrimenti undefined. */
function metaNumber(value: unknown): number | undefined {
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
 * `sowing` registrato. In ordine: last semina/trapianto del logbook → override
 * esplicito nei metadata (`data_inizio_gdd`/`data_semina`) → 1° gennaio dell'anno
 * current (convenzione per i gradi-day stagionali).
 */
function biofixGdd(
  plot: Plot,
  treatments: TreatmentLog[],
): string {
  // `executed_at` arriva da PGlite come Date (non stringa ISO grezza): come nel
  // resto del codice lo si normalizza con `new Date(...)` prima di trattarlo
  // come stringa, altrimenti `.slice`/`.localeCompare` falliscono a runtime.
  const lastSowing = treatments
    .filter((t) => t.operation_type === "sowing" && t.executed_at)
    .map((t) => new Date(t.executed_at).toISOString())
    .sort((a, b) => b.localeCompare(a))[0];
  if (lastSowing) return lastSowing.slice(0, 10);

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
async function computePlot(
  ctx: ContestoCalcolo,
  target: DssTarget,
  options: DssCalcOptions,
): Promise<DssPlotResult> {
  const { dal, activeCompanyId, weatherConfig, crops } = ctx;
  const { plot, module } = target;
  const base: DssPlotResult = {
    plotId: plot.id,
    name: plot.user_plot_name,
    module,
    esiti: [],
    vettori: [],
    balance: null,
    soil: null,
    balanceSeries: [],
    series: [],
    weather: null,
  };

  // Campagna attiva, crop e operazioni: biofix (semina), profondità radicale
  // (tratto crop) e apporti irrigui.
  const fields = await dal.listCampiCampagna({ plotId: plot.id });
  const campaign = fields[0];
  const cropRecord = campaign
    ? crops.find((c) => c.id === campaign.crop_id) ?? null
    : null;
  const cropRootDepth = metaNumber(
    cropRecord?.crop_metadata?.profondita_radici,
  );
  const treatments = await dal.listTreatments(activeCompanyId, {
    plotId: plot.id,
    limit: 1000,
  });

  const biofix = biofixGdd(plot, treatments);

  // 0) Storico stagionale (crops ad accumulo): backfill gated via Archive API.
  if (module.seasonalAccumulation) {
    try {
      await WeatherSyncService.assicuraStoricoGdd({
        dal,
        companyId: activeCompanyId,
        mainPlot: plot,
        dataInizio: biofix,
      });
    } catch {
      /* offline o archivio non raggiungibile: si procede col available */
    }
  }

  // 1) Meteo: lucchetto orario (company) → fetch solo se stantio. Offline →
  //    fallback sulle readings già in PGlite.
  let series: DssWeatherDay[];
  let weather: DssWeatherInfo;
  let rawReadings: WeatherReading[] = [];
  try {
    const res = await WeatherSyncService.assicuraDatiMeteo({
      dal,
      companyId: activeCompanyId,
      mainPlot: plot,
      config: weatherConfig,
    });
    rawReadings = res.readings;
    series = buildDssSeries(res.readings);
    weather = {
      fetched: res.fetched,
      inserite: res.inserite,
      fonte: res.fonte,
      motivo: res.motivo,
    };
  } catch (errFetch) {
    const dopo = new Date(
      Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
    ).toISOString();
    const readings = await dal.listLettureMeteo(activeCompanyId, {
      dopo,
      limit: 30_000,
    });
    rawReadings = readings;
    series = buildDssSeries(readings);
    weather = {
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
  let balance: BalanceSummary | null = null;
  let balanceSeries: WaterIndexDay[] = [];
  let waterStatus: FieldWaterStatus | undefined;
  let soil: ResolvedSoilParameters | null = null;
  if (!options.skipWaterBalance && rawReadings.length > 0) {
    const soilSamples = await dal.listSoilSamples(activeCompanyId);
    soil = await new SoilDataResolver().risolvi(plot, soilSamples, {
      mappaCustom: options.mappaCustom,
      profonditaRadiciM: cropRootDepth,
    });
    const out = computeWaterBalance({
      readings: rawReadings,
      irrigazioni: irrigationInputsFromTreatments(treatments, plot.area_ha),
      crop: module.mainSpecies,
      phase: phenologicalPhase(plot),
      soil: soil.parametri,
      altitude: 0,
    });
    balanceSeries = out.series;
    // Stato idrico CORRENTE = ultimo day osservato (≤ oggi). La series include
    // ~16 giorni di PREVISIONE in coda: usarne l'ultimo (futuro) "laverebbe via"
    // l'irrigation di oggi sotto giorni di ETc successivi. Così invece l'apporto
    // irriguo appena registrato si riflette subito su Dr current e autonomia.
    const todayISO = new Date().toISOString().slice(0, 10);
    let todayIdx = -1;
    for (let i = 0; i < out.series.length; i++) {
      if (out.series[i].data <= todayISO) todayIdx = i;
      else break;
    }
    const last =
      todayIdx >= 0 ? out.series[todayIdx] : out.series[out.series.length - 1];
    // Giorni di autonomia = giorni consecutivi senza stress dopo oggi (previsione).
    let autonomyDays = 0;
    if (last && !last.inStress) {
      for (let i = todayIdx + 1; i < out.series.length; i++) {
        if (out.series[i].inStress) break;
        autonomyDays++;
      }
    }
    if (last) {
      waterStatus = {
        depletion: last.depletion,
        raw: last.raw,
        awc: last.awc,
      };
    }
    let persistito = false;
    if (campaign && out.series.length > 0) {
      await dal.saveWaterIndices(
        campaign.id,
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
    balance = last
      ? {
          autonomyDays,
          depletion: last.depletion,
          raw: last.raw,
          awc: last.awc,
          inStress: last.inStress,
          days: out.series.length,
          persistito,
        }
      : null;
  }

  // 3) Motore DSS unificato (engine puri composti dal module + eventuale vettore
  //    di stress idrico). Il biofix ancora l'accumulo GDD.
  const germogli = ((plot.metadata ?? {}) as Record<string, unknown>)
    .lunghezza_germogli_cm;
  const context = {
    gddStartDate: biofix,
    ...(typeof germogli === "number" ? { shootLengthCm: germogli } : {}),
  };
  const { esiti, vettori } = runDssEngine(module, series, context, waterStatus);

  // 4) Persistenza cache dei modelli patologici (ultimo value per model).
  if (series.length > 0) {
    await dal.saveDssResults(plot.id, outcomesToDssResults(esiti));
  }

  return {
    ...base,
    esiti,
    vettori,
    balance,
    soil,
    balanceSeries,
    series,
    weather,
    message:
      series.length === 0
        ? i18n.t("useDssCalculation.noWeatherData")
        : undefined,
  };
}

export function useDssCalculation() {
  const [status, setStatus] = useState<DssCalcStatus>(INITIAL_STATE);

  const reset = useCallback(() => setStatus(INITIAL_STATE), []);

  const compute = useCallback(
    async (targets: DssTarget[], options: DssCalcOptions = {}) => {
      if (targets.length === 0) return;
      setStatus((s) => ({ ...s, phase: "calcolo", message: undefined }));
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

        const results: DssPlotResult[] = [];
        for (const target of targets) {
          try {
            results.push(await computePlot(ctx, target, options));
          } catch (errPlot) {
            // Un errore su un field non blocca gli altri: si registra come esito
            // vuoto con message dedicato.
            results.push({
              plotId: target.plot.id,
              name: target.plot.user_plot_name,
              module: target.module,
              esiti: [],
              vettori: [],
              balance: null,
              soil: null,
              balanceSeries: [],
              series: [],
              weather: null,
              message:
                errPlot instanceof Error
                  ? errPlot.message
                  : i18n.t("useDssCalculation.plotCalculationError"),
            });
          }
        }

        setStatus({
          phase: "completato",
          results,
          calcolatoIl: new Date().toISOString(),
        });
      } catch (err) {
        setStatus({
          ...INITIAL_STATE,
          phase: "errore",
          message:
            err instanceof Error ? err.message : i18n.t("useDssCalculation.dssCalculationError"),
        });
      }
    },
    [],
  );

  return { status, compute, reset };
}
