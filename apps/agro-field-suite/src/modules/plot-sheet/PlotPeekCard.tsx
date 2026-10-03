import {
  cropForPlot,
  formatArea,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { ndviColor } from "@agrogea/tools";
import { useBackDismiss } from "@agrogea/ui";
import { Button } from "@geolibre/ui";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlotAlertList } from "../../components/PlotAlertList";

/**
 * Scheda compatta dell'appezzamento toccato sulla mappa (solo telefono).
 *
 * Sul desktop il passaggio del mouse mostra il tooltip e il click apre la
 * scheda completa. Su touch non c'è passaggio del mouse: il tocco apriva
 * insieme tooltip e scheda da 70% dello schermo, coprendo proprio il campo
 * appena scelto. Qui il tocco mostra l'essenziale in basso — nome, coltura,
 * superficie, ultimo NDVI, avvisi — lasciando visibile la mappa, e la scheda
 * completa si apre solo se serve.
 */
export function PlotPeekCard({
  plotId,
  onClose,
}: {
  plotId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const plot = useAgroStore((s) => s.plots.find((p) => p.id === plotId));
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const crops = useAgroStore((s) => s.crops);
  const openPlotSheet = useAgroStore((s) => s.openPlotSheet);
  const areaUnit = useSettingsStore((s) => s.units.area);
  // Tasto indietro di Android: chiude la scheda, come gli altri fogli.
  useBackDismiss(onClose);

  if (!plot) return null;
  const crop = cropForPlot(plot.id, campaignFields, crops);
  const ndvi =
    typeof plot.last_ndvi_mean === "number" && !Number.isNaN(plot.last_ndvi_mean)
      ? plot.last_ndvi_mean
      : null;

  return (
    <div
      role="dialog"
      aria-label={plot.user_plot_name}
      className="absolute inset-x-3 bottom-3 z-30 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-pop)]"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{plot.user_plot_name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--ink-3)]">
            <span>{crop ?? t("plotPeek.noCrop")}</span>
            {plot.area_ha != null && (
              <>
                <span aria-hidden>·</span>
                <span className="agro-num">{formatArea(plot.area_ha, areaUnit)}</span>
              </>
            )}
            {ndvi != null && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: ndviColor(ndvi) }}
                  />
                  NDVI <span className="agro-num">{ndvi.toFixed(2)}</span>
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("mobileMenu.close")}
          className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] active:bg-[var(--panel-2)]"
        >
          <X size={18} />
        </button>
      </div>

      <PlotAlertList plotId={plot.id} size="md" className="mt-2" />

      <Button
        className="mt-3 min-h-[var(--touch-min)] w-full justify-center gap-1"
        onClick={() => {
          onClose();
          openPlotSheet(plot.id);
        }}
      >
        {t("plotPeek.openSheet")}
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
