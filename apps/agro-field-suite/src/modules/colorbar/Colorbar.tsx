import {
  type CropType,
  rampForIndex,
  relativeRamp,
  type VegetationIndex,
} from "@agrogea/tools";
import { useAppStore } from "@geolibre/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { dssRiskRamp } from "../dss/dss-overlay";
import { buildColorbar, type ColorbarModel } from "./colorbar-model";

/**
 * Legenda a gradiente (colorbar) degli indici spettrali. Ancorata in basso a
 * destra sulla mappa: compare automaticamente quando un layer celle indice
 * è active (visibile) e si nasconde quando non ce ne sono. Una barra per
 * indice: per le celle vettoriali (rendering `expression`) la color scale è
 * RELATIVA al dominio calcolato nella run (`metadata.domain`), così le tacche
 * mostrano il min/max reale dei value invece della scala assoluta 0..1.
 */
export function Colorbar() {
  const layers = useAppStore((s) => s.layers);

  // Una sola legenda per TIPO di indice, anche con più mappe/plots dello
  // stesso indice attivi nella stessa run: condividono lo stesso dominio
  // relativo, quindi le voci duplicate vengono collassate.
  const indices = useMemo(() => {
    const map = new Map<VegetationIndex, [number, number] | undefined>();
    for (const l of layers) {
      if (
        l.visible &&
        l.metadata?.overlay === true &&
        typeof l.metadata?.index === "string"
      ) {
        const index = l.metadata.index as VegetationIndex;
        const domain = Array.isArray(l.metadata.domain)
          ? (l.metadata.domain as [number, number])
          : undefined;
        // Preferisce un domain valido se già presente per l'indice: durante
        // la run i layer iniettati progressivamente possono momentaneamente
        // avere domain diversi, finché non convergono a fine calcolo.
        if (domain || !map.has(index)) map.set(index, domain ?? map.get(index));
      }
    }
    return [...map.entries()];
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

  if (indices.length === 0 && crops.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-10 right-3 z-30 flex flex-col gap-2">
      {crops.map((crop) => (
        <DssLegendCard key={crop} crop={crop} />
      ))}
      {indices.map(([index, domain]) => (
        <ColorbarCard
          key={index}
          title={index.toUpperCase()}
          model={buildColorbar(
            domain ? relativeRamp(index, domain) : rampForIndex(index),
          )}
          relative={domain != null}
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
  relative,
}: {
  title: string;
  model: ColorbarModel;
  relative?: boolean;
}) {
  const { t } = useTranslation();
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
          {model.ticks.map((tick, i) => (
            <span
              // Chiave posizionale: su un dominio relativo strettissimo due
              // tacche possono arrotondare allo stesso value.
              key={`${i}-${tick.value}`}
              className="agro-num absolute left-0 -translate-y-1/2"
              style={{ bottom: `${tick.pos * 100}%` }}
            >
              {tick.value}
            </span>
          ))}
        </div>
      </div>
      {relative && (
        <p className="mt-1 text-[9px] italic text-[var(--ink-4)]">
          {t("colorbar.relativeScale")}
        </p>
      )}
    </div>
  );
}
