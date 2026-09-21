import type { Plot } from "@agrogea/core";
import { Button } from "@geolibre/ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ComplianceSourcesState } from "./useComplianceSources";

/**
 * Le tre fonti che le schede non satellitari si procurano da sole: pendenza da
 * DEM (BCAA 5), reticolo idrografico da OpenStreetMap (BCAA 4), ortofoto
 * caricata dall'utente (BCAA 8).
 *
 * Stanno in testa al pannello e non dentro le singole schede perché **una fonte
 * serve a più schede** e perché, senza, quelle schede dicono soltanto "non
 * decidibile": l'utente deve vedere subito che cosa può procurarsi, non
 * scoprirlo dopo aver lanciato una valutazione che non poteva concludere.
 */
export function ComplianceSourcesSection({
  plot,
  sources,
}: {
  plot: Plot | null;
  sources: ComplianceSourcesState;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  if (!plot) return null;

  return (
    <section className="mb-3 flex flex-col gap-2 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel-2)] p-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {t("compliance.sources.title")}
      </h3>

      {/* Pendenza da DEM — BCAA 5 */}
      <SourceRow
        label={t("compliance.sources.terrain")}
        hint={
          sources.terrain
            ? t("compliance.sources.terrainReady", {
                slope: sources.terrain.meanSlopeDeg.toFixed(1),
                maxSlope: sources.terrain.maxSlopeDeg.toFixed(1),
                source: sources.terrain.source,
              })
            : t("compliance.sources.terrainHint")
        }
        ready={sources.terrain != null}
        busy={sources.loading === "terrain"}
        actionLabel={t("compliance.sources.fetch")}
        onAction={sources.loadTerrain}
      />

      {/* Reticolo idrografico da OSM — BCAA 4 */}
      <SourceRow
        label={t("compliance.sources.waterNetwork")}
        hint={
          sources.waterNetwork
            ? t("compliance.sources.waterNetworkReady", {
                count: sources.waterNetworkCount,
                attribution: sources.attribution,
              })
            : t("compliance.sources.waterNetworkHint")
        }
        ready={sources.waterNetwork != null}
        busy={sources.loading === "water"}
        actionLabel={t("compliance.sources.fetch")}
        onAction={sources.loadWaterNetwork}
      />

      {/* Ortofoto caricata — BCAA 8 */}
      <SourceRow
        label={t("compliance.sources.orthophoto")}
        hint={
          sources.orthophoto
            ? t("compliance.sources.orthophotoReady", {
                fileName: sources.orthophoto.fileName,
                gsdCm: Math.round(sources.orthophoto.gsdM * 100),
                bands: sources.orthophoto.bandCount,
              })
            : t("compliance.sources.orthophotoHint")
        }
        ready={sources.orthophoto != null}
        busy={sources.loading === "orthophoto"}
        actionLabel={
          sources.orthophoto
            ? t("compliance.sources.replace")
            : t("compliance.sources.upload")
        }
        onAction={() => fileInput.current?.click()}
      />
      {/* Ortofoto già sulla mappa: si riusa il file, non si ricarica. */}
      {!sources.orthophoto &&
        sources.fromMap.map((entry) => (
          <button
            key={entry.layerId}
            type="button"
            className="rounded-[var(--r-2)] border border-[var(--accent-bd)] bg-[var(--accent-l)] px-2 py-1.5 text-left text-[11px] text-[var(--accent)]"
            onClick={() => sources.loadOrthophotoFile(entry.file)}
          >
            {t("compliance.sources.orthophotoFromMap", { name: entry.file.name })}
            <span className="mt-0.5 block text-[10px] opacity-80">
              {t("compliance.sources.orthophotoFromMapHint")}
            </span>
          </button>
        ))}

      <input
        ref={fileInput}
        type="file"
        accept=".tif,.tiff,image/tiff"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) sources.loadOrthophotoFile(file);
          // Si azzera il valore: ricaricare lo STESSO file dopo una correzione
          // deve poter riattivare l'evento.
          e.target.value = "";
        }}
      />

      {sources.error && (
        <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] px-2 py-1 text-[11px] text-[var(--danger)]">
          {sources.error}
        </p>
      )}
    </section>
  );
}

function SourceRow({
  label,
  hint,
  ready,
  busy,
  actionLabel,
  onAction,
}: {
  label: string;
  hint: string;
  ready: boolean;
  busy: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[var(--ink-2)]">
          {ready ? "✓ " : ""}
          {label}
        </p>
        <p className="text-[10px] leading-snug text-[var(--ink-4)]">{hint}</p>
      </div>
      <Button
        variant="outline"
        className="shrink-0 text-[11px]"
        disabled={busy}
        onClick={onAction}
      >
        {busy ? t("compliance.panel.running") : actionLabel}
      </Button>
    </div>
  );
}
