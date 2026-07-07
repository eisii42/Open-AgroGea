import { type FileFormat, useAgroStore } from "@agrogea/core";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import { cn } from "@geolibre/ui";
import type { FeatureCollection } from "geojson";
import { Database, Download, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ADD_DATA_ACCEPT,
  EXTERNAL_LAYER_FLAG,
  LARGE_FILE_THRESHOLD_BYTES,
  estensioneFile,
  formatoDaNomeFile,
  isGeoJson,
  toFeatureCollection,
} from "../modules/add-data/add-data";
import { importaFascicoloSian } from "../modules/sian/import-dossier";
import {
  combinaLayer,
  type ExportFormat,
  downloadArtifact,
  serializzaVettoriale,
} from "../services/gis/geo-export";
import { TransferTagsFeed } from "./TransferTagsFeed";

type ModoImport = "mappa" | "sian";

const SIAN_ACCEPT = ".zip,.shp,.csv,.tsv";

/** Formati della filiera export universale (Modulo 4). */
const EXPORT_FORMATI: { format: ExportFormat; label: string }[] = [
  { format: "geojson", label: "GeoJSON" },
  { format: "kml", label: "KML" },
  { format: "shapefile", label: "Shapefile" },
  { format: "csv", label: "CSV" },
  { format: "gpx", label: "GPX" },
];

/**
 * "Add Data" globale (GeoLibre 1.2) nella Top Bar della field suite. È l'unico
 * punto di ingresso dei file cartografici esterni: ogni caricamento (GeoJSON,
 * Shapefile, …) viene registrato nel Layer Store NATIVO di GeoLibre marcato
 * `metadata[EXTERNAL_LAYER_FLAG]`, così il pannello Geo-compliance lo trova nel
 * suo selettore, e tracciato nel giornale dei trasferimenti (tag temporale).
 *
 * I GeoJSON sono parsati in JS (zero dipendenze). I formati binari
 * (Shapefile/PBF/…) passano dal motore DuckDB Spatial, caricato on-demand per
 * non gravare sul bundle iniziale.
 */
