import { useAgroStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EXTERNAL_LAYER_FLAG } from "../add-data/add-data";
import { CONSTRAINT_LABELS, type ConstraintType } from "./geo-compliance";
import { useComplianceLayerAnalysis } from "./useComplianceLayerAnalysis";

/**
 * Workflow Geo-compliance riprogettato (FEATURE 3): non load più file (compito
 * dell'Add Data globale). Espone un SELETTORE dei layer esterni attivi nel Layer
 * Store; alla scelta di un layer e del tipo di vincolo che rappresenta, marca il
 * layer (`metadata.compliance`) — così i badge per-plot reagiscono in
 * tutta l'app — e innesca il motore spaziale DuckDB per calcolare quali
 * plots del tenant intersecano il layer, aggiornando i badge di allerta.
 */

const TIPI: ConstraintType[] = ["zvn", "sic", "zps", "eudr"];

export function ComplianceLayerSelector() {
  const layers = useAppStore((s) => s.layers);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const plots = useAgroStore((s) => s.plots);

  const [layerId, setLayerId] = useState<string>("");
  const [type, setType] = useState<ConstraintType>("zvn");

  // Tutti i layer esterni attivi caricati via Add Data (con geometria).
  const layerEsterni = useMemo(
    () =>
      layers.filter(
        (l) => l.metadata?.[EXTERNAL_LAYER_FLAG] === true && l.geojson,
      ),
    [layers],
  );

  const chosenLayer = layerEsterni.find((l) => l.id === layerId) ?? null;
  const geojson = (chosenLayer?.geojson as FeatureCollection | undefined) ?? null;

  const analisi = useComplianceLayerAnalysis(plots, geojson);

  /** Classifica il layer selezionato come vincolo `tipo` (tag app-wide). */
  function classification(nextType: ConstraintType) {
    setType(nextType);
    if (chosenLayer) {
      updateLayer(chosenLayer.id, {
        metadata: { ...chosenLayer.metadata, compliance: nextType },
      });
    }
  }

  function selectLayer(id: string) {
    setLayerId(id);
    const l = layerEsterni.find((x) => x.id === id);
    if (!l) return;
    // Eredita una classificazione già assegnata, altrimenti applica quella current.
    const current = l.metadata?.compliance;
    const nextType =
      typeof current === "string" && (TIPI as string[]).includes(current)
        ? (current as ConstraintType)
        : type;
    setType(nextType);
    updateLayer(l.id, {
      metadata: { ...l.metadata, compliance: nextType },
    });
  }

  const colpiti = analisi.appezzamentiColpiti.length;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          Layer vincolante (Geo-compliance)
        </p>
        <p className="mb-2 text-xs text-[var(--ink-4)]">
          Seleziona un layer esterno caricato con «Aggiungi dati» e indica quale
          vincolo rappresenta. L'analisi di intersezione con gli plots è
          istantanea.
        </p>
      </div>

      {layerEsterni.length === 0 ? (
        <p className="rounded-[var(--r-2)] border border-dashed border-[var(--line)] bg-[var(--panel-2)] px-3 py-4 text-center text-xs text-[var(--ink-4)]">
          Nessun layer esterno caricato. Usa «Aggiungi dati» nella barra in alto
          per importare la cartografia vincolante (ZVN, SIC/ZPS, EUDR).
        </p>
      ) : (
        <>
          <div>
            <label
              htmlFor="gc-layer"
              className="mb-1 block text-xs font-medium text-[var(--ink-3)]"
            >
              Layer esterno
            </label>
            <select
              id="gc-layer"
              value={layerId}
              onChange={(e) => selectLayer(e.target.value)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              <option value="">— scegli un layer —</option>
              {layerEsterni.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="gc-tipo"
              className="mb-1 block text-xs font-medium text-[var(--ink-3)]"
            >
              Tipo di vincolo
            </label>
            <select
              id="gc-tipo"
              value={type}
              disabled={!chosenLayer}
              onChange={(e) => classification(e.target.value as ConstraintType)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm disabled:opacity-50"
            >
              {TIPI.map((t) => (
                <option key={t} value={t}>
                  {CONSTRAINT_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Esito analisi spaziale → badge di allerta. */}
          {chosenLayer && (
            <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2.5">
              {analisi.loading ? (
                <p className="flex items-center gap-2 text-xs text-[var(--ink-3)]">
                  <Loader2 size={13} className="animate-spin" />
                  Analisi spaziale (DuckDB) in corso…
                </p>
              ) : analisi.error ? (
                <p className="text-xs text-[var(--danger)]">
                  Analisi non riuscita: {analisi.error}
                </p>
              ) : colpiti > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span
                    className="inline-flex items-center gap-1.5 self-start rounded-[var(--r-2)] px-2 py-1 text-xs font-medium"
                    style={{
                      background:
                        type === "zvn" || type === "eudr"
                          ? "var(--danger-l, #fee2e2)"
                          : "var(--warn-l)",
                      color:
                        type === "zvn" || type === "eudr"
                          ? "var(--danger)"
                          : "var(--warn)",
                    }}
                  >
                    {type === "zvn" && "⚠ ZVN"}
                    {type === "eudr" && "⛔ EUDR"}
                    {(type === "sic" || type === "zps") && "⛰ Area protetta"}
                    {` · ${colpiti} appezzament${colpiti === 1 ? "o" : "i"} interessat${colpiti === 1 ? "o" : "i"}`}
                  </span>
                  <p className="text-[11px] text-[var(--ink-4)]">
                    I badge di dettaglio (tetto azoto, due diligence) sono
                    aggiornati sulle schede degli plots coinvolti.
                  </p>
                </div>
              ) : analisi.eseguita ? (
                <p className="text-xs text-[var(--ok)]">
                  ✓ Nessun plot interseca questo layer.
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
