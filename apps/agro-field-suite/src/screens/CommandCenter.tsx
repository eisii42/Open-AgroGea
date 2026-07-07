import { useAgroStore } from "@agrogea/core";
import {
  Check,
  ChevronDown,
  Download,
  Layers,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { TeamPanel } from "../modules/team/TeamPanel";
import { useReadOnly } from "@agrogea/core";
import { STANDALONE } from "../standalone";
import { cn } from "@geolibre/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../components/AppHeader";
import { CompanyDataIo } from "../components/CompanyDataIo";
import { CompanyOverview } from "../modules/analytics/CompanyOverview";
import { CustomDashboard } from "../modules/analytics/CustomDashboard";
import type { DashboardData } from "../modules/analytics/dashboard-datasets";
import {
  buildExecutiveReportCsv,
  executiveReportFilename,
} from "../modules/analytics/executive-report";
import { KpiGrid } from "../modules/analytics/KpiGrid";
import { OperationsCalendar } from "../modules/analytics/OperationsCalendar";
import { RawDataInspector } from "../modules/analytics/RawDataInspector";
import { useCommandCenterData } from "../modules/analytics/useCommandCenterData";
import { useFullRecalc } from "../modules/analytics/useFullRecalc";
import {
  type KpiParams,
  loadKpiParams,
  persistKpiParams,
} from "../modules/analytics/kpi-config";
import { scaricaArtifact } from "../services/gis/geo-export";

/** Pagine del Data Command Center (tab di primo livello sotto l'header). */
type CommandCenterPage = "crops" | "company";

/**
 * Data Command Center (`/command-center`): centro nevralgico dell'analisi dati,
 * disaccoppiato dalla vista mappa (la mappa MapLibre è smontata dall'App quando
 * questa vista è attiva, liberando risorse hardware). Diviso in DUE pagine:
 *   * «Colture e appezzamenti» — l'analisi agronomica: filtri gerarchici
 *     (annata → coltura → appezzamenti), griglia KPI configurabile, dashboard
 *     editabile, calendario operativo e Raw Data Inspector con cross-filtering;
 *   * «Azienda» — l'andamento generale: superficie/operazioni/raccolto
 *     dell'annata, stato del Magazzino (valore giacenze a CUMP, lotti scaduti e
 *     in scadenza), costo prodotti imputato per campo e backup/ripristino.
 * Il contesto aziendale vive nello store e sopravvive allo switch di vista.
 */
export function CommandCenter() {
  const { t } = useTranslation();
  const aziende = useAgroStore((s) => s.aziende);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const crops = useAgroStore((s) => s.crops);
  const trattamenti = useAgroStore((s) => s.trattamenti);
  const raccolte = useAgroStore((s) => s.raccolte);
  const campagnaAttiva = useAgroStore((s) => s.campagnaAttiva);
  const registraTrasferimento = useAgroStore((s) => s.registraTrasferimento);

  // Sola lettura (Modulo 4): un VIEWER non può lanciare i ricalcoli che mutano
  // il database (DSS, indici, bilancio idrico). L'export resta consentito.
  const readOnly = useReadOnly(aziendaAttivaId);

  // Pagina attiva: analisi colturale (default) o andamento generale azienda.
  const [page, setPage] = useState<CommandCenterPage>("crops");
  const [campaignYear, setCampaignYear] = useState(campagnaAttiva);
  const [cropId, setCropId] = useState<string | null>(null);
  const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
  const [params, setParams] = useState<KpiParams>(() => loadKpiParams());

  // Cambiare annata o coltura ridefinisce l'insieme dei campi: azzera la
  // selezione multi-plot per non trascinare un filtro fuori scope.
  useEffect(() => {
    setSelectedPlotIds([]);
  }, [campaignYear, cropId]);

  const data = useCommandCenterData(campaignYear, cropId, selectedPlotIds, params);
  // "Calcola tutto": indici satellitari + DSS + bilancio idrico su tutti i campi,
  // con barra di avanzamento; al termine ricarica i dati della vista.
  const fullRecalc = useFullRecalc(data.refresh);

  const onChangeParams = (patch: Partial<KpiParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch };
      persistKpiParams(next);
      return next;
    });
  };

  // Colture presenti nelle campagne dell'annata selezionata (per il selettore).
  const cropOptions = useMemo(() => {
    const ids = new Set(
      data.allCampaigns
        .filter((c) => c.deleted_at == null && c.campaign_year === campaignYear)
        .map((c) => c.crop_id),
    );
    return crops.filter((c) => ids.has(c.id));
  }, [data.allCampaigns, crops, campaignYear]);

  // Scope BASE (annata/coltura), prima del filtro multi-plot: campagne dell'anno,
  // con fallback company-wide se l'annata non ha record di campagna.
  const scopePlotIds = useMemo<Set<string> | null>(() => {
    const scoped = data.allCampaigns.filter(
      (c) =>
        c.deleted_at == null &&
        c.campaign_year === campaignYear &&
        (!cropId || c.crop_id === cropId),
    );
    if (scoped.length === 0 && !cropId) return null; // company-wide
    return new Set(scoped.map((c) => c.plot_id));
  }, [data.allCampaigns, campaignYear, cropId]);

  // Appezzamenti selezionabili nel filtro multi-plot (entro lo scope base).
  const plotOptions = useMemo(
    () =>
      appezzamenti
        .filter(
          (a) =>
            a.deleted_at == null &&
            (scopePlotIds == null || scopePlotIds.has(a.id)),
        )
        .map((a) => ({ id: a.id, name: a.user_plot_name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [appezzamenti, scopePlotIds],
  );

  // Scope EFFETTIVO per calendario e KPI: il filtro multi-plot vince sullo scope
  // base; vuoto = intero scope annata/coltura.
  const effectivePlotIds = useMemo<Set<string> | null>(
    () => (selectedPlotIds.length > 0 ? new Set(selectedPlotIds) : scopePlotIds),
    [selectedPlotIds, scopePlotIds],
  );

  const inEffective = (plotId: string | null): boolean =>
    effectivePlotIds == null ||
    (plotId != null && effectivePlotIds.has(plotId));

  const scopedTrattamenti = useMemo(
    () =>
      trattamenti.filter(
        (t) =>
          t.deleted_at == null &&
          inEffective(t.plot_id) &&
          new Date(t.executed_at).getUTCFullYear() === campaignYear,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trattamenti, effectivePlotIds, campaignYear],
  );
  const scopedRaccolte = useMemo(
    () =>
      raccolte.filter(
        (r) =>
          r.deleted_at == null &&
          inEffective(r.plot_id) &&
          new Date(r.harvested_at).getUTCFullYear() === campaignYear,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raccolte, effectivePlotIds, campaignYear],
  );

  // Operazioni/raccolte ristrette ai SOLI appezzamenti (tutte le annate): è il
  // filtro temporale della dashboard a scegliere il periodo, non l'annata KPI.
  const plotTrattamenti = useMemo(
    () => trattamenti.filter((t) => t.deleted_at == null && inEffective(t.plot_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trattamenti, effectivePlotIds],
  );
  const plotRaccolte = useMemo(
    () => raccolte.filter((r) => r.deleted_at == null && inEffective(r.plot_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raccolte, effectivePlotIds],
  );

  // Bundle per i grafici della dashboard editabile: scopato per APPEZZAMENTO (non
  // per annata) — il filtro temporale del componente sceglie il periodo.
  const dashboardData = useMemo<DashboardData>(
    () => ({
      appezzamenti: appezzamenti.filter(
        (a) => a.deleted_at == null && inEffective(a.id),
      ),
      crops,
      campaigns: data.allCampaigns.filter((c) => c.deleted_at == null),
      trattamenti: plotTrattamenti,
      raccolte: plotRaccolte,
      soilIndices: data.soilIndices,
      weather: data.weather,
      dssRisultati: data.dssRisultati,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      appezzamenti,
      crops,
      data.allCampaigns,
      data.soilIndices,
      data.weather,
      data.dssRisultati,
      plotTrattamenti,
      plotRaccolte,
      effectivePlotIds,
    ],
  );

  const companyName =
    aziende.find((a) => a.id === aziendaAttivaId)?.business_name ??
    t("commandCenter.company");

  const onExport = () => {
    if (!data.result) return;
    const csv = buildExecutiveReportCsv({
      result: data.result,
      trattamenti: scopedTrattamenti,
      raccolte: scopedRaccolte,
      companyName,
    });
    const filename = executiveReportFilename(companyName, campaignYear);
    scaricaArtifact({
      filename,
      blobPart: csv,
      mime: "text/csv;charset=utf-8",
    });
    void registraTrasferimento({
      operation_type: "export",
      file_format: "csv",
      file_name: filename,
    });
  };

  // Cross-filtering dal Raw Data Inspector: il clic sul "focus" di una riga
  // isola quell'appezzamento (toggle: ricliccare lo stesso lo deseleziona).
  const onFocusPlot = (plotId: string) => {
    setSelectedPlotIds((prev) =>
      prev.length === 1 && prev[0] === plotId ? [] : [plotId],
    );
  };

  const summary = data.result?.summary;
  const focusedPlotId =
    selectedPlotIds.length === 1 ? selectedPlotIds[0] : null;

  return (
    <div className="flex h-full flex-col">
      <AppHeader />

      {/* Tab di pagina: analisi colturale vs andamento generale azienda. */}
      <div className="flex items-end gap-1 border-b border-[var(--line)] bg-[var(--panel)] px-4">
        {(
          [
            ["crops", t("commandCenter.pageCrops")],
            ["company", t("commandCenter.pageCompany")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPage(id)}
            className={cn(
              "min-h-[40px] border-b-2 px-3 text-sm font-medium",
              page === id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg)] p-4">
        {/* Banner Sola Lettura (ruolo VIEWER): l'intera vista è in read-only. */}
        {readOnly && (
          <div className="mb-4 flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
            <Lock size={15} className="text-[var(--ink-3)]" />
            {t("commandCenter.readOnlyBanner.prefix")}{" "}
            <strong>{t("commandCenter.readOnlyBanner.strong")}</strong>
            {t("commandCenter.readOnlyBanner.suffix")}
          </div>
        )}

        {page === "company" && (
          <div className="flex flex-col gap-4">
            <CompanyOverview campaignYear={campaignYear} />

            {/* Gestione team dell'azienda (Modulo 4), role-gated. Modulo cloud:
                assente nelle build standalone/OSS (singolo utente locale). */}
            {!STANDALONE && <TeamPanel readOnly={readOnly} />}

            {/* Edizione standalone/OSS: backup/ripristino dei dati locali in
                GeoJSON (Disaster Recovery locale) — operazione di AZIENDA. */}
            {STANDALONE && <CompanyDataIo />}
          </div>
        )}

        {page === "crops" && (
          <>
        {/* Barra filtri gerarchici + sintesi + export */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
            {t("commandCenter.campaignYear")}
            <select
              value={campaignYear}
              onChange={(e) => setCampaignYear(Number(e.target.value))}
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
            >
              {data.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
            {t("commandCenter.crop")}
            <select
              value={cropId ?? ""}
              onChange={(e) => setCropId(e.target.value || null)}
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
            >
              <option value="">{t("commandCenter.allCrops")}</option>
              {cropOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.variety_name
                    ? `${c.common_name} (${c.variety_name})`
                    : c.common_name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1 text-[11px] text-[var(--ink-3)]">
            {t("commandCenter.plots")}
            <PlotMultiSelect
              options={plotOptions}
              selected={selectedPlotIds}
              onChange={setSelectedPlotIds}
            />
          </div>

          {summary && (
            <div className="flex items-center gap-2 text-xs text-[var(--ink-3)]">
              <span className="flex items-center gap-1 rounded-full bg-[var(--panel-2)] px-2.5 py-1">
                <Layers size={13} /> {summary.categoryLabel}
              </span>
              <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1">
                {t("commandCenter.plotsAreaSummary", {
                  count: summary.plotCount,
                  area: summary.totalAreaHa.toFixed(1),
                })}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fullRecalc.run()}
              disabled={fullRecalc.state.running || readOnly}
              title={
                readOnly
                  ? t("commandCenter.recalcAllReadOnly")
                  : t("commandCenter.recalcAllTitle")
              }
              className="flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--accent)] bg-[var(--accent-l)] px-3 py-2 text-sm font-medium text-[var(--accent)] hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={15} />
              {t("commandCenter.recalcAll")}
            </button>
            <button
              type="button"
              onClick={() => data.refresh()}
              disabled={data.loading || fullRecalc.state.running}
              title={t("commandCenter.refreshTitle")}
              className="flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:opacity-50"
            >
              <RefreshCw size={15} className={cn(data.loading && "animate-spin")} />
              {t("commandCenter.refresh")}
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={!data.result}
              className="flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Download size={15} /> {t("commandCenter.downloadReport")}
            </button>
          </div>
        </div>

        {/* Barra di avanzamento di "Calcola tutto". */}
        {fullRecalc.state.running && (
          <div className="mb-4 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--ink-2)]">
                {fullRecalc.state.label}
              </span>
              <span className="agro-num text-[var(--ink-3)]">
                {fullRecalc.state.done}/{fullRecalc.state.total}
                {fullRecalc.state.errors > 0 && (
                  <span className="ml-2 text-[var(--warn)]">
                    {t("commandCenter.recalcErrors", { count: fullRecalc.state.errors })}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--panel-3)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{
                  width: `${
                    fullRecalc.state.total > 0
                      ? Math.round(
                          (fullRecalc.state.done / fullRecalc.state.total) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {data.loading && !data.result ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-[var(--ink-4)]">
            <Loader2 size={16} className="animate-spin" /> {t("commandCenter.loadingAnalysis")}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {data.result && (
              <KpiGrid
                kpis={data.result.kpis}
                params={params}
                onChangeParams={onChangeParams}
              />
            )}

            {/* Dashboard aziendale editabile: grafici riordinabili/eliminabili
                e creabili da qualsiasi sorgente dati. */}
            {aziendaAttivaId && (
              <CustomDashboard
                data={dashboardData}
                companyId={aziendaAttivaId}
                campaignYear={campaignYear}
              />
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <OperationsCalendar
                campaignYear={campaignYear}
                plotIds={effectivePlotIds}
                trattamenti={trattamenti}
                raccolte={raccolte}
                dssRisultati={data.dssRisultati}
              />
              <RawDataInspector
                plotIds={scopePlotIds}
                campaignYear={campaignYear}
                focusedPlotId={focusedPlotId}
                onFocusPlot={onFocusPlot}
              />
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selettore multi-appezzamento (Modulo 2 — filtraggio gerarchico)
// ---------------------------------------------------------------------------

function PlotMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const label =
    selected.length === 0
      ? t("commandCenter.allFields")
      : t("commandCenter.fieldsSelected", { count: selected.length });

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-[160px] items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
      >
        <MapPin size={14} className="shrink-0 text-[var(--ink-3)]" />
        <span className="flex-1 truncate text-left">{label}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--ink-4)] hover:bg-[var(--panel-2)]"
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-[var(--ink-4)]" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-[240px] overflow-y-auto rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--sh-pop)]">
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--ink-4)]">
              {t("commandCenter.noPlotsInScope")}
            </p>
          )}
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--panel-2)]"
              >
                <span
                  className={
                    on
                      ? "flex h-4 w-4 items-center justify-center rounded-[var(--r-1)] bg-[var(--accent)] text-white"
                      : "flex h-4 w-4 items-center justify-center rounded-[var(--r-1)] border border-[var(--line)]"
                  }
                >
                  {on && <Check size={11} />}
                </span>
                <span className="flex-1 truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
