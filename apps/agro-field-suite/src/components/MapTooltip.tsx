import { cropStyle, formatArea, useSettingsStore } from "@agrogea/core";
import { ndviColor } from "@agrogea/tools";
import { useTranslation } from "react-i18next";
import { cropIcon } from "../lib/cropIcon";
import type { HoverState } from "../hooks/useHoverTooltips";

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
      {kind === "appezzamento" && <AppezzamentoBody props={props} />}
      {kind === "infrastruttura" && <InfrastrutturaBody props={props} />}
      {kind === "poi" && <PoiBody props={props} />}
    </div>
  );
}

function AppezzamentoBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const areaUnit = useSettingsStore((s) => s.units.area);
  const nome = str(props.user_plot_name) ?? t("mapTooltip.plot");
  const crop = str(props.crop);
  const colturaKind = str(props.crop_kind);
  const area = num(props.area_ha);
  const ndvi = num(props.last_ndvi_mean);
  const { color: cropClr, icon: cropIconKey } = cropStyle(colturaKind);
  const CropIcon = cropIcon(cropIconKey);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold">{nome}</p>
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

function InfrastrutturaBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const nome = str(props.name) ?? str(props.asset_type) ?? t("mapTooltip.infrastructure");
  const tipo = str(props.asset_type);
  const categoria = str(props.category);
  const lunghezza = num(props.length_m);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold">{nome}</p>
      {tipo && <Row label={t("mapTooltip.type")} value={tipo} />}
      {lunghezza != null && (
        <Row
          label={t("mapTooltip.length")}
          value={<span className="agro-num">{lunghezza} m</span>}
        />
      )}
      <Row
        label={t("mapTooltip.status")}
        value={categoria === "mobile" ? t("mapTooltip.mobile") : t("mapTooltip.fixed")}
      />
    </div>
  );
}

function PoiBody({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation();
  const tipo = str(props.tipo_asset) ?? str(props.kind) ?? t("mapTooltip.poi");
  const id = str(props.id);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-semibold capitalize">{tipo}</p>
      {id && <Row label={t("mapTooltip.id")} value={<span className="agro-num">{id.slice(0, 8)}</span>} />}
    </div>
  );
}
