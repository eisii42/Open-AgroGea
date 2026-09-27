import {
  ParcelAlreadyAdoptedError,
  useAgroStore,
} from "@agrogea/core";
import {
  createParcelSource,
  PARCEL_SOURCE_CATALOG,
  type BBox,
  type Parcel,
  type ParcelSourceRecord,
} from "@agrogea/parcel";
import { FieldSheet } from "@agrogea/ui";
import { Button } from "@geolibre/ui";
import type { MapController } from "@geolibre/map";
import { Crosshair, Loader2, Search } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createParcelSourceDeps } from "../../lib/parcel-source-transport";
import { useTenantCountry } from "../../hooks/useTenantCountry";
import {
  boundsToBBox,
  candidateSummary,
  INTERACTIVE_MAX_FEATURES,
  orderSourcesForCountry,
  suggestedPlotName,
  zoomBlock,
} from "./parcel-adoption";

/**
 * Pannello "Particelle pubbliche".
 *
 * L'interazione vive sulla MAPPA, non in un elenco: la ricerca disegna tutte le
 * particelle trovate, il passaggio del mouse ne mostra la scheda, il click ne
 * evidenzia una e apre qui il modulo per adottarla. Un elenco testuale sarebbe
 * stato più semplice da scrivere e peggiore da usare — di una particella conta
 * dove sta e che forma ha, e nessuna riga di testo lo dice.
 *
 * Due cose che il pannello NON fa, deliberatamente:
 *
 *   * **non pre-popola nulla.** I livelli LPIS pubblici sono anonimizzati per
 *     legge: non esiste un modo lecito di sapere quali particelle siano di chi
 *     sta usando l'app. L'adozione è sempre una scelta esplicita, una alla
 *     volta.
 *   * **non vincola al paese dell'azienda.** L'anagrafica ordina il catalogo,
 *     non lo filtra: la sede legale spesso non coincide coi terreni, e i campi
 *     oltreconfine sono la norma.
 */
