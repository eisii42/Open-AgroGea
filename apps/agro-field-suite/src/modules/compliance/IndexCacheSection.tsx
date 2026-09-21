import { Button } from "@geolibre/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIndexCacheMaintenance } from "./useComplianceSources";

/**
 * Pulizia della cache delle scene, in fondo al pannello.
 *
 * ## Perché si può cancellare senza timore
 *
 * Questa cache è **interamente ricomputabile**: sono medie e raster derivati da
 * scene pubbliche, e si riscaricano dal catalogo. Non contiene un solo dato
 * inserito dall'utente, non passa dall'outbox e non sta nel backup. Svuotarla
 * costa tempo e rete alla prossima valutazione, non dati.
 *
 * ## Perché serve un pulsante
 *
 * Tre motivi concreti, tutti visti: una soglia di nuvolosità cambiata lascia in
 * cache scene che non si vogliono più usare; un appezzamento ridisegnato rende
 * le medie zonali vecchie sbagliate, perché calcolate su un poligono diverso; e
 * su un dispositivo da campo lo spazio finisce. La potatura automatica a 36
 * mesi non risolve nessuno dei tre, perché guarda l'età e non la pertinenza.
 */
export function IndexCacheSection({ plotId }: { plotId: string | null }) {
  const { t } = useTranslation();
  const { stats, busy, clear } = useIndexCacheMaintenance(plotId);
  const [confirming, setConfirming] = useState<"plot" | "all" | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  if (!stats) return null;

  const run = async (scope: "plot" | "all") => {
    const removed = await clear(scope);
    setCleared(removed);
    setConfirming(null);
  };

  return (
    <section className="mt-4 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t("compliance.cache.title")}
      </h3>
      <p className="text-[11px] text-[var(--ink-4)]">
        {t("compliance.cache.stats", {
          scenes: stats.scenes,
          mb: (stats.approximateBytes / 1048576).toFixed(1),
        })}
      </p>
      <p className="text-[10px] leading-snug text-[var(--ink-4)]">
        {t("compliance.cache.safe")}
      </p>

      {cleared != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--ink-3)]">
          {t("compliance.cache.cleared", { count: cleared })}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--ink-2)]">
            {t(
              confirming === "plot"
                ? "compliance.cache.confirmPlot"
                : "compliance.cache.confirmAll",
            )}
          </span>
          <Button
            variant="destructive"
            className="text-[11px]"
            disabled={busy}
            onClick={() => void run(confirming)}
          >
            {t("compliance.cache.confirm")}
          </Button>
          <Button
            variant="outline"
            className="text-[11px]"
            onClick={() => setConfirming(null)}
          >
            {t("compliance.cache.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {plotId && (
            <Button
              variant="outline"
              className="text-[11px]"
              disabled={busy}
              onClick={() => setConfirming("plot")}
            >
              {t("compliance.cache.clearPlot")}
            </Button>
          )}
          <Button
            variant="outline"
            className="text-[11px]"
            disabled={busy}
            onClick={() => setConfirming("all")}
          >
            {t("compliance.cache.clearAll")}
          </Button>
        </div>
      )}
    </section>
  );
}
