import { useAppStore } from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { Check, Eye, EyeOff, Globe, Map as MapIcon, Satellite, SquareDashed } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  type BaseChoice,
  type BasemapControls,
  useBasemapControls,
} from "../hooks/useBasemapControls";
import { AGRO_BASEMAP_IDS, isWmsBasemapLayer } from "../lib/basemaps";
import { BottomSheet } from "./BottomSheet";

const BASE_ICON: Record<BaseChoice, typeof MapIcon> = {
  stradario: MapIcon,
  satellite: Satellite,
};

/**
 * Foglio "Livelli" del telefono: in un solo posto lo sfondo (stradario,
 * satellite, WMS salvati, catasto) e la visibilità dei livelli dell'azienda.
 * Sul desktop lo stesso elenco sta nel popover Livelli (`DesktopMapTools`).
 *
 * Resta montato anche chiuso: la pulizia dei layer legata ai flag del layout
 * vive in `useBasemapControls`, che su telefono gira solo qui.
 */
export function MapLayersSheet({
  open,
  onClose,
  mapControllerRef,
}: {
  open: boolean;
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const basemap = useBasemapControls(mapControllerRef);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("mapLayers.title")}
      maxHeight="75dvh"
    >
      <MapLayersList basemap={basemap} className="px-3 pb-4 pt-3" />
    </BottomSheet>
  );
}

/**
 * Contenuto di Livelli: sfondo (stradario, satellite, WMS salvati), overlay
 * catastale e visibilità dei livelli dell'azienda. Lo usano il foglio del
 * telefono e il popover desktop (`DesktopMapTools`, variante `dense`); lo
 * stato dello sfondo arriva da chi monta `useBasemapControls`.
 */
export function MapLayersList({
  basemap,
  dense = false,
  className,
}: {
  basemap: BasemapControls;
  /** Righe compatte per il puntatore (desktop). */
  dense?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const layers = useAppStore((s) => s.layers);
  const setLayerVisibility = useAppStore((s) => s.setLayerVisibility);
  const iconSize = dense ? 16 : 18;

  // Solo i livelli dell'azienda: sfondi e overlay cartografici sono sopra.
  const dataLayers = layers.filter(
    (l) =>
      l.metadata?.agrogea === true &&
      !AGRO_BASEMAP_IDS.includes(l.id) &&
      !isWmsBasemapLayer(l),
  );

  return (
    <div className={cn("flex flex-col", dense ? "gap-3" : "gap-4", className)}>
      <Section title={t("basemapSwitcher.background")}>
        {basemap.baseOptions.map((o) => {
          const Icon = BASE_ICON[o.id];
          return (
            <ChoiceRow
              key={o.id}
              icon={<Icon size={iconSize} />}
              label={t(o.labelKey as never)}
              selected={basemap.current === o.id}
              onClick={() => basemap.selectBase(o.id)}
              dense={dense}
            />
          );
        })}
        {basemap.savedWms.map((item) => (
          <ChoiceRow
            key={item.id}
            icon={<Globe size={iconSize} />}
            label={item.name}
            hint="WMS"
            title={item.attribution || item.baseUrl}
            selected={basemap.activeWmsId === item.id}
            onClick={() => basemap.selectWms(item.id)}
            dense={dense}
          />
        ))}
      </Section>

      {basemap.showCadastre && (
        <Section title={t("basemapSwitcher.overlay")}>
          <ToggleRow
            icon={<SquareDashed size={iconSize} />}
            label={t("basemapSwitcher.cadastre")}
            on={basemap.cadastreOn}
            onClick={basemap.toggleCadastre}
            dense={dense}
          />
        </Section>
      )}

      <Section title={t("mapLayers.dataLayers")}>
        {dataLayers.length === 0 ? (
          <p className="px-3 text-sm text-[var(--ink-3)]">{t("mapLayers.empty")}</p>
        ) : (
          dataLayers.map((layer) => (
            <ToggleRow
              key={layer.id}
              label={layer.name}
              on={layer.visible}
              onClick={() => setLayerVisibility(layer.id, !layer.visible)}
              eye
              dense={dense}
            />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {title}
      </p>
      {children}
    </section>
  );
}

/** Scelta esclusiva (sfondo): spunta sulla voce attiva. */
function ChoiceRow({
  icon,
  label,
  hint,
  title,
  selected,
  onClick,
  dense,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  title?: string;
  selected: boolean;
  onClick: () => void;
  dense: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--r-2)] px-3 text-left",
        dense
          ? "min-h-9 text-sm hover:bg-[var(--panel-2)]"
          : "min-h-12 text-[15px] active:bg-[var(--panel-2)]",
        selected ? "font-medium text-[var(--accent)]" : "text-[var(--ink-2)]",
      )}
    >
      <span className={selected ? "text-[var(--accent)]" : "text-[var(--ink-3)]"}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="text-[10px] font-semibold uppercase text-[var(--ink-4)]">
          {hint}
        </span>
      )}
      <span className="flex w-5 justify-center">
        {selected && <Check size={dense ? 16 : 18} />}
      </span>
    </button>
  );
}

/** Interruttore (overlay, visibilità di un livello). */
function ToggleRow({
  icon,
  label,
  on,
  onClick,
  eye = false,
  dense,
}: {
  icon?: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
  /** Occhio aperto/chiuso invece dell'interruttore (visibilità livelli). */
  eye?: boolean;
  dense: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--r-2)] px-3 text-left text-[var(--ink-2)]",
        dense
          ? "min-h-9 text-sm hover:bg-[var(--panel-2)]"
          : "min-h-12 text-[15px] active:bg-[var(--panel-2)]",
      )}
    >
      {icon && <span className="text-[var(--ink-3)]">{icon}</span>}
      <span className={cn("min-w-0 flex-1 truncate", !on && "text-[var(--ink-4)]")}>
        {label}
      </span>
      {eye ? (
        on ? (
          <Eye size={dense ? 17 : 19} className="text-[var(--accent)]" />
        ) : (
          <EyeOff size={dense ? 17 : 19} className="text-[var(--ink-4)]" />
        )
      ) : (
        <span
          className={cn(
            "relative h-6 w-10 rounded-full transition-colors",
            on ? "bg-[var(--accent)]" : "bg-[var(--line-2,var(--line))]",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </span>
      )}
    </button>
  );
}
