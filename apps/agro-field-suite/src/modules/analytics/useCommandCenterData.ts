import {
  type PlotCampaign,
  type DssResult,
  type WeatherReading,
  type SoilWaterIndex,
  useAgroStore,
} from "@agrogea/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AnalyticsResult,
  runCommandCenterEngine,
} from "./CommandCenterEngine";
import type { KpiParams } from "./kpi-config";

/**
 * Hook di caricamento del Data Command Center. Materializza dal DAL i dati NON
 * presenti nello store di dominio (campagne di TUTTE le annate per il confronto
 * storico, letture meteo, cache DSS, indici idrici) e li combina con il dominio
 * già idratato (plots, colture, operazioni, harvests) per alimentare il
 * motore analitico puro. Ricalcola al cambio di company, annata, crop o
 * parametri KPI.
 */

export interface CommandCenterData {
  loading: boolean;
  result: AnalyticsResult | null;
  /** Campagne di tutte le annate (per i selettori e l'inspector). */
  allCampaigns: PlotCampaign[];
  /** Anni di campagna distinti, dal più recente (per il selettore d'annata). */
  years: number[];
  dssRisultati: DssResult[];
  soilIndices: SoilWaterIndex[];
  weather: WeatherReading[];
  /**
   * Ricarica dal DAL meteo, campagne, cache DSS e indici idrici. Da chiamare
   * dopo aver eseguito calcoli DSS/bilancio idrico altrove (mappa) per riflettere
   * subito i nuovi `dss_results`/`soil_water_indices` senza rimontare la vista.
   */
  refresh: () => void;
}

export function useCommandCenterData(
  campaignYear: number,
  cropId: string | null,
  selectedPlotIds: string[],
  params: KpiParams,
): CommandCenterData {
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const treatments = useAgroStore((s) => s.treatments);
  const harvests = useAgroStore((s) => s.harvests);

  const [allCampaigns, setAllCampaigns] = useState<PlotCampaign[]>([]);
  const [weather, setWeather] = useState<WeatherReading[]>([]);
  const [dssRisultati, setDssRisultati] = useState<DssResult[]>([]);
  const [soilIndices, setSoilIndices] = useState<SoilWaterIndex[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingScope, setLoadingScope] = useState(true);
  // Bump per forzare il ricaricamento on-demand (pulsante "Aggiorna").
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  // Base: campagne di tutte le annate + letture meteo dell'azienda.
  useEffect(() => {
    let alive = true;
    if (!dal || !activeCompanyId) {
      setAllCampaigns([]);
      setWeather([]);
      setLoadingBase(false);
      return;
    }
    setLoadingBase(true);
    void Promise.all([
      dal.listCampiCampagna({}),
      // Limite alto: la serie include lo storico orario PIÙ la previsione a +16gg
      // (forecast in coda); un limite basso con ORDER BY asc taglierebbe proprio
      // i giorni futuri necessari alla proiezione GDD (Modulo 3.2).
      dal.listLettureMeteo(activeCompanyId, { limit: 40000 }),
    ]).then(([campaigns, readings]) => {
      if (!alive) return;
      setAllCampaigns(campaigns);
      setWeather(readings);
      setLoadingBase(false);
    });
    return () => {
      alive = false;
    };
  }, [dal, activeCompanyId, reloadToken]);

  // Scope: cache DSS (per plot) e indici idrici (per campagna).
  const scopedCampaigns = useMemo(
    () =>
      allCampaigns.filter(
        (c) =>
          c.deleted_at == null &&
          c.campaign_year === campaignYear &&
          (!cropId || c.crop_id === cropId),
      ),
    [allCampaigns, campaignYear, cropId],
  );

  // Appezzamenti dello scope da cui caricare i `dss_results`. ALLINEATO al motore:
  // se l'annata non ha record di Campagna Agraria e non c'è filtro crop, il
  // fallback è company-wide (TUTTI gli plots) — così i DSS calcolati su
  // plot senza campagna vengono comunque caricati e il Command Center si update.
  const companyWide = scopedCampaigns.length === 0 && !cropId;
  const scopePlotIds = useMemo(
    () =>
      companyWide
        ? plots.filter((a) => a.deleted_at == null).map((a) => a.id)
        : [...new Set(scopedCampaigns.map((c) => c.plot_id))],
    [companyWide, plots, scopedCampaigns],
  );
  // Gli indici idrici sono legati a plots_campaign: si caricano solo per le
  // campagne effettive (in fallback company-wide non ce ne sono).
  const scopeCampaignIds = useMemo(
    () => [...new Set(scopedCampaigns.map((c) => c.id))],
    [scopedCampaigns],
  );

  // Chiavi stabili per evitare ricarichi inutili a ogni render.
  const plotKey = [...scopePlotIds].sort().join(",");
  const campKey = [...scopeCampaignIds].sort().join(",");

  useEffect(() => {
    let alive = true;
    if (!dal || scopePlotIds.length === 0) {
      setDssRisultati([]);
      setSoilIndices([]);
      setLoadingScope(false);
      return;
    }
    setLoadingScope(true);
    void Promise.all([
      Promise.all(scopePlotIds.map((id) => dal.listDssRisultati(id))),
      Promise.all(scopeCampaignIds.map((id) => dal.listIndiciIdrici(id))),
    ]).then(([dssByPlot, idxByCamp]) => {
      if (!alive) return;
      setDssRisultati(dssByPlot.flat());
      setSoilIndices(idxByCamp.flat());
      setLoadingScope(false);
    });
    return () => {
      alive = false;
    };
    // plotKey/campKey riassumono lo scope; reloadToken forza il ricarico manuale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dal, plotKey, campKey, reloadToken]);

  // Chiave stabile del filtro multi-plot per le dipendenze del memo.
  const plotFilterKey = [...selectedPlotIds].sort().join(",");

  const result = useMemo<AnalyticsResult | null>(() => {
    if (!activeCompanyId) return null;
    return runCommandCenterEngine({
      plots,
      crops,
      campaignFields: allCampaigns,
      treatments,
      harvests,
      dssRisultati,
      weather,
      soilIndices,
      campaignYear,
      cropId,
      selectedPlotIds,
      params,
    });
    // plotFilterKey riassume selectedPlotIds (array nuovo a ogni render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCompanyId,
    plots,
    crops,
    allCampaigns,
    treatments,
    harvests,
    dssRisultati,
    weather,
    soilIndices,
    campaignYear,
    cropId,
    plotFilterKey,
    params,
  ]);

  const years = useMemo(() => {
    const set = new Set<number>(allCampaigns.map((c) => c.campaign_year));
    set.add(campaignYear);
    return [...set].sort((a, b) => b - a);
  }, [allCampaigns, campaignYear]);

  return {
    loading: loadingBase || loadingScope,
    result,
    allCampaigns,
    years,
    dssRisultati,
    soilIndices,
    weather,
    refresh,
  };
}
