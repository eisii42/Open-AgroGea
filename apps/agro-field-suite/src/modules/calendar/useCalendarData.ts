import {
  type DssResult,
  type PlotCampaign,
  type SoilWaterIndex,
  useAgroStore,
} from "@agrogea/core";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Dati del Calendario che NON vivono nello store di dominio: campagne di tutte
 * le annate, cache DSS (per appezzamento) e serie del bilancio idrico (per
 * campagna). Operazioni, raccolte e task programmate arrivano invece dallo
 * store già idratato — il calendario non le ricarica.
 *
 * Nessun calcolo: DSS e bilancio idrico sono LETTI dalla loro cache locale, e
 * compaiono nel calendario appena il calcolo viene eseguito altrove (mappa o
 * Command Center). `refresh` esiste per riflettere subito quei ricalcoli.
 */
export interface CalendarData {
  loading: boolean;
  campaigns: PlotCampaign[];
  dssResults: DssResult[];
  soilIndices: SoilWaterIndex[];
  /** `plots_campaign.id` → `plot_id`: porta gli indici idrici nello scope-plot. */
  plotIdByCampaign: Record<string, string>;
  /** Anni di campagna disponibili, dal più recente. */
  years: number[];
  refresh: () => void;
}

export function useCalendarData(campaignYear: number): CalendarData {
  const dal = useAgroStore((s) => s.dal);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const plots = useAgroStore((s) => s.plots);

  const [campaigns, setCampaigns] = useState<PlotCampaign[]>([]);
  const [dssResults, setDssResults] = useState<DssResult[]>([]);
  const [soilIndices, setSoilIndices] = useState<SoilWaterIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const plotKey = plots
    .filter((p) => p.deleted_at == null)
    .map((p) => p.id)
    .sort()
    .join(",");

  useEffect(() => {
    let alive = true;
    if (!dal || !activeCompanyId) {
      setCampaigns([]);
      setDssResults([]);
      setSoilIndices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const plotIds = plotKey ? plotKey.split(",") : [];
    void (async () => {
      const allCampaigns = await dal.listCampiCampagna({});
      if (!alive) return;
      const yearCampaigns = allCampaigns.filter(
        (c) => c.deleted_at == null && c.campaign_year === campaignYear,
      );
      const [dssByPlot, indicesByCampaign] = await Promise.all([
        Promise.all(plotIds.map((id) => dal.listDssRisultati(id))),
        Promise.all(yearCampaigns.map((c) => dal.listIndiciIdrici(c.id))),
      ]);
      if (!alive) return;
      setCampaigns(allCampaigns);
      setDssResults(dssByPlot.flat());
      setSoilIndices(indicesByCampaign.flat());
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [dal, activeCompanyId, campaignYear, plotKey, reloadToken]);

  const plotIdByCampaign = useMemo(() => {
    const map: Record<string, string> = {};
    for (const campaign of campaigns) map[campaign.id] = campaign.plot_id;
    return map;
  }, [campaigns]);

  const years = useMemo(() => {
    const set = new Set<number>(campaigns.map((c) => c.campaign_year));
    set.add(campaignYear);
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [campaigns, campaignYear]);

  return {
    loading,
    campaigns,
    dssResults,
    soilIndices,
    plotIdByCampaign,
    years,
    refresh,
  };
}
