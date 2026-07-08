import {
  type CropType,
  rampForIndex,
  type VegetationIndex,
} from "@agrogea/tools";
import { useAppStore } from "@geolibre/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { dssRiskRamp } from "../dss/dss-overlay";
import { buildColorbar, type ColorbarModel } from "./colorbar-model";

/**
 * Legenda a gradiente (colorbar) degli indici spettrali. Ancorata in basso a
 * destra sulla mappa: compare automaticamente quando un overlay raster di indice
 * è attivo (visibile) e si nasconde quando non ce ne sono. Una barra per indice.
 */
export function Colorbar() {
  const layers = useAppStore((s) => s.layers);

  // Una sola legenda per TIPO di indice, anche con più mappe/overlay dello
  // stesso indice attivi (es. NDVI su più plots/date): la rampa è
  // identica, quindi le voci duplicate vengono collassate.
  const indici = useMemo(() => {
    const set = new Set<VegetationIndex>();
    for (const l of layers) {
      if (
        l.visible &&
        l.metadata?.overlay === true &&
        typeof l.metadata?.indice === "string"
      ) {
        set.add(l.metadata.indice as VegetationIndex);
      }
    }
    return [...set];
  }, [layers]);

  // Idem per il rischio DSS: una legenda per crop distinta.
  const crops = useMemo(() => {
    const set = new Set<CropType>();
    for (const l of layers) {
      if (
        l.visible &&
        l.metadata?.dssOverlay === true &&
        typeof l.metadata?.crop === "string"
      ) {
        set.add(l.metadata.crop as CropType);
      }
    }
    return [...set];
  }, [layers]);

  if (indici.length === 0 && crops.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-10 right-3 z-30 flex flex-col gap-2">
      {crops.map((crop) => (
        <DssLegendCard key={crop} crop={crop} />
      ))}
      {indici.map((indice) => (
        <ColorbarCard
          key={indice}
          title={indice.toUpperCase()}
          model={buildColorbar(rampForIndex(indice))}
        />
      ))}
    </div>
  );
}

/** Legenda del rischio DSS: rampa verde→giallo→rosso, calibrata per crop. */
function DssLegendCard({ crop }: { crop: CropType }) {
  const { t } = useTranslation();
  const model = buildColorbar(dssRiskRamp(crop));
  return (
    <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2 shadow-[var(--sh-1)]">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
        {t("colorbar.dssRisk")}
      </p>
      <div className="flex gap-1.5">
        <div
          className="h-[120px] w-3.5 rounded-[3px] border border-[var(--line)]"
          style={{ background: model.cssGradient }}
        />
        <div className="flex h-[120px] flex-col justify-between text-[9px] text-[var(--ink-3)]">
          <span>{t("colorbar.critical")}</span>
          <span>{t("colorbar.warning")}</span>
          <span>{t("colorbar.optimal")}</span>
        </div>
      </div>
    </div>
  );
}

function ColorbarCard({
  title,
  model,
}: {
  title: string;
  model: ColorbarModel;
}) {
  return (
    <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2 shadow-[var(--sh-1)]">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">
        {title}
      </p>
      <div className="flex gap-1.5">
        <div
          className="h-[120px] w-3.5 rounded-[3px] border border-[var(--line)]"
          style={{ background: model.cssGradient }}
        />
        <div className="relative h-[120px] w-7 text-[9px] text-[var(--ink-3)]">
          {model.ticks.map((t) => (
            <span
              key={t.value}
              className="agro-num absolute left-0 -translate-y-1/2"
              style={{ bottom: `${t.pos * 100}%` }}
            >
              {t.value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
