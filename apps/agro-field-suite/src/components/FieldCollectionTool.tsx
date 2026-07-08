/**
 * FieldCollectionTool — Rilievo in field (Scouting GPS).
 *
 * Punti di observation geotaggati (focolai di infezione, trappole,
 * anomalie colturali) salvati in `scouting_observations` (PGlite + outbox).
 * Le foto passano dall'adapter dell'edizione (`uploadScoutingPhoto`), che le
 * carica su uno storage remoto e ritorna l'URL; senza adapter (standalone)
 * il field foto è nascosto e l'osservazione si save senza immagine.
 */
import { controlPlane, type ScoutingObservation, useAgroStore } from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import {
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
  useAppStore,
} from "@geolibre/core";
import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import type { Feature, FeatureCollection, Point } from "geojson";
import {
  Camera,
  CheckCircle,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useGeoLocation } from "../hooks/useGeoLocation";

const SCOUTING_LAYER_ID = "agrogea-scouting";

interface ObsFormValues {
  note: string;
  captureCount: string;
  observationDate: string;
  photoFile: File | null;
}

type Mode = "idle" | "placing-gps" | "placing-map" | "form";

interface Props {
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}

export function FieldCollectionTool({ onClose, mapControllerRef }: Props) {
  const { t } = useTranslation();
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const layers = useAppStore((s) => s.layers);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const dal = useAgroStore((s) => s.dal);
  const scoutingOpenObservationId = useAgroStore(
    (s) => s.scoutingOpenObservationId,
  );
  const consumeScoutingOpen = useAgroStore((s) => s.consumeScoutingOpen);
  const setScoutingPlacing = useAgroStore((s) => s.setScoutingPlacing);

  const [mode, setMode] = useState<Mode>("idle");
  // Osservazione mostrata nella scheda dettaglio centrale (click su registro o
  // sul punto in mappa). `null` = nessuna scheda aperta.
  const [detailObs, setDetailObs] = useState<ScoutingObservation | null>(null);
  const [pendingPoint, setPendingPoint] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);
  const [form, setForm] = useState<ObsFormValues>({
    note: "",
    captureCount: "",
    observationDate: new Date().toISOString().slice(0, 10),
    photoFile: null,
  });
  const [saving, setSaving] = useState(false);
  const [observations, setObservations] = useState<ScoutingObservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const geo = useGeoLocation();

  useEffect(() => {
    void loadObservations();
  }, [dal, activeCompanyId]);

  // Click sul punto in mappa (useFeatureSelection → store): apre la scheda della
  // nota corrispondente, caricando il registro se necessario.
  useEffect(() => {
    if (!scoutingOpenObservationId) return;
    const apri = async () => {
      let lista = observations;
      if (lista.length === 0 && dal && activeCompanyId) {
        try {
          lista = await dal.listOsservazioniScouting(activeCompanyId);
          setObservations(lista);
          syncLayerToStore(lista);
        } catch {
          /* tabella non pronta */
        }
      }
      const trovata = lista.find((o) => o.id === scoutingOpenObservationId);
      if (trovata) setDetailObs(trovata);
      consumeScoutingOpen();
    };
    void apri();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutingOpenObservationId]);

  async function loadObservations() {
    if (!dal || !activeCompanyId) return;
    try {
      const obs = await dal.listOsservazioniScouting(activeCompanyId);
      setObservations(obs);
      syncLayerToStore(obs);
    } catch {
      // tabella non ancora creata (pre-v14): ignora
    }
  }

  const syncLayerToStore = useCallback(
    (obs: ScoutingObservation[]) => {
      const features: Feature<Point>[] = obs.map((o) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [o.lng, o.lat] },
        properties: {
          id: o.id,
          note: o.note,
          captureCount: o.capture_count,
          observationDate: o.observation_date,
          hasPhoto: !!o.photo_url,
          accuracyM: o.accuracy_m,
        },
      }));
      const fc: FeatureCollection = { type: "FeatureCollection", features };
      const existing = layers.find((l) => l.id === SCOUTING_LAYER_ID);
      if (existing) {
        updateLayer(SCOUTING_LAYER_ID, { geojson: fc });
      } else {
        const layer: GeoLibreLayer = {
          id: SCOUTING_LAYER_ID,
          name: t("fieldCollectionTool.layerName"),
          type: "geojson",
          source: { type: "geojson" },
          visible: true,
          opacity: 1,
          style: { ...DEFAULT_LAYER_STYLE, circleRadius: 8, fillColor: "#f59e0b", strokeColor: "#fff", strokeWidth: 2 },
          metadata: { agrogea: true, scouting: true },
          geojson: fc,
          sourcePath: `agrogea://${SCOUTING_LAYER_ID}`,
        };
        addLayer(layer);
      }
    },
    [layers, addLayer, updateLayer],
  );

  // Click handler tap-mappa. Mentre è armato, segnaliamo allo store la modalità
  // di posizionamento: così il click serve a posare la nota e la selezione
  // globale delle feature (apertura Quaderno) resta inibita.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map || mode !== "placing-map") return;
    setScoutingPlacing(true);
    const handler = (e: { lngLat: { lat: number; lng: number } }) => {
      setPendingPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setMode("form");
    };
    map.once("click", handler);
    return () => {
      setScoutingPlacing(false);
      map.off("click", handler as Parameters<typeof map.off>[1]);
    };
  }, [mode, mapControllerRef, setScoutingPlacing]);

  async function handleGpsClick() {
    setError(null);
    setMode("placing-gps");
    try {
      const pos = await geo.requestPosition();
      setPendingPoint({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      setMode("form");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fieldCollectionTool.gpsError"));
      setMode("idle");
    }
  }

  /** Carica la foto sullo storage remoto dell'edizione e ritorna l'URL. */
  async function uploadPhoto(
    file: File,
    obsId: string,
    tenantId: string,
  ): Promise<string | null> {
    const upload = controlPlane().uploadScoutingPhoto;
    if (!upload) return null;
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${tenantId}/${activeCompanyId}/${obsId}.${ext}`;
      return await upload(path, file);
    } catch {
      return null;
    }
  }

  async function save() {
    if (!pendingPoint || !activeCompanyId || !dal) return;
    setSaving(true);
    setError(null);
    try {
      // Generiamo l'id PRIMA: serve al path della foto, così possiamo caricarla
      // su Storage e fare un UNICO insert con photo_url già valorizzato — che
      // passa interamente dall'outbox (niente patch local-only non sincronizzata).
      const id = crypto.randomUUID();
      const photoUrl = form.photoFile
        ? await uploadPhoto(form.photoFile, id, dal.tenantId)
        : null;

      const obs = await dal.saveScoutingObservation({
        id,
        company_id: activeCompanyId,
        lat: pendingPoint.lat,
        lng: pendingPoint.lng,
        accuracy_m: pendingPoint.accuracy ?? null,
        note: form.note || null,
        capture_count: form.captureCount ? Number(form.captureCount) : null,
        observation_date: form.observationDate || null,
        photo_url: photoUrl,
      });

      const updated = [obs, ...observations];
      setObservations(updated);
      syncLayerToStore(updated);
      setSuccess(
        t("fieldCollectionTool.savedSuccess", {
          lat: pendingPoint.lat.toFixed(5),
          lng: pendingPoint.lng.toFixed(5),
        }),
      );
      setPendingPoint(null);
      setForm({ note: "", captureCount: "", observationDate: new Date().toISOString().slice(0, 10), photoFile: null });
      setMode("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fieldCollectionTool.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!dal) return;
    try {
      // Elimina l'eventuale foto dallo storage remoto (se l'edizione ne ha uno).
      const obs = observations.find((o) => o.id === id);
      if (obs?.photo_url) {
        await controlPlane().removeScoutingPhoto?.(obs.photo_url);
      }
      await dal.deleteScoutingObservation(id);
      const updated = observations.filter((o) => o.id !== id);
      setObservations(updated);
      syncLayerToStore(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fieldCollectionTool.deleteError"));
    }
  }

  function annulla() {
    setPendingPoint(null);
    setMode("idle");
    setError(null);
  }

  return (
    <>
      <FieldSheet
        title={t("fieldCollectionTool.title")}
        onClose={onClose}
        footer={
          mode === "form" && pendingPoint ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={annulla}
                className="flex-1 rounded-[var(--r-2)] border border-[var(--line)] py-2.5 text-sm font-medium hover:bg-[var(--panel-2)]"
              >
                {t("logbook.common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent)] py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                {t("fieldCollectionTool.saveObservation")}
              </button>
            </div>
          ) : undefined
        }
      >
        {/* Form compilazione punto */}
        {mode === "form" && pendingPoint && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 rounded-[var(--r-2)] bg-[var(--accent-l)] px-3 py-2 text-xs font-medium text-[var(--accent)]">
              <CheckCircle size={13} />
              {pendingPoint.lat.toFixed(5)}, {pendingPoint.lng.toFixed(5)}
              {pendingPoint.accuracy && (
                <span className="ml-1 font-normal text-[var(--ink-3)]">±{Math.round(pendingPoint.accuracy)} m</span>
              )}
            </div>

            <Field label={t("fieldCollectionTool.notesSymptoms")}>
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("fieldCollectionTool.describeObservation")}
                className="w-full resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </Field>

            <Field label={t("fieldCollectionTool.captureCount")}>
              <input
                type="number"
                min={0}
                value={form.captureCount}
                onChange={(e) => setForm((f) => ({ ...f, captureCount: e.target.value }))}
                placeholder={t("fieldCollectionTool.captureCountPlaceholder")}
                className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </Field>

            <Field label={t("fieldCollectionTool.observationDate")}>
              <input
                type="date"
                value={form.observationDate}
                onChange={(e) => setForm((f) => ({ ...f, observationDate: e.target.value }))}
                className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </Field>

            {/* Campo foto solo se l'edizione ha uno storage remoto registrato:
                senza uploader la foto non avrebbe dove essere caricata. */}
            {controlPlane().uploadScoutingPhoto && (
              <Field label={t("fieldCollectionTool.photo")}>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setForm((f) => ({ ...f, photoFile: e.target.files?.[0] ?? null }))
                  }
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-[var(--r-2)] border border-dashed px-3 py-2.5 text-sm",
                    form.photoFile
                      ? "border-[var(--ok)] text-[var(--ok)]"
                      : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
                  )}
                >
                  <Camera size={15} />
                  {form.photoFile ? `${form.photoFile.name} ✓` : t("fieldCollectionTool.takeOrChoosePhoto")}
                </button>
              </Field>
            )}

            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}

        {/* Modalità selezione / GPS */}
        {(mode === "idle" || mode === "placing-gps" || mode === "placing-map") && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--ink-3)]">
              {t("fieldCollectionTool.placeObservationHint")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleGpsClick()}
                disabled={mode === "placing-gps"}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] border py-2.5 text-sm font-medium",
                  mode === "placing-gps"
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--line)] hover:bg-[var(--panel-2)]",
                )}
              >
                {mode === "placing-gps" ? <Loader2 size={15} className="animate-spin" /> : <Navigation size={15} />}
                GPS
              </button>
              <button
                type="button"
                onClick={() => { setError(null); setMode("placing-map"); }}
                disabled={mode === "placing-map"}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--r-2)] border py-2.5 text-sm font-medium",
                  mode === "placing-map"
                    ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                    : "border-[var(--line)] hover:bg-[var(--panel-2)]",
                )}
              >
                <MapPin size={15} />
                {mode === "placing-map" ? t("fieldCollectionTool.tapMapEllipsis") : t("fieldCollectionTool.tapMap")}
              </button>
            </div>
            {mode === "placing-map" && (
              <p className="text-center text-[11px] text-[var(--accent)]">
                {t("fieldCollectionTool.tapMapToPlace")}
              </p>
            )}
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
            {success && <p className="text-xs text-[var(--ok)]">{success}</p>}
          </div>
        )}

        {/* Registro rilievi */}
        {observations.length > 0 && (
          <div className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("fieldCollectionTool.observationRegister", { count: observations.length })}
            </p>
            <div className="space-y-1.5">
              {observations.map((o) => (
                <div
                  key={o.id}
                  className="flex items-start gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] px-2.5 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setDetailObs(o)}
                    className="min-w-0 flex-1 space-y-0.5 text-left"
                    title={t("fieldCollectionTool.openObservationCard")}
                  >
                    <p className="truncate text-[11px] font-medium text-[var(--ink-1)]">
                      {Number(o.lat).toFixed(4)}, {Number(o.lng).toFixed(4)}
                    </p>
                    {o.note && (
                      <p className="line-clamp-2 text-[10px] text-[var(--ink-3)]">{o.note}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--ink-4)]">
                      {o.capture_count != null && <span>{t("fieldCollectionTool.capturesCount", { count: o.capture_count })}</span>}
                      {o.observation_date && <span>{String(o.observation_date).slice(0, 10)}</span>}
                      {o.photo_url && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--accent)]">
                          <Camera size={10} /> {t("fieldCollectionTool.photoLabel")}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(o.id)}
                    className="shrink-0 rounded p-1 text-[var(--ink-4)] hover:bg-[var(--panel-3)] hover:text-[var(--danger)]"
                    title={t("fieldCollectionTool.deleteObservation")}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {observations.length === 0 && mode === "idle" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-[var(--ink-4)]">
            <Plus size={28} className="opacity-30" />
            <p>{t("fieldCollectionTool.noObservationsYet")}</p>
          </div>
        )}
      </FieldSheet>

      {/* Scheda dettaglio della nota (centro schermo). */}
      {detailObs && (
        <ScoutingDetailCard
          obs={detailObs}
          onClose={() => setDetailObs(null)}
          onDelete={async () => {
            await remove(detailObs.id);
            setDetailObs(null);
          }}
        />
      )}
    </>
  );
}

/** Scheda dettaglio di una nota geotaggata: modale centrale con tutte le info. */
function ScoutingDetailCard({
  obs,
  onClose,
  onDelete,
}: {
  obs: ScoutingObservation;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-sm flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold">{t("fieldCollectionTool.title")}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[var(--panel-2)]">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {obs.photo_url && (
            <a href={obs.photo_url} target="_blank" rel="noreferrer" className="block">
              {/* biome-ignore lint/a11y/useAltText: foto di rilievo utente */}
              <img
                src={obs.photo_url}
                alt={t("fieldCollectionTool.observationPhotoAlt")}
                className="max-h-56 w-full rounded-[var(--r-2)] border border-[var(--line)] object-cover"
              />
            </a>
          )}

          <DetailRow label={t("fieldCollectionTool.coordinates")}>
            <span className="agro-num">
              {Number(obs.lat).toFixed(6)}, {Number(obs.lng).toFixed(6)}
            </span>
          </DetailRow>
          {obs.accuracy_m != null && (
            <DetailRow label={t("fieldCollectionTool.gpsAccuracy")}>
              <span className="agro-num">±{Math.round(Number(obs.accuracy_m))} m</span>
            </DetailRow>
          )}
          {obs.observation_date && (
            <DetailRow label={t("fieldCollectionTool.observationDate")}>
              {String(obs.observation_date).slice(0, 10)}
            </DetailRow>
          )}
          {obs.capture_count != null && (
            <DetailRow label={t("fieldCollectionTool.captureCount")}>
              <span className="agro-num">{obs.capture_count}</span>
            </DetailRow>
          )}
          {obs.note && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-[var(--ink-3)]">{t("fieldCollectionTool.notesSymptoms")}</p>
              <p className="whitespace-pre-wrap rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-1)]">
                {obs.note}
              </p>
            </div>
          )}
          {!obs.note && obs.capture_count == null && !obs.photo_url && (
            <p className="text-center text-xs text-[var(--ink-4)]">
              {t("fieldCollectionTool.noAdditionalDetails")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--line)] px-4 py-3">
          <button
            type="button"
            onClick={() => void onDelete()}
            className="flex items-center gap-1.5 rounded-[var(--r-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-l,#fee2e2)]"
          >
            <Trash2 size={13} /> {t("fieldCollectionTool.delete")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--panel-2)]"
          >
            {t("fieldCollectionTool.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-[var(--ink-3)]">{label}</span>
      <span className="text-right text-[13px] font-medium text-[var(--ink-1)]">{children}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--ink-3)]">{label}</label>
      {children}
    </div>
  );
}
