/**
 * Segnali di attenzione sugli appezzamenti, disegnati sulla mappa:
 *
 *   * `!` in un cerchio — c'è LAVORO previsto sul campo (task programmate o in
 *     corso). Il badge porta il numero; il click apre la scheda dell'appezzamento,
 *     dove quelle task si avviano;
 *   * `⚠` in un triangolo — mancano DATI (tessitura del suolo, campi
 *     dichiarativi della campagna, record del Quaderno incompleti). Il click
 *     porta dritto al punto in cui si compila il dato più urgente.
 *
 * Due simboli distinti e non un badge unico perché chiedono due azioni diverse:
 * un promemoria di lavoro non è un errore da correggere, e confonderli avrebbe
 * reso l'uno indistinguibile dall'altro proprio a colpo d'occhio — che è tutto
 * ciò che serve a una segnalazione in mappa.
 *
 * Marker HTML come `OperationMarkers`/`HarvestMarkers`, ma di dimensione FISSA
 * in pixel: questi non rappresentano un oggetto al suolo di cui interessi la
 * scala, sono notifiche, e a zoom basso devono restare leggibili e cliccabili.
 * Sono ancorati SOPRA il centroide, così non finiscono sotto le icone delle
 * operazioni (che stanno sul centroide).
 */
import {
  buildPlotAlerts,
  centroid,
  loadOperatorMemory,
  type PlotAlert,
  type PlotDataGap,
  useAgroStore,
} from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import maplibregl from "maplibre-gl";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useTenantCountry } from "../hooks/useTenantCountry";

interface Slot {
  el: HTMLDivElement;
  alert: PlotAlert;
  plotName: string;
}

/** Scostamento (px) dal centroide: i simboli stanno sopra, affiancati. */
const TASK_OFFSET: [number, number] = [-13, -30];
const GAP_OFFSET: [number, number] = [13, -30];

export function PlotAlertMarkers({
  mapControllerRef,
  mapReady,
}: {
  mapControllerRef: RefObject<MapController | null>;
  mapReady: boolean;
}) {
  const plots = useAgroStore((s) => s.plots);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);
  const treatments = useAgroStore((s) => s.treatments);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const { countryCode } = useTenantCountry();
  const operatorMemory = useMemo(loadOperatorMemory, []);

  const alerts = useMemo(
    () =>
      buildPlotAlerts({
        plots,
        plannedTasks,
        recipes,
        treatments,
        campaignFields,
        countryCode,
        operatorName: operatorMemory.name ?? null,
        operatorLicenseNumber: operatorMemory.license ?? null,
      }),
    [
      plots,
      plannedTasks,
      recipes,
      treatments,
      campaignFields,
      countryCode,
      operatorMemory,
    ],
  );

  const [taskSlots, setTaskSlots] = useState<Slot[]>([]);
  const [gapSlots, setGapSlots] = useState<Slot[]>([]);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = mapControllerRef.current?.getMap();
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const markers: maplibregl.Marker[] = [];
    const tasks: Slot[] = [];
    const gaps: Slot[] = [];
    const byId = new Map(plots.map((p) => [p.id, p]));

    for (const alert of alerts) {
      const plot = byId.get(alert.plotId);
      if (!plot) continue;
      const lngLat = centroid(plot.geometry) as [number, number];
      const add = (offset: [number, number], into: Slot[]) => {
        const el = document.createElement("div");
        markers.push(
          new maplibregl.Marker({ element: el, offset })
            .setLngLat(lngLat)
            .addTo(map),
        );
        into.push({ el, alert, plotName: plot.user_plot_name });
      };
      if (alert.taskCount > 0) add(TASK_OFFSET, tasks);
      if (alert.gaps.length > 0) add(GAP_OFFSET, gaps);
    }

    markersRef.current = markers;
    setTaskSlots(tasks);
    setGapSlots(gaps);

    return () => {
      markers.forEach((m) => m.remove());
      markersRef.current = [];
      setTaskSlots([]);
      setGapSlots([]);
    };
  }, [alerts, plots, mapReady, mapControllerRef]);

  return (
    <>
      {taskSlots.map(({ el, alert, plotName }) =>
        createPortal(
          <TaskAlertBadge alert={alert} plotName={plotName} />,
          el,
          `task-${alert.plotId}`,
        ),
      )}
      {gapSlots.map(({ el, alert, plotName }) =>
        createPortal(
          <DataGapBadge alert={alert} plotName={plotName} />,
          el,
          `gap-${alert.plotId}`,
        ),
      )}
    </>
  );
}

function TaskAlertBadge({
  alert,
  plotName,
}: {
  alert: PlotAlert;
  plotName: string;
}) {
  const { t } = useTranslation();
  const openPlotSheet = useAgroStore((s) => s.openPlotSheet);
  const title = `${plotName} · ${t("plotAlerts.tasksPending", {
    count: alert.taskCount,
  })}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => openPlotSheet(alert.plotId)}
      className="flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border-2 border-white bg-[#2563eb] text-[11px] font-bold leading-none text-white shadow-[var(--sh-1)]"
    >
      !
    </button>
  );
}

function DataGapBadge({
  alert,
  plotName,
}: {
  alert: PlotAlert;
  plotName: string;
}) {
  const { t } = useTranslation();
  const openCropForPlot = useAgroStore((s) => s.openCropForPlot);
  const openTasksForPlot = useAgroStore((s) => s.openTasksForPlot);
  const selectFeatureOnMap = useAgroStore((s) => s.selectFeatureOnMap);

  // Il gap più urgente decide dove porta il click: la segnalazione è utile
  // quanto la sua scorciatoia — mandare tutti alla stessa scheda avrebbe
  // lasciato all'utente il compito di cercare da sé il campo mancante.
  const primary = alert.gaps[0];
  const goTo = () => {
    if (primary === "declarative_fields") {
      openCropForPlot(alert.plotId);
      return;
    }
    if (primary === "incomplete_records") {
      openTasksForPlot(alert.plotId);
      return;
    }
    void selectFeatureOnMap({ kind: "appezzamento", id: alert.plotId });
  };

  const title = `${plotName} · ${alert.gaps
    .map((g: PlotDataGap) => t(`plotAlerts.gap.${g}` as never))
    .join(" · ")}`;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={goTo}
      className="flex h-[20px] w-[20px] cursor-pointer items-center justify-center"
    >
      {/* Triangolo in SVG: la forma è il segnale, quindi non può dipendere da
          un glyph di sistema (che cambia disegno fra piattaforme). */}
      <svg viewBox="0 0 20 18" className="h-full w-full drop-shadow-[var(--sh-1)]">
        <title>{title}</title>
        <path
          d="M10 1.2 19 16.4H1z"
          fill="#f59e0b"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M10 6.6v4.4"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="10" cy="13.4" r="1" fill="#ffffff" />
      </svg>
    </button>
  );
}
