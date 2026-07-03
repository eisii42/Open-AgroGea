import { useAgroStore } from "@agrogea/core";
import type { IndiceVegetazionale } from "@agrogea/tools";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVraGenerator } from "./useVraGenerator";
import {
  ETICHETTE_LAVORAZIONE,
  type TipoLavorazione,
  UNITA_LAVORAZIONE,
} from "./vra-zones";

/**
 * Modulo "Mappe a rateo variabile" (VRA). Scheda separata da "Analisi indici":
 * l'agronomo sceglie appezzamento, indice di base, tipo di lavorazione, numero
 * di zone e i ratei (quantità) per zona; la mappa è zonata via K-means ed
 * esportabile per i terminali dei trattori (ISO-XML / GeoJSON).
 */

const INDICI: { id: IndiceVegetazionale; label: string }[] = [
  { id: "ndvi", label: "NDVI" },
  { id: "ndre", label: "NDRE" },
  { id: "msavi2", label: "MSAVI2" },
  { id: "savi", label: "SAVI" },
  { id: "ndwi", label: "NDWI" },
];

const LAVORAZIONI = Object.keys(ETICHETTE_LAVORAZIONE) as TipoLavorazione[];

// Risoluzione della cella VRA in pixel Sentinel-2 (10 m/pixel).
const RISOLUZIONI = [
  { id: "fine", step: 2 },
  { id: "media", step: 4 },
  { id: "grossa", step: 8 },
];

const MIN_ZONE = 2;
const MAX_ZONE = 5;

/** Chiavi i18n per le etichette di lavorazione (`vra-zones.ts` resta in italiano). */
const LAVORAZIONE_I18N_KEY: Record<TipoLavorazione, string> = {
  concimazione: "vraPanel.tillage.concimazione",
  fertilizzazione: "vraPanel.tillage.fertilizzazione",
  trattamento: "vraPanel.tillage.trattamento",
  semina: "vraPanel.tillage.semina",
  irrigazione: "vraPanel.tillage.irrigazione",
};

export function VraPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const selezionatoId = useAgroStore((s) => s.appezzamentoSelezionatoId);
  const { stato, genera, esporta, reset } = useVraGenerator();

  const [apzId, setApzId] = useState(selezionatoId ?? "");
  const [indice, setIndice] = useState<IndiceVegetazionale>("ndvi");
  const [lavorazione, setLavorazione] = useState<TipoLavorazione>("concimazione");
  const [step, setStep] = useState(4);
  const [zone, setZone] = useState(3);
  const [ratei, setRatei] = useState<number[]>([120, 100, 80]);

  // Adatta la lista dei ratei al numero di zone (zona 0 = indice più basso).
  useEffect(() => {
    setRatei((prev) => {
      if (prev.length === zone) return prev;
      const next = [...prev];
      while (next.length < zone) next.push(next.at(-1) ?? 100);
      next.length = zone;
      return next;
    });
  }, [zone]);

  const apz = appezzamenti.find((a) => a.id === apzId);
  const unita = UNITA_LAVORAZIONE[lavorazione];
  const inCorso = stato.fase === "lavorazione";
  const puoGenerare = apz != null && !inCorso;

  return (
    <FieldSheet
      title={t("vraPanel.title")}
      onClose={onClose}
      footer={
        <Button
          className="min-h-[var(--touch-min)] w-full"
          disabled={!puoGenerare}
          onClick={() => {
            if (!apz) return;
            reset();
            void genera(apz, { indice, step, zone, lavorazione, ratei });
          }}
        >
          {inCorso ? t("vraPanel.generating") : t("vraPanel.generateMap")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Appezzamento */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("logbook.common.plot")}
          </p>
          {appezzamenti.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">
              {t("vraPanel.noPlotAvailable")}
            </p>
          ) : (
            <select
              value={apzId}
              onChange={(e) => setApzId(e.target.value)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              <option value="">{t("logbook.common.select")}</option>
              {appezzamenti.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Indice base + lavorazione */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.baseIndex")}
            </p>
            <select
              value={indice}
              onChange={(e) => setIndice(e.target.value as IndiceVegetazionale)}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {INDICI.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.tillageLabel")}
            </p>
            <select
              value={lavorazione}
              onChange={(e) =>
                setLavorazione(e.target.value as TipoLavorazione)
              }
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {LAVORAZIONI.map((l) => (
                <option key={l} value={l}>
                  {t(LAVORAZIONE_I18N_KEY[l] as never)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Risoluzione cella + numero zone */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.cellResolution")}
            </p>
            <select
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
              className="w-full rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
            >
              {RISOLUZIONI.map((r) => (
                <option key={r.step} value={r.step}>
                  {t(`vraPanel.resolution.${r.id}` as never)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.zonesCount", { count: zone })}
            </p>
            <input
              type="range"
              min={MIN_ZONE}
              max={MAX_ZONE}
              value={zone}
              onChange={(e) => setZone(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        </section>

        {/* Ratei per zona */}
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("vraPanel.ratesPerZone", { unit: unita })}
          </p>
          <p className="mb-2 text-[11px] text-[var(--ink-4)]">
            {t("vraPanel.zoneOrderHint", { zone })}
          </p>
          <div className="flex flex-col gap-1.5">
            {ratei.map((rateo, i) => (
              <label
                // L'indice è la chiave naturale: le zone sono ordinate e stabili.
                key={i}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-16 text-[var(--ink-3)]">
                  {t("vraPanel.zoneNumber", { number: i + 1 })}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={rateo}
                  min={0}
                  onChange={(e) =>
                    setRatei((prev) =>
                      prev.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    )
                  }
                  className="agro-num flex-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                />
                <span className="w-12 text-xs text-[var(--ink-4)]">{unita}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Stato */}
        {inCorso && (
          <p className="text-sm text-[var(--accent)]">{stato.etichetta}</p>
        )}
        {stato.fase === "errore" && (
          <div className="rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
            {stato.messaggio}
          </div>
        )}

        {/* Risultato: legenda zone + export */}
        {stato.fase === "completato" && (
          <section className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("vraPanel.zonesGenerated")}
            </p>
            <div className="flex flex-col gap-1">
              {stato.risultato.zone.map((z) => (
                <div
                  key={z.zona}
                  className="flex items-center justify-between rounded-[var(--r-2)] bg-[var(--panel-2)] px-2 py-1 text-xs"
                >
                  <span className="font-medium">
                    {t("vraPanel.zoneNumber", { number: z.zona + 1 })}
                  </span>
                  <span className="text-[var(--ink-4)]">
                    {indice.toUpperCase()} {z.valoreMedio.toFixed(3)} ·{" "}
                    {t("vraPanel.cellsCount", { count: z.nCelle })}
                  </span>
                  <span className="agro-num font-semibold">
                    {z.rateo} {stato.risultato.unita}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <Button
                className="min-h-[var(--touch-min)]"
                onClick={() => esporta("isoxml", apz?.user_plot_name ?? "vra")}
              >
                ISO-XML
              </Button>
              <Button
                className="min-h-[var(--touch-min)]"
                onClick={() => esporta("shapefile", apz?.user_plot_name ?? "vra")}
              >
                Shapefile
              </Button>
              <Button
                className={cn("min-h-[var(--touch-min)]")}
                onClick={() => esporta("geojson", apz?.user_plot_name ?? "vra")}
              >
                GeoJSON
              </Button>
            </div>
          </section>
        )}
      </div>
    </FieldSheet>
  );
}
