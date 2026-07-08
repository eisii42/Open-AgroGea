import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import {
  Download,
  HardDrive,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type BBox,
  cachedTileCount,
  clearTileCache,
  downloadAreaTiles,
  estimateTileCount,
} from "../lib/offlineTileCache";

/**
 * Template tile di default: OpenFreeMap vector tiles (licenza ODbL, nessuna
 * API key richiesta). L'agronomo può cambiarla nelle impostazioni avanzate.
 */
const DEFAULT_TILE_TEMPLATE =
  "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";

const MIN_ZOOM = 8;
const DEFAULT_MAX_ZOOM = 15;

interface Props {
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}

/**
 * Strumento pre-cache area offline. Permette all'agronomo di scaricare le
 * tile di una zona geografica prima di uscire dalla connettività (ufficio →
 * field). Supporta sia inserimento manuale del bbox sia acquisizione
 * automatica dall'estensione current della mappa.
 */
export function OfflineAreaDialog({ onClose, mapControllerRef }: Props) {
  const { t } = useTranslation();
  const [west, setWest] = useState("-0.5");
  const [south, setSouth] = useState("43.5");
  const [east, setEast] = useState("0.5");
  const [north, setNorth] = useState("44.5");
  const [maxZoom, setMaxZoom] = useState(DEFAULT_MAX_ZOOM);
  const [tileTemplate, setTileTemplate] = useState(DEFAULT_TILE_TEMPLATE);

  const [estimated, setEstimated] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedCount, setCachedCount] = useState<number>(0);
  const [clearing, setClearing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void cachedTileCount().then(setCachedCount);
  }, []);

  // Quando l'estensione bbox cambia update la stima.
  useEffect(() => {
    const bbox = parseBbox();
    if (!bbox) {
      setEstimated(null);
      return;
    }
    setEstimated(estimateTileCount(bbox, MIN_ZOOM, maxZoom));
  }, [west, south, east, north, maxZoom]);

  function parseBbox(): BBox | null {
    const w = parseFloat(west);
    const s = parseFloat(south);
    const e = parseFloat(east);
    const n = parseFloat(north);
    if ([w, s, e, n].some(isNaN)) return null;
    if (w >= e || s >= n) return null;
    return { west: w, south: s, east: e, north: n };
  }

  /** Acquisisce il viewport current della mappa come bbox. */
  function useMapExtent() {
    const map = mapControllerRef.current?.getMap();
    if (!map) return;
    const b = map.getBounds();
    setWest(b.getWest().toFixed(5));
    setSouth(b.getSouth().toFixed(5));
    setEast(b.getEast().toFixed(5));
    setNorth(b.getNorth().toFixed(5));
  }

  async function avviaDownload() {
    const bbox = parseBbox();
    if (!bbox) {
      setError(t("offlineAreaDialog.invalidCoordinates"));
      return;
    }
    setError(null);
    setDownloading(true);
    setProgress({ done: 0, total: estimated ?? 0, failed: 0 });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await downloadAreaTiles(
        tileTemplate,
        bbox,
        MIN_ZOOM,
        maxZoom,
        (p) => setProgress({ done: p.done, total: p.total, failed: p.failed }),
        ctrl.signal,
      );
      void cachedTileCount().then(setCachedCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
      abortRef.current = null;
    }
  }

  async function svuotaCache() {
    setClearing(true);
    await clearTileCache();
    setCachedCount(0);
    setProgress(null);
    setClearing(false);
  }

  const bbox = parseBbox();
  const bboxOk = bbox !== null;
  const tooMany = (estimated ?? 0) > 8000;

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <div className="absolute inset-x-0 top-14 z-40 mx-auto max-w-sm overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)] sm:inset-x-auto sm:right-3 sm:w-80">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold">{t("offlineAreaDialog.title")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-[var(--panel-2)]"
        >
          <X size={15} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-xs text-[var(--ink-3)]">
          {t("offlineAreaDialog.description")}
        </p>

        {/* Acquisizione bbox da mappa */}
        <button
          type="button"
          onClick={useMapExtent}
          className="w-full rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
        >
          {t("offlineAreaDialog.useCurrentMapExtent")}
        </button>

        {/* Input bbox */}
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className="col-span-1" />
          <BboxInput label={t("offlineAreaDialog.north")} value={north} onChange={setNorth} />
          <div className="col-span-1" />
          <BboxInput label={t("offlineAreaDialog.west")} value={west} onChange={setWest} />
          <div className="col-span-1 flex items-center justify-center text-[10px] text-[var(--ink-4)]">
            bbox
          </div>
          <BboxInput label={t("offlineAreaDialog.east")} value={east} onChange={setEast} />
          <div className="col-span-1" />
          <BboxInput label={t("offlineAreaDialog.south")} value={south} onChange={setSouth} />
          <div className="col-span-1" />
        </div>

        {/* Zoom max */}
        <div className="flex items-center justify-between gap-3 text-xs">
          <label className="shrink-0 font-medium text-[var(--ink-2)]">
            {t("offlineAreaDialog.maxZoom")}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={17}
              value={maxZoom}
              onChange={(e) => setMaxZoom(Number(e.target.value))}
              className="w-24 accent-[var(--accent)]"
            />
            <span className="w-4 text-right font-mono text-[var(--accent)]">
              {maxZoom}
            </span>
          </div>
        </div>

        {/* Stima tile */}
        {estimated !== null && (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--r-1)] px-2 py-1.5 text-[11px]",
              tooMany
                ? "bg-[var(--warn-l)] text-[var(--warn)]"
                : "bg-[var(--panel-2)] text-[var(--ink-3)]",
            )}
          >
            {tooMany && <TriangleAlert size={12} />}
            {t("offlineAreaDialog.estimatedTiles", { count: estimated.toLocaleString() })}
            {tooMany && ` — ${t("offlineAreaDialog.reduceAreaOrZoom")}`}
          </div>
        )}

        {/* Barra progresso */}
        {progress && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--panel-3)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--ink-3)]">
              {progress.done} / {progress.total}
              {progress.failed > 0 && (
                <span className="text-[var(--warn)]">
                  {" "}
                  · {t("offlineAreaDialog.errorsCount", { count: progress.failed })}
                </span>
              )}
            </p>
          </div>
        )}

        {error && (
          <p className="text-[11px] text-[var(--danger)]">{error}</p>
        )}

        {/* Azioni */}
        <div className="flex gap-2">
          {downloading ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] border border-[var(--danger)] px-3 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-l)]"
            >
              {t("logbook.common.cancel")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void avviaDownload()}
              disabled={!bboxOk || tooMany}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] px-3 py-2 text-xs font-medium",
                bboxOk && !tooMany
                  ? "bg-[var(--accent)] text-white hover:opacity-90"
                  : "cursor-not-allowed bg-[var(--panel-3)] text-[var(--ink-4)]",
              )}
            >
              <Download size={13} />
              {t("offlineAreaDialog.download")}
            </button>
          )}
        </div>

        {/* Stato cache attuale */}
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[11px] text-[var(--ink-3)]">
          <span>{t("offlineAreaDialog.cachedTiles", { count: cachedCount.toLocaleString() })}</span>
          <button
            type="button"
            onClick={() => void svuotaCache()}
            disabled={cachedCount === 0 || clearing}
            className="text-[var(--danger)] underline-offset-2 hover:underline disabled:opacity-40"
          >
            {clearing ? <Loader2 size={11} className="animate-spin" /> : t("offlineAreaDialog.clear")}
          </button>
        </div>
      </div>
    </div>
  );
}

function BboxInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-center text-[9px] text-[var(--ink-4)]">
        {label}
      </label>
      <input
        type="number"
        step="0.0001"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-[var(--line)] bg-[var(--panel-2)] px-1.5 py-1 text-center text-[11px] font-mono text-[var(--ink-1)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
    </div>
  );
}