export function AddDataControl() {
  const { t } = useTranslation();
  const addLayer = useAppStore((s) => s.addLayer);
  const layers = useAppStore((s) => s.layers);
  const registraTrasferimento = useAgroStore((s) => s.registraTrasferimento);
  const campagnaAttiva = useAgroStore((s) => s.campagnaAttiva);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);

  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<ModoImport>("mappa");
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [warnFile, setWarnFile] = useState<File | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  /** Legge il file → FeatureCollection (GeoJSON in JS, resto via DuckDB). */
  async function leggiFeatureCollection(file: File): Promise<FeatureCollection> {
    if (isGeoJson(file.name)) {
      const fc = toFeatureCollection(JSON.parse(await file.text()));
      if (!fc) {
        throw new Error(t("addDataControl.invalidGeoJson"));
      }
      return fc;
    }
    // Formati binari: motore spaziale (Shapefile/GeoParquet/PBF via OGR/Spatial).
    const { SpatialAnalysisEngine } = await import(
      "../services/gis/SpatialAnalysisEngine"
    );
    const data = new Uint8Array(await file.arrayBuffer());
    const fc = await SpatialAnalysisEngine.instance().loadVectorFileAsFeatureCollection(
      { name: file.name, extension: estensioneFile(file.name), data },
    );
    if (fc.features.length === 0) {
      throw new Error(t("addDataControl.noReadableGeometries"));
    }
    return fc;
  }

  async function onFile(file: File, forceAccept = false) {
    setErrore(null);
    setEsito(null);
    setWarnFile(null);
    const formato = formatoDaNomeFile(file.name);
    if (!formato) {
      setErrore(t("addDataControl.unrecognizedFormat", { name: file.name }));
      return;
    }
    // Avviso file massivo (>50 MB): su mobile può bloccare la WebView.
    if (!forceAccept && file.size > LARGE_FILE_THRESHOLD_BYTES) {
      setWarnFile(file);
      return;
    }
    setBusy(true);
    try {
      const fc = await leggiFeatureCollection(file);
      const id = `external-${crypto.randomUUID()}`;
      const layer: GeoLibreLayer = {
        id,
        name: file.name,
        type: "geojson",
        source: { type: "geojson" },
        visible: true,
        opacity: 1,
        style: { ...DEFAULT_LAYER_STYLE },
        // Marcatori: agrogea (proiezione interna) + external (caricato via Add
        // Data) + formato, letti dal selettore della Geo-compliance.
        metadata: { agrogea: true, [EXTERNAL_LAYER_FLAG]: true, formato },
        geojson: fc,
        sourcePath: `agrogea://${id}`,
      };
      addLayer(layer);
      await registraTrasferimento({
        operation_type: "import",
        file_format: formato,
        file_name: file.name,
      });
      setEsito(
        t("addDataControl.fileAdded", {
          name: file.name,
          count: fc.features.length,
        }),
      );
    } catch (err) {
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Export in blocco dell'intera configurazione cartografica aziendale (tutti i
   * layer proiettati nello store: appezzamenti, infrastrutture, POI, raccolte,
   * mappe DSS…) in uno dei formati GIS della filiera. Serializzazione pura,
   * tracciata nel giornale dei trasferimenti.
   */
  async function esportaConfigurazione(format: ExportFormat) {
    setErrore(null);
    setEsito(null);
    const esportabili = layers.filter(
      (l) => l.metadata?.agrogea === true && l.geojson,
    );
    const fc = combinaLayer(
      esportabili.map((l) => ({
        id: l.id,
        name: l.name,
        geojson: l.geojson ?? null,
      })),
    );
    if (fc.features.length === 0) {
      setErrore(t("addDataControl.noLayersToExport"));
      return;
    }
    setBusy(true);
    try {
      const artifact = serializzaVettoriale(fc, format, "agrogea_configurazione");
      downloadArtifact(artifact);
      await registraTrasferimento({
        operation_type: "export",
        file_format: format as FileFormat,
        file_name: artifact.filename,
      });
      setEsito(
        t("addDataControl.configExported", {
          name: artifact.filename,
          count: fc.features.length,
        }),
      );
    } catch (err) {
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Import del Fascicolo SIAN: file → campi_campagna (create-or-populate). */
  async function onFileSian(file: File) {
    setErrore(null);
    setEsito(null);
    if (!aziendaAttivaId) {
      setErrore(t("addDataControl.selectCompanyFirst"));
      return;
    }
    setBusy(true);
    try {
      const { SianImportParser } = await import(
        "../services/gis/SianImportParser"
      );
      const { formato, campi } = await SianImportParser.parse(file);
      if (campi.length === 0) {
        setErrore(t("addDataControl.noFieldsRecognized"));
        return;
      }
      const esitoImport = await importaFascicoloSian(campi, campagnaAttiva);
      await registraTrasferimento({
        operation_type: "import",
        file_format: formato === "csv" ? "csv" : "shapefile",
        file_name: file.name,
      });
      setEsito(
        esitoImport.saltati
          ? t("addDataControl.sianImportResultSkipped", {
              year: campagnaAttiva,
              created: esitoImport.creati,
              updated: esitoImport.aggiornati,
              skipped: esitoImport.saltati,
            })
          : t("addDataControl.sianImportResult", {
              year: campagnaAttiva,
              created: esitoImport.creati,
              updated: esitoImport.aggiornati,
            }),
      );
    } catch (err) {
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("addDataControl.addDataToMap")}
        className={cn(
          "flex min-h-[36px] items-center gap-1.5 rounded-[var(--r-2)] border px-2 text-sm font-medium",
          open
            ? "border-[var(--accent)] text-[var(--accent)]"
            : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
        )}
      >
        <Database size={15} className="shrink-0" />
        <span className="hidden sm:inline">{t("addDataControl.addData")}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-80 overflow-hidden rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-pop)]">
          <p className="mb-1 text-sm font-semibold">{t("addDataControl.addData")}</p>

          {/* Selettore modalità: layer cartografico vs import Fascicolo SIAN. */}
          <div className="mb-2.5 flex gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-0.5">
            {([
              { id: "mappa", labelKey: "addDataControl.mapLayer" },
              { id: "sian", labelKey: "addDataControl.sianFile" },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setModo(m.id);
                  setErrore(null);
                  setEsito(null);
                }}
                className={cn(
                  "flex-1 rounded-[var(--r-1)] px-2 py-1 text-xs font-medium",
                  modo === m.id
                    ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
                    : "text-[var(--ink-3)]",
                )}
              >
                {t(m.labelKey as never)}
              </button>
            ))}
          </div>

          <p className="mb-2.5 text-xs text-[var(--ink-4)]">
            {modo === "mappa"
              ? t("addDataControl.mapModeDescription")
              : t("addDataControl.sianModeDescription", { year: campagnaAttiva })}
          </p>

          <label
            className={cn(
              "flex cursor-pointer items-center justify-center gap-2 rounded-[var(--r-2)] border border-dashed border-[var(--accent)] px-3 py-3 text-sm font-medium text-[var(--accent)]",
              busy && "pointer-events-none opacity-60",
            )}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {modo === "sian"
                  ? t("addDataControl.importInProgress")
                  : t("addDataControl.loadingEllipsis")}
              </>
            ) : (
              <>
                <Upload size={16} />
                {t("addDataControl.chooseFile")}
              </>
            )}
            <input
              type="file"
              accept={modo === "sian" ? SIAN_ACCEPT : ADD_DATA_ACCEPT}
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void (modo === "sian" ? onFileSian(f) : onFile(f));
                e.target.value = "";
              }}
            />
          </label>

          {/* Warning file massivo (>50 MB): l'utente conferma o annulla. */}
          {warnFile && (
            <div className="mt-2 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] p-2.5 text-xs text-[var(--warn)]">
              <p className="font-semibold">
                {t("addDataControl.largeFile", {
                  size: (warnFile.size / 1024 / 1024).toFixed(0),
                })}
              </p>
              <p className="mt-0.5 text-[11px]">
                {t("addDataControl.largeFileWarning")}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void onFile(warnFile, true)}
                  className="rounded-[var(--r-1)] bg-[var(--warn)] px-2.5 py-1 text-[11px] font-medium text-white"
                >
                  {t("addDataControl.uploadAnyway")}
                </button>
                <button
                  type="button"
                  onClick={() => setWarnFile(null)}
                  className="rounded-[var(--r-1)] border border-[var(--warn)] px-2.5 py-1 text-[11px] font-medium"
                >
                  {t("logbook.common.cancel")}
                </button>
              </div>
            </div>
          )}
          {errore && (
            <p className="mt-2 text-xs text-[var(--danger)]">{errore}</p>
          )}
          {esito && <p className="mt-2 text-xs text-[var(--ok)]">{esito}</p>}

          {/* Export in blocco della configurazione cartografica aziendale */}
          <div className="mt-3 border-t border-[var(--line)] pt-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              <Download size={12} />
              {t("addDataControl.exportConfig")}
            </p>
            <p className="mb-1.5 text-[11px] text-[var(--ink-4)]">
              {t("addDataControl.exportConfigDescription")}
            </p>
            <div className="flex flex-wrap gap-1">
              {EXPORT_FORMATI.map((f) => (
                <button
                  key={f.format}
                  type="button"
                  disabled={busy}
                  onClick={() => void esportaConfigurazione(f.format)}
                  className={cn(
                    "rounded-[var(--r-1)] border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                    busy && "pointer-events-none opacity-60",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-[var(--line)] pt-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("addDataControl.recentActivity")}
            </p>
            <TransferTagsFeed empty />
          </div>
        </div>
      )}
    </div>
  );
}
