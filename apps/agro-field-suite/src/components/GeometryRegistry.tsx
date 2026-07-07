import {
  type InfrastructureAsset,
  type Plot,
  type SoilSample,
  type SelectableKind,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import type { Geometry, Position } from "geojson";
import { Crosshair, MapPin, Route, Shapes } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

/**
 * Registro di tutte le geometrie dell'azienda attiva (Modulo 4 §gestione).
 * Elenca plots, infrastrutture e POI: il tap su una voce inquadra
 * l'elemento sulla mappa e apre la sua scheda di dettaglio/editing (da cui si
 * modifica la geometria/i metadati o si elimina in sicurezza). È la superficie
 * di gestione dichiarata dalla voce "Modifica / Elimina" del menu disegno.
 */

/** Bounding box [minLon, minLat, maxLon, maxLat] dalle coordinate GeoJSON. */
function geometryBounds(
  geometry: Geometry,
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const [x, y] = coords as Position;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) visit(c);
  };

  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const b = geometryBounds(g);
      if (b) {
        if (b[0] < minX) minX = b[0];
        if (b[1] < minY) minY = b[1];
        if (b[2] > maxX) maxX = b[2];
        if (b[3] > maxY) maxY = b[3];
      }
    }
  } else {
    visit(geometry.coordinates);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return [minX, minY, maxX, maxY];
}

interface Entry {
  id: string;
  kind: SelectableKind;
  label: string;
  meta: string;
  geometry: Geometry;
}

function appezzamentoEntry(a: Plot, t: TFunction): Entry {
  const area = a.area_ha;
  return {
    id: a.id,
    kind: "appezzamento",
    label: a.user_plot_name || t("registroGeometrie.plot"),
    meta: area != null ? `${area.toFixed(2)} ha` : "",
    geometry: a.geometry,
  };
}

function assetEntry(a: InfrastructureAsset, t: TFunction): Entry {
  return {
    id: a.id,
    kind: "infrastruttura",
    label: a.name || a.asset_type || t("registroGeometrie.infrastructure"),
    meta: [a.asset_type, a.length_m != null ? `${a.length_m} m` : null]
      .filter(Boolean)
      .join(" · "),
    geometry: a.geometry,
  };
}

function campionamentoEntry(c: SoilSample, t: TFunction): Entry {
  return {
    id: c.id,
    kind: "poi",
    label: t("registroGeometrie.samplingLabel", { id: c.id.slice(0, 8) }),
    meta: c.ph != null ? `pH ${c.ph}` : "POI",
    geometry: c.sampling_position,
  };
}

const KIND_ICON = {
  appezzamento: Shapes,
  infrastruttura: Route,
  poi: MapPin,
} as const;

export function GeometryRegistry({
  onClose,
  mapControllerRef,
}: {
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const assets = useAgroStore((s) => s.assets);
  const soilSamples = useAgroStore((s) => s.soilSamples);
  const selectFeatureOnMap = useAgroStore((s) => s.selectFeatureOnMap);

  const groups: { titolo: string; entries: Entry[] }[] = [
    { titolo: t("registroGeometrie.plots"), entries: plots.map((a) => appezzamentoEntry(a, t)) },
    { titolo: t("registroGeometrie.infrastructures"), entries: assets.map((a) => assetEntry(a, t)) },
    { titolo: t("registroGeometrie.pointsOfInterest"), entries: soilSamples.map((c) => campionamentoEntry(c, t)) },
  ];

  const totale =
    plots.length + assets.length + soilSamples.length;

  const locate = (geometry: Geometry) => {
    const bounds = geometryBounds(geometry);
    if (bounds) mapControllerRef.current?.fitBounds(bounds);
  };

  const open = (entry: Entry) => {
    locate(entry.geometry);
    // La selezione apre la scheda dettaglio; il registro resta in `openPanels`
    // ma viene nascosto dalla dashboard finché c'è una selezione, e riappare
    // alla chiusura della scheda (gestione di più elementi di fila).
    void selectFeatureOnMap({ kind: entry.kind, id: entry.id });
  };

  return (
    <FieldSheet title={t("registroGeometrie.title", { count: totale })} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {totale === 0 && (
          <p className="px-1 text-sm text-[var(--ink-3)]">
            {t("registroGeometrie.empty", { drawAction: t("nav.moduleDraw") })}
          </p>
        )}
        {groups.map(
          (g) =>
            g.entries.length > 0 && (
              <div key={g.titolo} className="flex flex-col gap-1">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                  {g.titolo} ({g.entries.length})
                </p>
                {g.entries.map((entry) => {
                  const Icon = KIND_ICON[entry.kind];
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => open(entry)}
                      className={cn(
                        "group flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] px-2.5 py-2 text-left",
                        "hover:border-[var(--accent)] hover:bg-[var(--panel-2)]",
                      )}
                    >
                      <Icon
                        size={16}
                        className="shrink-0 text-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {entry.label}
                        </span>
                        {entry.meta && (
                          <span className="block truncate text-[11px] text-[var(--ink-3)]">
                            {entry.meta}
                          </span>
                        )}
                      </span>
                      <Crosshair
                        size={15}
                        className="shrink-0 text-[var(--ink-4)] group-hover:text-[var(--accent)]"
                      />
                    </button>
                  );
                })}
              </div>
            ),
        )}
      </div>
    </FieldSheet>
  );
}
