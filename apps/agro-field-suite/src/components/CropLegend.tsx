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
import { Sprout } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cropIcon } from "../lib/cropIcon";

const LAYER_ID = "agrogea-appezzamenti";

interface LegendEntry {
  kind: string; // common_name (specie)
  color: string;
  iconKey: ReturnType<typeof cropStyle>["icon"];
  count: number;
}

export function CropLegend() {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const crops = useAgroStore((s) => s.crops);
  const layerVisible = useAppStore(
    (s) => s.layers.find((l) => l.id === LAYER_ID)?.visible ?? false,
  );
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="pointer-events-auto absolute bottom-10 left-3 z-30 max-w-[200px] rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-1)]">
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
              <div key={e.kind} className="flex items-center gap-2">
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
              </div>
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
