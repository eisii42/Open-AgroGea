import type { DssRiskLevel } from "@agrogea/core";
import { AlertTriangle } from "lucide-react";
import type { DssPlotResult } from "../../../hooks/useDssCalculation";

/**
 * Scheda DSS per plot. Sostituisce il vecchio grafico a barre con una
 * SEMPLICE CARD che cambia colore in base al risk complessivo (il livello
 * peggiore tra i modelli). Sotto, l'elenco dei modelli con il rispettivo livello
 * e gli alert testuali. Nessun bilancio idrico qui: vive nel pannello «Acqua».
 */

const COLORE_RISCHIO: Record<DssRiskLevel, string> = {
  low: "#1f8a5b",
  medium: "#e8833a",
  high: "#d23b2e",
};

const ETICHETTA_RISCHIO: Record<DssRiskLevel, string> = {
  low: "Basso",
  medium: "Medio",
  high: "Alto",
};

function rank(level: DssRiskLevel): number {
  return level === "high" ? 2 : level === "medium" ? 1 : 0;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function DssRiskCard({ risultato }: { risultato: DssPlotResult }) {
  const { name, module, esiti, series, meteo, message } = risultato;

  // Livello complessivo = il peggiore tra i modelli patologici.
  const peggiore = esiti.reduce<DssRiskLevel | null>((acc, e) => {
    if (!acc) return e.livello;
    return rank(e.livello) > rank(acc) ? e.livello : acc;
  }, null);

  const noData = series.length === 0 || esiti.length === 0;
  const colore = peggiore ? COLORE_RISCHIO[peggiore] : "var(--ink-4)";
  const alerts = esiti.filter((e) => e.alert);

  return (
    <section className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-[11px] text-[var(--ink-4)]">{module.label}</p>
      </div>

      {meteo && (
        <p className="mb-2 text-[11px] text-[var(--ink-4)]">
          Meteo:{" "}
          {meteo.fonte === "private_station" ? "centralina aziendale" : "Open-Meteo"}
          {meteo.fetched ? ` · aggiornato (${meteo.inserite} rows)` : " · da cache locale"}
        </p>
      )}

      {noData ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-xs text-[var(--ink-3)]">
          {message ?? "Nessun model disponibile per questo plot."}
        </p>
      ) : (
        <>
          {/* Card di risk complessivo: colore di sfondo dal livello peggiore. */}
          <div
            className="flex items-center justify-between rounded-[var(--r-2)] px-3 py-2.5"
            style={{ background: `${colore}1a`, border: `1px solid ${colore}55` }}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              Rischio complessivo
            </span>
            <span
              className="rounded-full px-3 py-1 text-sm font-bold text-white"
              style={{ background: colore }}
            >
              {peggiore ? ETICHETTA_RISCHIO[peggiore] : "—"}
            </span>
          </div>

          {/* Modelli: livello per ciascuno (chip colorato + index). */}
          <div className="mt-2 flex flex-col gap-1.5">
            {esiti.map((e) => (
              <div
                key={e.modelloNome}
                className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: COLORE_RISCHIO[e.livello] }}
                />
                <span className="flex-1 text-sm font-medium">{e.dss.name}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: `${COLORE_RISCHIO[e.livello]}22`,
                    color: COLORE_RISCHIO[e.livello],
                  }}
                >
                  {ETICHETTA_RISCHIO[e.livello]}
                </span>
                <span className="agro-num w-6 text-right text-xs text-[var(--ink-3)]">
                  {e.value}
                </span>
              </div>
            ))}
          </div>

          {/* Alert testuali nella finestra meteo. */}
          {alerts.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {alerts.map((e) => {
                const day = series[e.alert?.day ?? -1];
                return (
                  <div
                    key={e.modelloNome}
                    className="flex gap-2 rounded-[var(--r-2)] border-l-2 p-2 text-xs"
                    style={{
                      borderColor: COLORE_RISCHIO[e.livello],
                      background: `${COLORE_RISCHIO[e.livello]}11`,
                    }}
                  >
                    <AlertTriangle
                      size={14}
                      className="mt-0.5 shrink-0"
                      style={{ color: COLORE_RISCHIO[e.livello] }}
                    />
                    <div>
                      <p className="font-medium">
                        {e.dss.name}
                        {day && (
                          <span className="ml-1 font-normal text-[var(--ink-4)]">
                            · {shortDate(day.data)}
                          </span>
                        )}
                      </p>
                      <p className="text-[var(--ink-3)]">{e.alert?.message}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
