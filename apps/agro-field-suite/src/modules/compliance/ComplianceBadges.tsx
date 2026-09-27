import type { Plot, ProductionRegime } from "@agrogea/core";
import { useAgroStore } from "@agrogea/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildDueDiligenceReport } from "./due-diligence";
import { useComplianceConstraints } from "./useGeoCompliance";

/**
 * Badge condizionali di geo-compliance per un plot (Modulo 4):
 *   * regime di produzione dichiarato per l'annata attiva (v24) — è un dato
 *     DICHIARATO dall'utente, non una verifica: si mostra solo se c'è;
 *   * ZVN → badge arancione (il tetto azoto è applicato nel form QDC);
 *   * SIC/ZPS → badge ambra (area protetta);
 *   * EUDR → alert rosso + download del report di due diligence georeferenziato.
 * Si nasconde se non c'è nulla da dire (né regime né vincoli di layer).
 */

/** Colori del badge per regime: il bio si distingue a colpo d'occhio. */
const REGIME_TONE: Record<ProductionRegime, string> = {
  organic: "bg-[var(--ok-l)] text-[var(--ok)]",
  in_conversion: "bg-[var(--warn-l)] text-[var(--warn)]",
  integrated: "bg-[var(--panel-2)] text-[var(--ink-2)]",
  conventional: "bg-[var(--panel-2)] text-[var(--ink-3)]",
};

export function ComplianceBadges({
  plot,
}: {
  plot: Plot;
}) {
  const { t } = useTranslation();
  const valuta = useComplianceConstraints();
  const companies = useAgroStore((s) => s.companies);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const recordTransfer = useAgroStore((s) => s.recordTransfer);
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const campaignFields = useAgroStore((s) => s.campaignFields);

  const outcome = useMemo(
    () => valuta(plot.geometry),
    [valuta, plot.geometry],
  );

  // Regime dell'annata ATTIVA: le campagne di altri anni non descrivono
  // l'appezzamento di oggi.
  const regime = useMemo(
    () =>
      campaignFields.find(
        (c) => c.plot_id === plot.id && c.campaign_year === activeCampaign,
      )?.production_regime ?? null,
    [campaignFields, plot.id, activeCampaign],
  );

  const hasConstraints = Boolean(outcome && outcome.constraints.length > 0);
  if (!regime && !hasConstraints) return null;

  const downloadReport = () => {
    const report = buildDueDiligenceReport({
      appezzamentoNome: plot.user_plot_name,
      aziendaNome: companies.find((a) => a.id === activeCompanyId)?.business_name,
      geometria: plot.geometry,
      areaHa: plot.area_ha,
      constraints: outcome?.constraints ?? [],
    });
    const url = URL.createObjectURL(
      new Blob([report], { type: "application/geo+json" }),
    );
    const fileName = `due-diligence_${plot.user_plot_name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.geojson`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    // Tracciabilità: tag di export nel giornale dei trasferimenti.
    void recordTransfer({
      operation_type: "export",
      file_format: "geojson",
      file_name: fileName,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {regime && (
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-[var(--r-2)] px-2 py-1 text-xs font-medium " +
            REGIME_TONE[regime]
          }
          title={t("compliance.badges.regimeTitle", { year: activeCampaign })}
        >
          🌱 {t(`cropDataForm.regimes.${regime}`)}
        </span>
      )}
      {outcome?.inZvn && (
        <span className="inline-flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--warn-l)] px-2 py-1 text-xs font-medium text-[var(--warn)]">
          ⚠ Zona Vulnerabile Nitrati
        </span>
      )}
      {outcome?.inAreaProtetta && (
        <span className="inline-flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--warn-l)] px-2 py-1 text-xs font-medium text-[var(--ink-2)]">
          ⛰ Area protetta (SIC/ZPS)
        </span>
      )}
      {outcome?.inEudr && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] bg-[var(--danger-l)] px-2 py-1.5 text-xs text-[var(--danger)]">
          <span className="font-semibold">⛔ Verifica Compliance EUDR</span>
          <button
            type="button"
            onClick={downloadReport}
            className="self-start rounded-[var(--r-2)] border border-[var(--danger)] px-2 py-1 font-medium"
          >
            Scarica report due diligence
          </button>
        </div>
      )}
    </div>
  );
}
