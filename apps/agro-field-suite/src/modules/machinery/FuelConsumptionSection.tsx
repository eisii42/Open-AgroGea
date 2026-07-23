import { useAgroStore } from "@agrogea/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { machineConsumption } from "./machinery-view";

/**
 * Consumo carburante l/h del mezzo (§5.6): media e ultimo intervallo pieno-a-
 * pieno via l'engine puro `machineConsumption` (riuso di `machinery-view.ts`),
 * con badge di anomalia se l'ultimo intervallo devia oltre soglia dalla media.
 * Solo per i MEZZI: gli attrezzi non hanno rifornimenti propri.
 */
export function FuelConsumptionSection({ machineId }: { machineId: string }) {
  const { t } = useTranslation();
  // Selettore stabile: `fuelRefills` è il riferimento idratato dallo store
  // (cambia solo a ogni mutazione). Filtrare DENTRO al selettore creerebbe un
  // nuovo array a ogni render, rompendo la cache di `useSyncExternalStore`
  // (loop "getSnapshot should be cached"): il filtro va nel `useMemo` locale.
  const fuelRefills = useAgroStore((s) => s.fuelRefills);
  const refills = useMemo(
    () => fuelRefills.filter((r) => r.machine_id === machineId && !r.deleted_at),
    [fuelRefills, machineId],
  );
  const result = useMemo(() => machineConsumption(refills), [refills]);

  return (
    <section className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t("machinery.fuel.title")}
      </p>
      {result.avgLitersPerHour == null ? (
        <p className="py-2 text-center text-xs text-[var(--ink-3)]">
          {t("machinery.fuel.noData")}
        </p>
      ) : (
        <>
          <div className="flex gap-4">
            <div>
              <p className="text-[11px] text-[var(--ink-3)]">{t("machinery.fuel.avg")}</p>
              <p className="agro-num text-lg font-semibold text-[var(--ink)]">
                {result.avgLitersPerHour.toLocaleString("it-IT")}{" "}
                <span className="text-xs font-normal text-[var(--ink-3)]">
                  {t("machinery.fuel.perHour")}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--ink-3)]">{t("machinery.fuel.last")}</p>
              <p className="agro-num text-lg font-semibold text-[var(--ink)]">
                {result.lastLitersPerHour?.toLocaleString("it-IT")}{" "}
                <span className="text-xs font-normal text-[var(--ink-3)]">
                  {t("machinery.fuel.perHour")}
                </span>
              </p>
            </div>
          </div>
          <p className="text-[11px] text-[var(--ink-3)]">
            {t("machinery.fuel.samples", { count: result.sampleCount })}
          </p>
          {result.anomaly && (
            <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs font-medium text-[var(--warn)]">
              ⚠ {t("machinery.fuel.anomaly")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
