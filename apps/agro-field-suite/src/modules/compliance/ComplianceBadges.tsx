import type { Plot } from "@agrogea/core";
import { useAgroStore } from "@agrogea/core";
import { useMemo } from "react";
import { buildDueDiligenceReport } from "./due-diligence";
import { useComplianceVincoli } from "./useGeoCompliance";

/**
 * Badge condizionali di geo-compliance per un plot (Modulo 4):
 *   * ZVN → badge arancione (il tetto azoto è applicato nel form QDC);
 *   * SIC/ZPS → badge ambra (area protetta);
 *   * EUDR → alert rosso + download del report di due diligence georeferenziato.
 * Si nasconde se non ci sono vincoli (o nessun layer di compliance caricato).
 */
export function ComplianceBadges({
  plot,
}: {
  plot: Plot;
}) {
  const valuta = useComplianceVincoli();
  const companies = useAgroStore((s) => s.companies);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const recordTransfer = useAgroStore((s) => s.recordTransfer);

  const esito = useMemo(
    () => valuta(plot.geometry),
    [valuta, plot.geometry],
  );

  if (!esito || esito.vincoli.length === 0) return null;

  const scaricaReport = () => {
    const report = buildDueDiligenceReport({
      appezzamentoNome: plot.user_plot_name,
      aziendaNome: companies.find((a) => a.id === activeCompanyId)?.business_name,
      geometria: plot.geometry,
      areaHa: plot.area_ha,
      vincoli: esito.vincoli,
    });
    const url = URL.createObjectURL(
      new Blob([report], { type: "application/geo+json" }),
    );
    const nomeFile = `due-diligence_${plot.user_plot_name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.geojson`;
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFile;
    a.click();
    URL.revokeObjectURL(url);
    // Tracciabilità: tag di export nel giornale dei trasferimenti.
    void recordTransfer({
      operation_type: "export",
      file_format: "geojson",
      file_name: nomeFile,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {esito.inZvn && (
        <span className="inline-flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--warn-l)] px-2 py-1 text-xs font-medium text-[var(--warn)]">
          ⚠ Zona Vulnerabile Nitrati
        </span>
      )}
      {esito.inAreaProtetta && (
        <span className="inline-flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--warn-l)] px-2 py-1 text-xs font-medium text-[var(--ink-2)]">
          ⛰ Area protetta (SIC/ZPS)
        </span>
      )}
      {esito.inEudr && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] bg-[var(--danger-l)] px-2 py-1.5 text-xs text-[var(--danger)]">
          <span className="font-semibold">⛔ Verifica Compliance EUDR</span>
          <button
            type="button"
            onClick={scaricaReport}
            className="self-start rounded-[var(--r-2)] border border-[var(--danger)] px-2 py-1 font-medium"
          >
            Scarica report due diligence
          </button>
        </div>
      )}
    </div>
  );
}
