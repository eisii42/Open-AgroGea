import {
  assetStyle,
  cropStyle,
  formatArea,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { ndviColor, type VegetationIndex } from "@agrogea/tools";
import { useTranslation } from "react-i18next";
import { cropIcon } from "../lib/cropIcon";
import { assetIcon } from "../lib/assetIcon";
import type { HoverState } from "../hooks/useHoverTooltips";

/** Ordine di visualizzazione degli indici nel tooltip cella (solo quelli presenti). */
const INDEX_ORDER: VegetationIndex[] = ["ndvi", "ndre", "savi", "msavi2", "ndwi"];

/**
 * Popup fluttuante mostrato all'hover su un layer vettoriale (Modulo UI §2).
 * Posizionato vicino al cursore (coord. schermo relative al contenitore mappa),
 * con contenuto specifico per tipo di geometria. Puramente presentazionale:
 * i dati arrivano da `useHoverTooltips`.
 */

function num(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-[var(--ink-3)]">{label}</span>
      <span className="text-[12px] font-medium">{value}</span>
    </div>
  );
}

export function MapTooltip({ hover }: { hover: HoverState | null }) {
  if (!hover) return null;
  const { props, kind } = hover;

  // Posiziona il box accanto al cursore, leggermente in alto a destra.
  const style: React.CSSProperties = {
    left: hover.x + 14,
    top: hover.y + 14,
  };

  return (
    <div
      className="pointer-events-none absolute z-30 min-w-[180px] max-w-[240px] rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2.5 shadow-[var(--sh-pop)]"
      style={style}
    >
      {kind === "appezzamento" && <PlotBody props={props} />}
      {kind === "infrastruttura" && <InfrastructureBody props={props} />}
      {kind === "poi" && <PoiBody props={props} />}
      {kind === "indexCell" && <IndexCellBody props={props} />}
    </div>
  );
}

function PlotBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const areaUnit = useSettingsStore((s) => s.units.area);
  const name = str(props.user_plot_name) ?? t("mapTooltip.plot");
  const crop = str(props.crop);
  const cropKind = str(props.crop_kind);
  const area = num(props.area_ha);
  const ndvi = num(props.last_ndvi_mean);
  const { color: cropClr, icon: cropIconKey } = cropStyle(cropKind);
  const CropIcon = cropIcon(cropIconKey);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold">{name}</p>
      {crop && (
        <Row
          label={t("mapTooltip.crop")}
          value={
            <span className="inline-flex items-center gap-1.5">
              <CropIcon size={13} style={{ color: cropClr }} />
              {crop}
            </span>
          }
        />
      )}
      {area != null && (
        <Row
          label={t("mapTooltip.area")}
          value={<span className="agro-num">{formatArea(area, areaUnit)}</span>}
        />
      )}
      <Row
        label={t("mapTooltip.lastNdvi")}
        value={
          ndvi != null ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: ndviColor(ndvi) }}
              />
              <span className="agro-num">{ndvi.toFixed(3)}</span>
            </span>
          ) : (
            <span className="text-[var(--ink-4)]">—</span>
          )
        }
      />
    </div>
  );
}

function InfrastructureBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const name = str(props.name) ?? str(props.asset_type) ?? t("mapTooltip.infrastructure");
  const assetType = str(props.asset_type);
  const category = str(props.category);
  const lengthM = num(props.length_m);
  // Simbologia adattiva per tipo di asset (icona + colore), come per le crops
  // nel popup dell'appezzamento.
  const { color, icon } = assetStyle(assetType);
  const AssetIcon = assetIcon(icon);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <AssetIcon size={13} style={{ color }} />
        <span className="min-w-0 truncate">{name}</span>
      </p>
      {assetType && (
        <Row label={t("mapTooltip.type")} value={<span className="capitalize">{assetType}</span>} />
      )}
      {lengthM != null && (
        <Row
          label={t("mapTooltip.length")}
          value={<span className="agro-num">{lengthM} m</span>}
        />
      )}
      <Row
        label={t("mapTooltip.status")}
        value={category === "mobile" ? t("mapTooltip.mobile") : t("mapTooltip.fixed")}
      />
    </div>
  );
}

function PoiBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const poiType = str(props.tipo_asset) ?? str(props.kind) ?? t("mapTooltip.poi");
  const id = str(props.id);
  // Simbologia adattiva anche per i POI (soilSample, pozzi, trappole, …).
  const { color, icon } = assetStyle(poiType);
  const PoiIcon = assetIcon(icon);
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold capitalize">
        <PoiIcon size={13} style={{ color }} />
        <span className="min-w-0 truncate">{poiType}</span>
      </p>
      {id && <Row label={t("mapTooltip.id")} value={<span className="agro-num">{id.slice(0, 8)}</span>} />}
    </div>
  );
}

function IndexCellBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const plotId = str(props.plotId);
  const plot = plotId ? plots.find((p) => p.id === plotId) : undefined;
  const name = plot?.user_plot_name ?? t("mapTooltip.indexCell");
  const cellSizeM = num(props.cellSizeM);
  const indici = INDEX_ORDER.filter((ind) => num(props[ind]) != null);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold">{name}</p>
      {indici.map((ind) => (
        <Row
          key={ind}
          label={ind.toUpperCase()}
          value={<span className="agro-num">{(num(props[ind]) as number).toFixed(3)}</span>}
        />
      ))}
      {cellSizeM != null && (
        <p className="mt-0.5 text-[10px] text-[var(--ink-4)]">
          {t("mapTooltip.cellSize", { size: Math.round(cellSizeM) })}
        </p>
      )}
    </div>
  );
}