export function ParcelAdoptionPanel({
  onClose,
  mapControllerRef,
}: {
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const adoptParcel = useAgroStore((s) => s.adoptParcel);
  const candidates = useAgroStore((s) => s.parcelCandidates);
  const selectedParcelId = useAgroStore((s) => s.selectedParcelId);
  const setParcelCandidates = useAgroStore((s) => s.setParcelCandidates);
  const clearParcelCandidates = useAgroStore((s) => s.clearParcelCandidates);
  const { countryCode } = useTenantCountry();

  const sources = useMemo(
    () => orderSourcesForCountry(PARCEL_SOURCE_CATALOG, countryCode),
    [countryCode],
  );
  const [sourceId, setSourceId] = useState(() => sources[0]?.id ?? "");
  const source: ParcelSourceRecord | undefined = useMemo(
    () => sources.find((s) => s.id === sourceId),
    [sources, sourceId],
  );

  const [busy, setBusy] = useState(false);
  const [pickingPoint, setPickingPoint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState("");

  const selected = useMemo(
    () => candidates.find((c) => c.id === selectedParcelId) ?? null,
    [candidates, selectedParcelId],
  );

  // Le capacità di rete/geodesia si costruiscono una volta per la vita del
  // pannello: il riproiettore memorizza le trasformazioni, e ricrearlo a ogni
  // ricerca ne butterebbe via la cache.
  const depsRef = useRef(createParcelSourceDeps());

  // Chiudendo il pannello la mappa torna sgombra: le proposte appartengono
  // alla sessione di scelta, non alla cartografia dell'azienda.
  useEffect(() => () => clearParcelCandidates(), [clearParcelCandidates]);

  // Il nome proposto segue la particella evidenziata sulla mappa.
  useEffect(() => {
    if (selected) setPlotName(suggestedPlotName(selected, plots.length + 1));
  }, [selected, plots.length]);

  async function runQuery(query: (source: ParcelSourceRecord) => Promise<Parcel[]>) {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      setParcelCandidates(await query(source));
    } catch (cause) {
      setParcelCandidates([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function searchInViewport() {
    const map = mapControllerRef.current?.getMap();
    if (!map) return;
    const block = zoomBlock(map.getZoom());
    if (block) {
      setError(
        t(block === "tooFar" ? "parcelAdoption.zoomIn" : "parcelAdoption.zoomOut"),
      );
      setParcelCandidates([]);
      return;
    }
    const bbox: BBox = boundsToBBox(map.getBounds());
    void runQuery((record) =>
      createParcelSource(record, depsRef.current).queryByBbox(bbox, {
        maxFeatures: INTERACTIVE_MAX_FEATURES,
      }),
    );
  }

  // Modalità "clicca un punto": il prossimo tocco sulla mappa interroga la
  // fonte in quel punto. Si smonta all'uscita e a ogni cambio di modalità, così
  // il pannello non lascia mai un ascoltatore appeso alla mappa.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map || !pickingPoint) return;
    const onClick = (event: { lngLat: { lng: number; lat: number } }) => {
      setPickingPoint(false);
      void runQuery((record) =>
        createParcelSource(record, depsRef.current).queryByPoint(
          [event.lngLat.lng, event.lngLat.lat],
          { maxFeatures: INTERACTIVE_MAX_FEATURES },
        ),
      );
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
    // `runQuery` dipende solo da `source`, che è già nelle dipendenze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingPoint, source, mapControllerRef]);

  async function adopt() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await adoptParcel(selected, {
        name: plotName.trim() || suggestedPlotName(selected, plots.length + 1),
      });
    } catch (cause) {
      setError(
        cause instanceof ParcelAlreadyAdoptedError
          ? t("parcelAdoption.alreadyAdopted", {
              name: cause.existing.user_plot_name,
            })
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  const summary = selected ? candidateSummary(selected) : null;

  return (
    <FieldSheet title={t("parcelAdoption.title")} onClose={onClose}>
      <div className="flex flex-col gap-3 p-3 text-sm">
        <p className="text-[var(--ink-2)]">{t("parcelAdoption.intro")}</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--ink-2)]">
            {t("parcelAdoption.sourceLabel")}
          </span>
          <select
            className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* L'attribuzione si mostra PRIMA dell'adozione, non solo dopo: è la
            condizione d'uso del dato, e chi adotta deve poterla leggere. */}
        {source && (
          <p className="text-xs text-[var(--ink-2)]">
            {t("parcelAdoption.attribution", {
              attribution: source.license.attribution,
              license: source.license.id,
            })}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={searchInViewport} disabled={busy || !source}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {t("parcelAdoption.searchHere")}
          </Button>
          <Button
            variant={pickingPoint ? "default" : "outline"}
            onClick={() => setPickingPoint((v) => !v)}
            disabled={busy || !source}
          >
            <Crosshair size={16} />
            {pickingPoint
              ? t("parcelAdoption.pickingPoint")
              : t("parcelAdoption.pickPoint")}
          </Button>
        </div>

        {error && (
          <p className="rounded-[var(--r-2)] bg-[var(--danger-bg,#fee)] p-2 text-[var(--danger,#b00)]">
            {error}
          </p>
        )}

        {!busy && !error && candidates.length === 0 && (
          <p className="text-[var(--ink-2)]">{t("parcelAdoption.noResults")}</p>
        )}

        {/* Trovate ma non ancora scelte: l'istruzione dice dove guardare, cioè
            sulla mappa. */}
        {candidates.length > 0 && !selected && (
          <p className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2 text-[var(--ink-2)]">
            {t("parcelAdoption.foundHint", { count: candidates.length })}
          </p>
        )}

        {selected && summary && (
          <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--accent)] p-2">
            <p className="text-[13px] font-semibold">
              {summary.reference ?? t("parcelAdoption.noReference")}
            </p>
            {/* Che cosa si sta adottando: blocco fisico, particella catastale o
                unità colturale. Cambia il significato dell'appezzamento. */}
            <p className="text-xs leading-snug text-[var(--ink-2)]">
              {t(summary.unitTypeKey)}
            </p>
            <p className="text-xs text-[var(--ink-2)]">
              {[
                summary.declaredArea != null
                  ? t("parcelAdoption.declaredArea", {
                      value: summary.declaredArea.toFixed(4),
                    })
                  : null,
                summary.nationalCropCode
                  ? t("parcelAdoption.cropCode", { code: summary.nationalCropCode })
                  : null,
                summary.validityYear ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--ink-2)]">
                {t("parcelAdoption.plotNameLabel")}
              </span>
              <input
                className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                value={plotName}
                onChange={(e) => setPlotName(e.target.value)}
              />
            </label>
            <Button onClick={() => void adopt()} disabled={busy}>
              {t("parcelAdoption.adopt")}
            </Button>
          </div>
        )}
      </div>
    </FieldSheet>
  );
}
