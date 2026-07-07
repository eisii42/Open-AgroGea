/**
 * Legenda colture: mostra, per gli appezzamenti dell'azienda attiva, l'elenco
 * delle specie presenti con il rispettivo colore ad hoc e icona, più la voce
 * neutra "Senza coltura" se almeno un appezzamento non ha coltura nell'annata.
 *
 * Si nasconde quando non ci sono appezzamenti o il layer è invisibile.
 */
import {
  cropStyle,
  NO_CROP_COLOR,
  useAgroStore,
} from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import { fillLayerId, lineLayerId, type MapController } from "@geolibre/map";
import { Sprout } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cropIcon } from "../../lib/cropIcon";

const LAYER_ID = "agrogea-appezzamenti";
const HIGHLIGHT_MS = 1000;

interface LegendEntry {
  kind: string; // common_name (specie)
  color: string;
  iconKey: ReturnType<typeof cropStyle>["icon"];
  count: number;
}

export function CropLegend({
  mapControllerRef,
}: {
  /** Se assente, il click sulle voci non evidenzia gli appezzamenti sulla mappa. */
  mapControllerRef?: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const crops = useAgroStore((s) => s.crops);
  const layerVisible = useAppStore(
    (s) => s.layers.find((l) => l.id === LAYER_ID)?.visible ?? false,
  );
  const [collapsed, setCollapsed] = useState(false);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Paint originali catturati alla PRIMA evidenziazione: se si clicca una
  // coltura diversa mentre un'altra è ancora illuminata, il ripristino deve
  // usare questi valori e non quelli (già alterati) del click precedente.
  const basePaint = useRef<{ fillOpacity: unknown; lineWidth: unknown } | null>(
    null,
  );

  // Ripristina i paint originali se il componente si smonta a evidenziazione
  // attiva (es. cambio schermata durante il timeout).
  useEffect(() => {
    return () => {
      if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    };
  }, []);

  const highlightKind = (kind: string) => {
    const map = mapControllerRef?.current?.getMap();
    if (!map) return;
    const fillId = fillLayerId(LAYER_ID);
    const lineId = lineLayerId(LAYER_ID);
    if (!map.getLayer(fillId) || !map.getLayer(lineId)) return;

    if (highlightTimeout.current) {
      clearTimeout(highlightTimeout.current);
    } else {
      basePaint.current = {
        fillOpacity: map.getPaintProperty(fillId, "fill-opacity"),
        lineWidth: map.getPaintProperty(lineId, "line-width"),
      };
    }
    const { fillOpacity: baseFillOpacity, lineWidth: baseLineWidth } =
      basePaint.current!;
    const match = ["==", ["get", "crop_kind"], kind] as const;

    map.setPaintProperty(fillId, "fill-opacity", [
      "case",
      match,
      0.9,
      typeof baseFillOpacity === "number" ? baseFillOpacity : 0.3,
    ]);
    map.setPaintProperty(lineId, "line-width", [
      "case",
      match,
      4,
      typeof baseLineWidth === "number" ? baseLineWidth : 1.5,
    ]);

    highlightTimeout.current = setTimeout(() => {
      map.setPaintProperty(fillId, "fill-opacity", baseFillOpacity ?? 0.3);
      map.setPaintProperty(lineId, "line-width", baseLineWidth ?? 1.5);
      highlightTimeout.current = null;
      basePaint.current = null;
    }, HIGHLIGHT_MS);
  };

  const { entries, uncropped } = useMemo(() => {
    const byKind = new Map<string, LegendEntry>();
    let noCrop = 0;
    for (const a of appezzamenti) {
      const camp = campiCampagna.find(
        (c) => c.plot_id === a.id && c.deleted_at == null,
      );
      const crop = camp ? crops.find((cr) => cr.id === camp.crop_id) : null;
      const kind = crop?.common_name ?? null;
      if (!kind) {
        noCrop += 1;
        continue;
      }
      const existing = byKind.get(kind);
      if (existing) {
        existing.count += 1;
      } else {
        const { color, icon } = cropStyle(kind);
        byKind.set(kind, { kind, color, iconKey: icon, count: 1 });
      }
    }
    return {
      entries: [...byKind.values()].sort((x, y) => y.count - x.count),
      uncropped: noCrop,
    };
  }, [appezzamenti, campiCampagna, crops]);

  if (!layerVisible || appezzamenti.length === 0) return null;
  if (entries.length === 0 && uncropped === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-10 left-3 z-10 max-w-[200px] rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-1)]">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-3)]"
      >
        <span>{t("cropLegend.title")}</span>
        <span className="text-[var(--ink-4)]">{collapsed ? "+" : "–"}</span>
      </button>
      {!collapsed && (
        <div className="flex max-h-[40dvh] flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
          {entries.map((e) => {
            const Icon = cropIcon(e.iconKey);
            return (
              <button
                key={e.kind}
                type="button"
                onClick={() => highlightKind(e.kind)}
                title={t("cropLegend.highlightHint")}
                className="flex items-center gap-2 rounded-[3px] py-0.5 text-left hover:bg-[var(--panel-2)]"
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]"
                  style={{ background: `${e.color}33`, border: `1.5px solid ${e.color}` }}
                >
                  <Icon size={10} style={{ color: e.color }} />
                </span>
                <span className="flex-1 truncate text-[11px] text-[var(--ink-1)]">
                  {e.kind}
                </span>
                <span className="agro-num text-[10px] text-[var(--ink-4)]">{e.count}</span>
              </button>
            );
          })}
          {uncropped > 0 && (
            <div className="flex items-center gap-2">
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]"
                style={{ background: `${NO_CROP_COLOR}33`, border: `1.5px solid ${NO_CROP_COLOR}` }}
              >
                <Sprout size={10} style={{ color: NO_CROP_COLOR }} />
              </span>
              <span className="flex-1 truncate text-[11px] text-[var(--ink-3)]">
                {t("cropLegend.noCrop")}
              </span>
              <span className="agro-num text-[10px] text-[var(--ink-4)]">{uncropped}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
