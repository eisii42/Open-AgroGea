import { useAgroStore } from "@agrogea/core";
import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import { cn } from "@geolibre/ui";
import { Globe, Image, Layers, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { addRasterOverlay } from "../lib/basemaps";
import { EXTERNAL_LAYER_FLAG } from "../modules/add-data/add-data";
import {
  loadGeoTiffOverlay,
  MAX_OVERLAY_SIDE,
} from "../modules/add-data/geotiff-overlay";
import { registerOrthophoto } from "../modules/add-data/orthophoto-registry";
import {
  fetchWmsCapabilities,
  type WmsCapabilities,
  wmsAttribution,
} from "../modules/add-data/wms";
import {
  deleteWmsBasemap,
  saveWmsBasemap,
  useSavedWmsBasemaps,
} from "../modules/add-data/wms-basemap-store";
import type { SavedWmsBasemap } from "../modules/add-data/wms-basemaps";

/**
 * Sezione "cartografia raster" di Aggiungi dati: un servizio **WMS** da
 * indirizzo, o un'**ortofoto GeoTIFF** da file.
 *
 * Sono due modi di portare sulla mappa la stessa cosa — un'immagine
 * georeferenziata — e stanno insieme per questo. La differenza pratica è che il
 * WMS resta sul server di chi lo pubblica (sempre aggiornato, richiede rete) e
 * l'ortofoto sta sul disco dell'utente (funziona offline, è ferma a quando è
 * stata scattata).
 *
 * Il WMS aggiunto qui si salva per l'azienda e diventa lo sfondo della mappa al
 * posto del satellite (vedi `wms-basemaps.ts`); l'elenco dei WMS salvati sta in
 * questa sezione, con modifica ed eliminazione, e si sceglie dal selettore di
 * sfondo.
 *
 * L'ortofoto caricata qui finisce anche nel registro di sessione, così la
 * scheda BCAA 8 del modulo Normativa può misurarci sopra senza chiedere di
 * ricaricare lo stesso file.
 */
export function AddRasterSection() {
  const { t } = useTranslation();
  const recordTransfer = useAgroStore((s) => s.recordTransfer);

  const [kind, setKind] = useState<"wms" | "orthophoto">("wms");
  const [url, setUrl] = useState("");
  const [capabilities, setCapabilities] = useState<WmsCapabilities | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const savedWms = useSavedWmsBasemaps();
  /** WMS salvato in modifica, o null se se ne sta aggiungendo uno nuovo. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setOutcome(null);
  };

  /**
   * Interroga il servizio: senza l'elenco, il nome del layer è indovinato.
   * `preselect` rimette la scelta di un WMS salvato che si sta modificando.
   */
  const loadCapabilities = async (address = url, preselect?: string) => {
    reset();
    if (!address.trim()) return;
    setBusy(true);
    setCapabilities(null);
    setSelected("");
    try {
      const found = await fetchWmsCapabilities(address.trim());
      setCapabilities(found);
      const keep = preselect && found.layers.some((l) => l.name === preselect);
      setSelected(keep ? preselect : (found.layers[0]?.name ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Salva il WMS (nuovo o modificato) e lo mostra come sfondo al posto del
   * satellite: resta memorizzato per l'azienda e torna alla riapertura.
   */
  const saveWms = () => {
    reset();
    if (!capabilities || !selected) return;
    const info = capabilities.layers.find((l) => l.name === selected);
    const title = info?.title ?? selected;
    saveWmsBasemap({
      id: editingId ?? crypto.randomUUID(),
      name: title,
      baseUrl: url.trim(),
      layerName: selected,
      version: capabilities.version,
      attribution: wmsAttribution(title, capabilities, url.trim()),
    });
    setOutcome(
      t(
        editingId
          ? "addDataControl.raster.wmsUpdated"
          : "addDataControl.raster.wmsAdded",
        { name: title },
      ),
    );
    setEditingId(null);
    setCapabilities(null);
    setUrl("");
  };

  const startEdit = (item: SavedWmsBasemap) => {
    setKind("wms");
    setEditingId(item.id);
    setUrl(item.baseUrl);
    void loadCapabilities(item.baseUrl, item.layerName);
  };

  const cancelEdit = () => {
    reset();
    setEditingId(null);
    setCapabilities(null);
    setUrl("");
  };

  const removeWms = (item: SavedWmsBasemap) => {
    reset();
    if (editingId === item.id) cancelEdit();
    deleteWmsBasemap(item.id);
    setOutcome(t("addDataControl.raster.wmsDeleted", { name: item.name }));
  };

  const addOrthophoto = async (file: File) => {
    reset();
    setBusy(true);
    try {
      const overlay = await loadGeoTiffOverlay(file);
      const id = `external-${crypto.randomUUID()}`;
      const layer: GeoLibreLayer = {
        id,
        name: file.name,
        type: "image",
        source: {
          type: "image",
          url: overlay.dataUrl,
          coordinates: overlay.coordinates,
        },
        visible: true,
        opacity: 1,
        style: { ...DEFAULT_LAYER_STYLE },
        metadata: {
          agrogea: true,
          [EXTERNAL_LAYER_FLAG]: true,
          formato: "tif",
          orthophoto: true,
          gsdM: overlay.gsdM,
          epsg: overlay.epsg,
        },
        sourcePath: `agrogea://${id}`,
      };
      addRasterOverlay(layer);
      // Il File resta disponibile alla scheda BCAA 8, che lo rilegge a piena
      // risoluzione: qui la texture è ridotta e non servirebbe a misurare.
      registerOrthophoto({
        layerId: id,
        file,
        gsdM: overlay.gsdM,
        addedAt: new Date().toISOString(),
      });
      await recordTransfer({
        operation_type: "import",
        file_format: "geotiff",
        file_name: file.name,
      });
      setOutcome(
        overlay.downscale > 1
          ? t("addDataControl.raster.orthophotoAddedScaled", {
              name: file.name,
              gsdCm: Math.round(overlay.gsdM * 100),
              side: MAX_OVERLAY_SIDE,
            })
          : t("addDataControl.raster.orthophotoAdded", {
              name: file.name,
              gsdCm: Math.round(overlay.gsdM * 100),
            }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-[var(--line)] pt-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        <Layers size={12} />
        {t("addDataControl.raster.title")}
      </p>

      <div className="mb-2 flex gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
        {(
          [
            { id: "wms", labelKey: "addDataControl.raster.wms" },
            { id: "orthophoto", labelKey: "addDataControl.raster.orthophoto" },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setKind(option.id);
              reset();
            }}
            className={cn(
              "flex-1 rounded-[var(--r-1)] px-2 py-1 text-[11px] font-medium",
              kind === option.id
                ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
                : "text-[var(--ink-3)]",
            )}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {kind === "wms" ? (
        <div className="flex flex-col gap-1.5">
          {/* WMS salvati: restano fra una sessione e l'altra, si modificano o
              si eliminano da qui e si scelgono come sfondo dal selettore. */}
          {savedWms.items.length > 0 && (
            <div className="mb-1 flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("addDataControl.raster.savedWms")}
              </p>
              {savedWms.items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[var(--r-2)] border px-2 py-1 text-xs",
                    editingId === item.id
                      ? "border-[var(--accent)]"
                      : "border-[var(--line)]",
                  )}
                >
                  <Globe size={12} className="shrink-0 text-[var(--ink-3)]" />
                  <span className="min-w-0 flex-1 truncate" title={item.baseUrl}>
                    {item.name}
                  </span>
                  {savedWms.activeId === item.id && (
                    <span className="text-[10px] font-medium text-[var(--accent)]">
                      {t("addDataControl.raster.wmsActive")}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    title={t("addDataControl.raster.editWms")}
                    aria-label={t("addDataControl.raster.editWms")}
                    className="rounded-[var(--r-1)] p-1 text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeWms(item)}
                    title={t("addDataControl.raster.deleteWms")}
                    aria-label={t("addDataControl.raster.deleteWms")}
                    className="rounded-[var(--r-1)] p-1 text-[var(--danger)] hover:bg-[var(--panel-2)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[var(--ink-4)]">
            {editingId
              ? t("addDataControl.raster.editingWmsHint")
              : t("addDataControl.raster.wmsHint")}
          </p>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("addDataControl.raster.wmsPlaceholder")}
            className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={() => void loadCapabilities()}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[var(--r-2)] border border-[var(--accent)] px-2 py-1.5 text-[11px] font-medium text-[var(--accent)]",
              (busy || !url.trim()) && "pointer-events-none opacity-60",
            )}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t("addDataControl.raster.loadLayers")}
          </button>

          {capabilities && (
            <>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-xs"
              >
                {capabilities.layers.map((layer) => (
                  <option key={layer.name} value={layer.name}>
                    {layer.title}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-[var(--ink-4)]">
                {t("addDataControl.raster.layersFound", {
                  count: capabilities.layers.length,
                  version: capabilities.version,
                })}
              </p>
              <button
                type="button"
                disabled={!selected}
                onClick={saveWms}
                className="rounded-[var(--r-2)] bg-[var(--accent)] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-60"
              >
                {editingId
                  ? t("addDataControl.raster.saveWmsChanges")
                  : t("addDataControl.raster.addToMap")}
              </button>
            </>
          )}
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-[var(--r-2)] px-2 py-1 text-[11px] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
            >
              {t("logbook.common.cancel")}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-[var(--ink-4)]">
            {t("addDataControl.raster.orthophotoHint")}
          </p>
          <label
            className={cn(
              "flex cursor-pointer items-center justify-center gap-2 rounded-[var(--r-2)] border border-dashed border-[var(--accent)] px-3 py-2.5 text-xs font-medium text-[var(--accent)]",
              busy && "pointer-events-none opacity-60",
            )}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("addDataControl.loadingEllipsis")}
              </>
            ) : (
              <>
                <Image size={14} />
                {t("addDataControl.raster.chooseTif")}
              </>
            )}
            <input
              type="file"
              accept=".tif,.tiff,image/tiff"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void addOrthophoto(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] text-[var(--danger)]">{error}</p>}
      {outcome && <p className="mt-1.5 text-[11px] text-[var(--ok)]">{outcome}</p>}
    </div>
  );
}
