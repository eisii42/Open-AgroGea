import { useAgroStore } from "@agrogea/core";
import { useAppStore } from "@geolibre/core";
import type { FeatureCollection } from "geojson";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EXTERNAL_LAYER_FLAG } from "../add-data/add-data";
import { ETICHETTE_VINCOLO, type TipoVincolo } from "./geo-compliance";
import { useComplianceLayerAnalysis } from "./useComplianceLayerAnalysis";

/**
 * Workflow Geo-compliance riprogettato (FEATURE 3): non carica più file (compito
 * dell'Add Data globale). Espone un SELETTORE dei layer esterni attivi nel Layer
 * Store; alla scelta di un layer e del tipo di vincolo che rappresenta, marca il
 * layer (`metadata.compliance`) — così i badge per-appezzamento reagiscono in
 * tutta l'app — e innesca il motore spaziale DuckDB per calcolare quali
 * appezzamenti del tenant intersecano il layer, aggiornando i badge di allerta.
 */

const TIPI: TipoVincolo[] = ["zvn", "sic", "zps", "eudr"];

export function ComplianceLayerSelector() {
  const layers = useAppStore((s) => s.layers);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);

  const [layerId, setLayerId] = useState<string>("");
  const [tipo, setTipo] = useState<TipoVincolo>("zvn");

  // Tutti i layer esterni attivi caricati via Add Data (con geometria).
  const layerEsterni = useMemo(
    () =>
      layers.filter(
        (l) => l.metadata?.[EXTERNAL_LAYER_FLAG] === true && l.geojson,
      ),
    [layers],
  );

  const layerScelto = layerEsterni.find((l) => l.id === layerId) ?? null;
  const geojson = (layerScelto?.geojson as FeatureCollection | undefined) ?? null;

  const analisi = useComplianceLayerAnalysis(appezzamenti, geojson);

  /** Classifica il layer selezionato come vincolo `tipo` (tag app-wide). */
  function classifica(nextTipo: TipoVincolo) {
    setTipo(nextTipo);
    if (layerScelto) {
      updateLayer(layerScelto.id, {
        metadata: { ...layerScelto.metadata, compliance: nextTipo },
      });
    }
  }

  function selezionaLayer(id: string) {
    setLayerId(id);
    const l = layerEsterni.find((x) => x.id === id);
    if (!l) return;
    // Eredita una classificazione già assegnata, altrimenti applica quella corrente.
    const corrente = l.metadata?.compliance;
    const nextTipo =
      typeof corrente === "string" && (TIPI as string[]).includes(corrente)
        ? (corrente as TipoVincolo)
        : tipo;
    setTipo(nextTipo);
    updateLayer(l.id, {
      metadata: { ...l.metadata, compliance: nextTipo },
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
          vincolo rappresenta. L'analisi di intersezione con gli appezzamenti è
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
              onChange={(e) => selezionaLayer(e.target.value)}
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
              value={tipo}
              disabled={!layerScelto}
              onChange={(e) => classifica(e.target.value as TipoVincolo)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm disabled:opacity-50"
            >
              {TIPI.map((t) => (
                <option key={t} value={t}>
                  {ETICHETTE_VINCOLO[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Esito analisi spaziale → badge di allerta. */}
          {layerScelto && (
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
                        tipo === "zvn" || tipo === "eudr"
                          ? "var(--danger-l, #fee2e2)"
                          : "var(--warn-l)",
                      color:
                        tipo === "zvn" || tipo === "eudr"
                          ? "var(--danger)"
                          : "var(--warn)",
                    }}
                  >
                    {tipo === "zvn" && "⚠ ZVN"}
                    {tipo === "eudr" && "⛔ EUDR"}
                    {(tipo === "sic" || tipo === "zps") && "⛰ Area protetta"}
                    {` · ${colpiti} appezzament${colpiti === 1 ? "o" : "i"} interessat${colpiti === 1 ? "o" : "i"}`}
                  </span>
                  <p className="text-[11px] text-[var(--ink-4)]">
                    I badge di dettaglio (tetto azoto, due diligence) sono
                    aggiornati sulle schede degli appezzamenti coinvolti.
                  </p>
                </div>
              ) : analisi.eseguita ? (
                <p className="text-xs text-[var(--ok)]">
                  ✓ Nessun appezzamento interseca questo layer.
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
