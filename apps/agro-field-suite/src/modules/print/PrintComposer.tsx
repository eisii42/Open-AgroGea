import { useAgroStore } from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import { useAppStore } from "@geolibre/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildLegenda, buildPrintSvg } from "./print-layout";

/**
 * Print Layout Composer: compone un layout di stampa professionale (mappa +
 * legenda dinamica dei layer attivi + scala + freccia del nord + note + logo
 * AgroGea) ed runExport in SVG vettoriale, PNG ad alta risoluzione o PDF (via
 * stampa del browser) per i fascicoli aziendali / domande PAC-PSR.
 */

interface Props {
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
}

function formatDistanza(metri: number): string {
  if (metri >= 1000) return `${Math.round(metri / 100) / 10} km`;
  return `${Math.round(metri)} m`;
}

/** Scala grafica per una barra di 120px alla latitudine/zoom correnti. */
function scalaPerBarra(map: ReturnType<MapController["getMap"]>): string | undefined {
  if (!map) return undefined;
  const lat = map.getCenter().lat;
  const zoom = map.getZoom();
  const metriPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return formatDistanza(metriPerPixel * 120);
}

function download(name: string, contenuto: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([contenuto], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PrintComposer({ onClose, mapControllerRef }: Props) {
  const { t } = useTranslation();
  const layers = useAppStore((s) => s.layers);
  const companies = useAgroStore((s) => s.companies);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const company = companies.find((a) => a.id === activeCompanyId);

  const [title, setTitle] = useState(
    `${company?.business_name ?? "AgroGea"} · ${new Date().toLocaleDateString("it-IT")}`,
  );
  const [note, setNote] = useState("");
  const [mostraScala, setMostraScala] = useState(true);
  const [mostraNord, setMostraNord] = useState(true);
  const [mostraLogo, setMostraLogo] = useState(true);
  const [mappaDataUrl, setMappaDataUrl] = useState<string | null>(null);

  const legenda = useMemo(() => buildLegenda(layers), [layers]);

  const catturaMappa = useCallback(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map) return;
    // preserveDrawingBuffer è active (MapController): ridisegna e leggi il buffer.
    map.redraw();
    try {
      setMappaDataUrl(map.getCanvas().toDataURL("image/png"));
    } catch {
      setMappaDataUrl(null);
    }
  }, [mapControllerRef]);

  // Cattura l'istantanea della mappa all'apertura del composer.
  useEffect(() => {
    catturaMappa();
  }, [catturaMappa]);

  const svg = useMemo(
    () =>
      buildPrintSvg({
        title,
        note: note || undefined,
        legenda,
        mostraScala,
        scalaTesto: mostraScala
          ? scalaPerBarra(mapControllerRef.current?.getMap() ?? null)
          : undefined,
        mostraNord,
        mostraLogo,
        mappaDataUrl,
      }),
    [title, note, legenda, mostraScala, mostraNord, mostraLogo, mappaDataUrl, mapControllerRef],
  );

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const fileName = title.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "mappa";

  const exportPng = useCallback(() => {
    const img = new Image();
    img.onload = () => {
      const scala = 2; // alta risoluzione.
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scala;
      canvas.height = img.height * scala;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) download(`${fileName}.png`, blob, "image/png");
      }, "image/png");
    };
    img.src = svgDataUrl;
  }, [svgDataUrl, fileName]);

  const stampaPdf = useCallback(() => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(
      `<!doctype html><title>${title}</title>` +
        `<body style="margin:0">${svg}</body>`,
    );
    win.document.close();
    win.focus();
    win.print();
  }, [svg, title]);

  const toggleOptions = [
    { id: "scala", labelKey: "printComposer.toggle.scale", value: mostraScala, set: setMostraScala },
    { id: "nord", labelKey: "printComposer.toggle.north", value: mostraNord, set: setMostraNord },
    { id: "logo", labelKey: "printComposer.toggle.logo", value: mostraLogo, set: setMostraLogo },
  ];

  return (
    <FieldSheet
      title={t("printComposer.title")}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-3 gap-2">
          <Button className="min-h-[var(--touch-min)]" onClick={stampaPdf}>
            PDF
          </Button>
          <Button className="min-h-[var(--touch-min)]" onClick={exportPng}>
            PNG
          </Button>
          <Button
            className="min-h-[var(--touch-min)]"
            onClick={() => download(`${fileName}.svg`, svg, "image/svg+xml")}
          >
            SVG
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("printComposer.titleLabel")}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("printComposer.notesLabel")}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t("printComposer.notesPlaceholder")}
            className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {toggleOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => opt.set(!opt.value)}
              className={cn(
                "rounded-[var(--r-2)] border px-2.5 py-1.5 text-[13px]",
                opt.value
                  ? "border-[var(--accent)] bg-[var(--accent-l)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink-2)]",
              )}
            >
              {t(opt.labelKey as never)}
            </button>
          ))}
          <button
            type="button"
            onClick={catturaMappa}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-2.5 py-1.5 text-[13px] text-[var(--ink-2)]"
          >
            {t("printComposer.refreshMap")}
          </button>
        </div>

        {/* Anteprima del layout (SVG). */}
        <div className="overflow-hidden rounded-[var(--r-2)] border border-[var(--line)]">
          <img src={svgDataUrl} alt={t("printComposer.previewAlt")} className="w-full" />
        </div>
        <p className="text-[11px] text-[var(--ink-4)]">
          {t("printComposer.legendHint", { count: legenda.length })}
        </p>
      </div>
    </FieldSheet>
  );
}
