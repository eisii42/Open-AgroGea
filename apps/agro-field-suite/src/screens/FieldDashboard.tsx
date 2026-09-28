import { useAgroStore } from "@agrogea/core";
import { DrawerSlot } from "@agrogea/ui";
import { MapCanvas, type MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { Lock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useGeofenceWatch } from "../modules/field-mode/useGeofenceWatch";
import { usePlatform } from "../hooks/usePlatform";
import { AppHeader } from "../components/AppHeader";
import { CropLegend } from "../modules/crops/CropLegend";
import { GeometryEditToolbar } from "../components/GeometryEditToolbar";
import { Colorbar } from "../modules/colorbar/Colorbar";
import { CommandPalette } from "../modules/command-palette/CommandPalette";
import {
  OPEN_COMMAND_PALETTE_EVENT,
  requestCommandPalette,
} from "../modules/command-palette/open-command-palette";
import { DesktopMapFabs } from "../components/DesktopMapFabs";
import { DesktopMapTools } from "../components/DesktopMapTools";
import { MapSearchControl } from "../components/MapSearchControl";
import { MobileMapFabs } from "../components/MobileMapFabs";
import { MobileMapTools } from "../components/MobileMapTools";
import { PlotPeekCard } from "../modules/plot-sheet/PlotPeekCard";
import { MapTooltip } from "../components/MapTooltip";
import { OperationMarkers } from "../components/OperationMarkers";
import { HarvestMarkers } from "../components/HarvestMarkers";
import { WarehouseMarkers } from "../components/WarehouseMarkers";
import { PlotAlertMarkers } from "../components/PlotAlertMarkers";
import { ModuleSidebar } from "../components/ModuleSidebar";
import { TransferTagsFeed } from "../components/TransferTagsFeed";
import { useReadOnly } from "@agrogea/core";
import { useGeometryUndoRedo } from "../hooks/useGeometryUndoRedo";
import { useParcelCandidatesLayer } from "../hooks/useParcelCandidatesLayer";
import { usePlotsLayer } from "../hooks/usePlotsLayer";
import { useFeatureSelection } from "../hooks/useFeatureSelection";
import { useFieldLayers } from "../hooks/useFieldLayers";
import { useFieldPlugins } from "../hooks/useFieldPlugins";
import { useHoverTooltips } from "../hooks/useHoverTooltips";
import { useIndexRefreshJob } from "../hooks/useIndexRefreshJob";
import { useCompassNorth } from "../hooks/useCompassNorth";
import { useMapStyleEpoch } from "../hooks/useMapStyleEpoch";
import { useMapZoomLimits } from "../hooks/useMapZoomLimits";
import { useNativeMapI18n } from "../hooks/useNativeMapI18n";
import { useLayerAttributions } from "../hooks/useLayerAttributions";
import { useWmsBasemapRestore } from "../hooks/useWmsBasemapRestore";
import { useDrawerMapPadding } from "../hooks/useDrawerMapPadding";

/**
 * Pannelli overlay caricati on-demand (code-splitting): non servono al primo
 * render della mappa e trascinano dipendenze pesanti (Recharts nel pannello
 * Suolo, moduli crop, export logbook). Lazy → fuori dal chunk iniziale,
 * caricati solo all'apertura del relativo strumento.
 */

/**
 * Caricatori di tutti i pannelli pigri. Sul telefono si chiamano quando l'app
 * è inattiva (vedi l'effetto di precarico in FieldDashboard): il browser mette
 * in cache il modulo, e la prima apertura di un pannello non lascia più la
 * mappa vuota per il tempo del download mentre il foglio Moduli si chiude.
 */
const panelLoaders: Array<() => Promise<unknown>> = [];

function lazyPanel<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
) {
  panelLoaders.push(load);
  return lazy(load);
}
const LogbookPanel = lazyPanel(() =>
  import("../modules/field-logbook/LogbookPanel").then((m) => ({ default: m.LogbookPanel })),
);
const PlotSheet = lazyPanel(() =>
  import("../modules/plot-sheet/PlotSheet").then((m) => ({ default: m.PlotSheet })),
);
const HarvestPanel = lazyPanel(() =>
  import("../modules/field-logbook/HarvestPanel").then((m) => ({ default: m.HarvestPanel })),
);
const WarehousePanel = lazyPanel(() =>
  import("../modules/warehouse/WarehousePanel").then((m) => ({
    default: m.WarehousePanel,
  })),
);
const FuelRefillPanel = lazyPanel(() =>
  import("../modules/machinery/FuelRefillTab").then((m) => ({
    default: m.FuelRefillTab,
  })),
);
const SoilPanel = lazyPanel(() =>
  import("../modules/soil/SoilPanel").then((m) => ({ default: m.SoilPanel })),
);
const CropDataPanel = lazyPanel(() =>
  import("../modules/crops/CropPanel").then((m) => ({
    default: m.CropDataPanel,
  })),
);
const CropDssPanel = lazyPanel(() =>
  import("../modules/crops/CropPanel").then((m) => ({
    default: m.CropDssPanel,
  })),
);
const VraPanel = lazyPanel(() =>
  import("../modules/vra/VraPanel").then((m) => ({ default: m.VraPanel })),
);
const WaterBalancePanel = lazyPanel(() =>
  import("../modules/water-balance/WaterBalancePanel").then((m) => ({
    default: m.WaterBalancePanel,
  })),
);
const PrintComposer = lazyPanel(() =>
  import("../modules/print/PrintComposer").then((m) => ({
    default: m.PrintComposer,
  })),
);
const ParcelAdoptionPanel = lazyPanel(() =>
  import("../modules/parcel-adoption/ParcelAdoptionPanel").then((m) => ({
    default: m.ParcelAdoptionPanel,
  })),
);
const DataEntrySheet = lazyPanel(() =>
  import("../components/DataEntrySheet").then((m) => ({
    default: m.DataEntrySheet,
  })),
);
const DetailEditSheet = lazyPanel(() =>
  import("../components/DetailEditSheet").then((m) => ({
    default: m.DetailEditSheet,
  })),
);
const GeometryRegistry = lazyPanel(() =>
  import("../components/GeometryRegistry").then((m) => ({
    default: m.GeometryRegistry,
  })),
);
const SyncPanel = lazyPanel(() =>
  import("../components/SyncPanel").then((m) => ({ default: m.SyncPanel })),
);
const SettingsPanel = lazyPanel(() =>
  import("../modules/settings/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const RegistryPanel = lazyPanel(() =>
  import("../modules/registry/RegistryPanel").then((m) => ({
    default: m.RegistryPanel,
  })),
);
const GeoCompliancePanel = lazyPanel(() =>
  import("../modules/compliance/GeoCompliancePanel").then((m) => ({
    default: m.GeoCompliancePanel,
  })),
);
const CompliancePanel = lazyPanel(() =>
  import("../modules/compliance/CompliancePanel").then((m) => ({
    default: m.CompliancePanel,
  })),
);
const TaskPlannerPanel = lazyPanel(() =>
  import("../modules/tasks/TaskPlannerPanel").then((m) => ({
    default: m.TaskPlannerPanel,
  })),
);
const FieldCollectionTool = lazyPanel(() =>
  import("../components/FieldCollectionTool").then((m) => ({
    default: m.FieldCollectionTool,
  })),
);
const FieldDetectionModal = lazyPanel(() =>
  import("../modules/field-mode/FieldDetectionModal").then((m) => ({
    default: m.FieldDetectionModal,
  })),
);
const IndexTimeSlider = lazyPanel(() =>
  import("../modules/soil/IndexTimeSlider").then((m) => ({
    default: m.IndexTimeSlider,
  })),
);

/**
 * Stadio 3 — Dashboard geocentrica. Layout: header in alto, sidebar moduli a
 * scomparsa (overlay che scorre via transform: la mappa NON viene rimontata e
 * non si ridimensiona), mappa persistente a tutto schermo, controlli nativi
 * (layer-control, terrain, measure) e tooltip hover sopra di essa.
 */
/**
 * Navigazione moduli sul desktop: "rail" = barra di icone da 76 px con
 * l'elenco degli strumenti a comparsa (fase D4 del redesign); "list" = la
 * lista a fisarmonica da 260 px, a scomparsa col bottone in alto a sinistra.
 * Per tornare alla lista basta cambiare questo valore.
 */
const DESKTOP_MODULE_NAV = "rail" as "rail" | "list";
/** Larghezza della barra di icone (w-[76px] in ModuleSidebar). */
const RAIL_WIDTH = 76;
/** Larghezza della lista moduli (w-[260px] in ModuleSidebar). */
const LIST_WIDTH = 260;

export function FieldDashboard() {
  const { t } = useTranslation();
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const sidebarCollapsed = useAgroStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAgroStore((s) => s.toggleSidebar);
  const pendingGeometry = useAgroStore((s) => s.pendingGeometry);
  const selectedFeature = useAgroStore((s) => s.selectedFeature);
  // Geofencing GPS: rilevamento AUTOMATICO dell'ingresso in un appezzamento.
  // Nessun pulsante e nessun flag — il hook arma il watch da sé e alimenta la
  // modale di rilevamento; qui basta tenerlo montato.
  useGeofenceWatch();
  // Controllo automatico di nuove immagini satellitari all'avvio (throttle 12h
  // per azienda): popola la cache indici in sottofondo, così il time slider ha
  // già una serie navigabile senza che l'utente debba lanciare un calcolo.
  useIndexRefreshJob();

  const mapControllerRef = useRef<MapController | null>(null);
  // Contenitore della mappa: ci vivono i controlli NATIVI (righello, gestore
  // livelli), che si localizzano a valle — vedi useNativeMapI18n.
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // Area mappa (mappa + pannelli laterali): osservata per il padding del drawer.
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const platform = usePlatform();
  // Desktop: più moduli aperti insieme nella colonna di destra (modalità
  // "floating" dello store). Telefono: un foglio alla volta ("docked").
  const setPanelMode = useAgroStore((s) => s.setPanelMode);
  useEffect(() => {
    setPanelMode(platform.isMobile ? "docked" : "floating");
  }, [platform.isMobile, setPanelMode]);
  const railWidth =
    DESKTOP_MODULE_NAV === "rail" ? RAIL_WIDTH : sidebarCollapsed ? 0 : LIST_WIDTH;

  // Su mobile forziamo la sidebar collassata al primo render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al mount
  useEffect(() => {
    if (platform.isMobile && !sidebarCollapsed) toggleSidebar();
  }, [platform.isMobile]);

  // Undo/Redo geometrie + scorciatoie globali (Ctrl/Cmd+Z, Y).
  const undoRedo = useGeometryUndoRedo();

  // Command Palette globale: Ctrl/Cmd+K apre/chiude, da QUALUNQUE vista. La
  // dashboard resta montata anche con Calendario o Command Center in primo
  // piano (keep-alive in App.tsx): da lì si torna sulla mappa e la si apre
  // (requestCommandPalette), invece di ignorare il tasto. Lo stesso evento lo
  // lancia il campo "Cerca… Ctrl K" dell'header.
  const paletteOpenRef = useRef(false);
  paletteOpenRef.current = paletteOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpenRef.current) setPaletteOpen(false);
        else requestCommandPalette();
      }
    };
    const onOpenRequest = () => setPaletteOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    };
  }, []);

  // Cambio/aggiunta basemap → lo stile MapLibre riparte da zero: questo epoch
  // bumpa su ogni style.load e fa ri-iniettare i layer AgroGea sopra la nuova
  // basemap (Modulo 1 §FIX: scomparsa dei vettori al cambio basemap).
  const styleEpoch = useMapStyleEpoch(mapControllerRef, mapReady);

  // Limiti di zoom (preferenza utente + tetto tecnico della basemap attiva).
  useMapZoomLimits();

  useFieldPlugins(mapControllerRef, mapReady);
  usePlotsLayer(mapControllerRef, styleEpoch);
  // Particelle proposte dall'adozione: sopra gli appezzamenti, così durante la
  // scelta hover e click appartengono alla proposta.
  useParcelCandidatesLayer(mapControllerRef, styleEpoch);
  useFieldLayers(styleEpoch);
  // Fonti dei layer (WMS, satellite, catasto, indici Sentinel-2) nella barra attribuzioni.
  useLayerAttributions(mapControllerRef, mapReady);
  // Sfondo WMS salvato dell'azienda: torna com'era alla riapertura.
  useWmsBasemapRestore(mapControllerRef, mapReady);
  const hover = useHoverTooltips(mapControllerRef, mapReady);
  // Telefono: il tocco su un appezzamento apre la scheda compatta in basso
  // (PlotPeekCard) invece della scheda completa; un tocco a vuoto la chiude.
  const [peekPlotId, setPeekPlotId] = useState<string | null>(null);
  useFeatureSelection(
    mapControllerRef,
    mapReady,
    platform.isMobile
      ? { onPlotTap: setPeekPlotId, onEmptyTap: () => setPeekPlotId(null) }
      : {},
  );
  // Telefono: quando l'app è inattiva (requestIdleCallback, quindi senza
  // contendere risorse alla mappa) si scarica il codice di tutti i pannelli.
  // Senza, la prima apertura (es. Moduli → Coltura → Dati coltura) chiudeva il
  // foglio Moduli e lasciava la mappa vuota per il tempo del download, prima
  // che il pannello comparisse di colpo.
  useEffect(() => {
    if (!platform.isMobile) return;
    const preload = () => {
      for (const load of panelLoaders) void load().catch(() => {});
    };
    // Le WebView più vecchie (Safari < 16.4) non hanno requestIdleCallback.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(preload, 1500);
    return () => globalThis.clearTimeout(id);
  }, [platform.isMobile]);

  // Un pannello aperto (Quaderno, Moduli, scheda completa…) prende il posto
  // della scheda compatta: non restano due fogli impilati.
  useEffect(() => {
    if (openPanels.length > 0) setPeekPlotId(null);
  }, [openPanels.length]);
  // Righello e gestore livelli sono controlli di terze parti con le etichette
  // cablate in inglese: si traducono a valle sul DOM della mappa.
  useNativeMapI18n(mapContainerRef);
  // Bussola: segnala la vista orientata a nord (piccola "N" + colore).
  useCompassNorth(mapControllerRef, mapContainerRef);
  // Desktop: con un pannello laterale aperto la mappa centra e zooma sull'area
  // visibile, non sotto il pannello.
  useDrawerMapPadding(mapControllerRef, mapReady, mapAreaRef, !platform.isMobile);

  return (
    <div className="flex h-full flex-col">
      <AppHeader />

      {readOnly && (
        <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--ink-2)]">
          <Lock size={13} className="text-[var(--ink-3)]" />
          {t("fieldDashboard.readOnlyBanner.prefix")}{" "}
          <strong>{t("fieldDashboard.readOnlyBanner.strong")}</strong>
          {t("fieldDashboard.readOnlyBanner.suffix")}
        </div>
      )}

      {/* agro-map-area: con un pannello laterale aperto (agro-drawer) il CSS
          sposta i controlli di destra alla sua sinistra, vedi index.css. */}
      {/* `--agro-rail-w`: spazio occupato a sinistra dalla navigazione moduli
          (desktop). Lo leggono gli elementi ancorati a sinistra — strumenti di
          modifica, legenda colture, time slider, scala — per non finirle sotto. */}
      <div
        ref={mapAreaRef}
        className="agro-map-area relative min-h-0 flex-1 overflow-hidden"
        data-drawer-bounds
        style={
          platform.isMobile
            ? undefined
            : ({ "--agro-rail-w": `${railWidth}px` } as CSSProperties)
        }
      >
        {/* Mappa persistente: mai rimontata, mai ridimensionata dai pannelli. */}
        <div
          ref={mapContainerRef}
          className="agro-field-map absolute inset-0"
          // Telefono: il CSS sfoltisce la colonna dei controlli nativi (vedi
          // index.css, sezione "Mappa su telefono").
          data-mobile={platform.isMobile ? "true" : undefined}
        >
          <MapCanvas
            controllerRef={mapControllerRef}
            onControllerReady={() => setMapReady(true)}
            // Vista 2D fissa (Mercatore): ottimale per il disegno tecnico di
            // plots e infrastrutture; niente toggle globo.
            projection={{ type: "mercator" }}
          />
        </div>

        {/* "Cerca luogo": bottone appeso alla colonna dei controlli MapLibre
            (in fondo, sotto il gestore livelli) — vedi MapSearchControl. */}
        <MapSearchControl mapControllerRef={mapControllerRef} />

        {/* Telefono: una sola colonna di controlli (a destra, nella colonna
            nativa) più le azioni rapide in basso; niente colonna di sinistra,
            le sue funzioni stanno in Livelli, Moduli e nei pulsanti rotondi. */}
        {platform.isMobile && (
          <>
            <MobileMapTools mapControllerRef={mapControllerRef} />
            {mapReady && !peekPlotId && <MobileMapFabs />}
            {/* Durante l'editing geometrico gli strumenti di modifica restano. */}
            <div className="absolute left-3 top-3 z-30 flex flex-col gap-2">
              <GeometryEditToolbar />
            </div>
          </>
        )}

        {/* Navigazione moduli desktop: barra di icone sempre visibile, oppure
            (DESKTOP_MODULE_NAV = "list") la lista che scorre fuori schermo via
            transform. Su telefono i moduli sono nel foglio della barra in basso. */}
        {!platform.isMobile && DESKTOP_MODULE_NAV === "rail" && (
          <div className="absolute inset-y-0 left-0 z-[35]">
            <ModuleSidebar rail />
          </div>
        )}
        {!platform.isMobile && DESKTOP_MODULE_NAV === "list" && (
          <div
            className={cn(
              "absolute inset-y-0 left-0 z-20 transition-transform duration-300 ease-in-out",
              sidebarCollapsed ? "-translate-x-full" : "translate-x-0",
            )}
          >
            <ModuleSidebar />
          </div>
        )}

        {/* Desktop: UNA colonna di controlli mappa, a destra, come sul telefono
            (Livelli · Misura · Wayback in testa, poi zoom, bussola, schermo
            intero, terreno, posizione, cerca luogo). A sinistra resta solo il
            comando della barra moduli, più gli strumenti di modifica durante
            l'editing geometrico (con la barra di icone solo questi ultimi).
            Rilievo GPS e carburante stanno in basso a destra (DesktopMapFabs). */}
        {!platform.isMobile && (
          <DesktopMapTools mapControllerRef={mapControllerRef} />
        )}
        {!platform.isMobile && (
        /* La transizione è sulla SOLA posizione: con `transition-all` veniva
            animata anche la visibility ereditata, e uscendo dalla vista mappa
            (nascosta con visibility:hidden) i bottoni restavano a schermo per
            tutta la durata dell’animazione. */
        <div className="absolute left-[calc(var(--agro-rail-w,0px)+0.75rem)] top-3 z-30 flex flex-col gap-2 transition-[left] duration-300 ease-in-out">
          {DESKTOP_MODULE_NAV === "list" && (
          <button
            type="button"
            onClick={toggleSidebar}
            title={
              sidebarCollapsed
                ? t("fieldDashboard.expandModules")
                : t("fieldDashboard.fullScreenMap")
            }
            className="flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] shadow-[var(--sh-1)] hover:bg-[var(--panel-2)]"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
          )}
          {/* Strumenti di MODIFICA: compaiono a lato dei moduli solo durante
              l'editing geometrico, con i soli tool di modifica (non di disegno). */}
          <GeometryEditToolbar />
        </div>
        )}

        {/* Simboli operazioni del Quaderno e harvests (toggle "Mostra sulla
            mappa"): marker HTML on-demand, creati solo quando il toggle è
            active e rimossi allo spegnimento. Le harvests non sono un layer. */}
        <OperationMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />
        <HarvestMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />

        {/* POI dei magazzini: permanenti (non dipendono da un toggle) — un
            deposito è un elemento stabile dell'azienda. Il click apre la sua
            scheda nel modulo Magazzino. */}
        <WarehouseMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />

        {/* Segnali di attenzione sugli appezzamenti: "!" dove c'è lavoro
            previsto, triangolo dove mancano dati (tessitura, dichiarativi,
            record incompleti). Anch'essi permanenti: sono l'eccezione, quindi
            compaiono solo sui campi che hanno davvero qualcosa da segnalare. */}
        <PlotAlertMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />

        {/* Tooltip hover (Modulo UI §2). Su touch non c'è passaggio del mouse:
            al suo posto la scheda compatta dell'appezzamento toccato. */}
        {platform.isMobile ? (
          peekPlotId &&
          openPanels.length === 0 && (
            <PlotPeekCard
              plotId={peekPlotId}
              onClose={() => setPeekPlotId(null)}
            />
          )
        ) : (
          <MapTooltip hover={hover} />
        )}

        {/* Legenda a gradiente degli indici: compare con gli overlay attivi.
            Desktop: dentro la pila in basso a destra (sotto). */}
        {platform.isMobile && <Colorbar />}

        {/* Time slider degli indici: compare in basso dopo un calcolo e resta
            navigabile anche a pannello Suolo chiuso. */}
        <Suspense fallback={null}>
          <IndexTimeSlider />
        </Suspense>

        {/* Legenda crops: colore/icona per specie negli plots attivi. */}
        {!platform.isMobile && (
          <CropLegend mapControllerRef={mapControllerRef} />
        )}

        {/* Feed attività: tag temporali degli ultimi import/export (FIX 2).
            Si nasconde quando non c'è nulla da mostrare. Su telefono in alto a
            sinistra: in basso a destra ci sono le azioni rapide. */}
        {platform.isMobile ? (
          <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[min(20rem,70vw)] flex-col items-start gap-1">
            <TransferTagsFeed
              limit={3}
              autoHideMs={10000}
              className="flex flex-col items-start gap-1"
            />
          </div>
        ) : (
          /* Desktop: una sola pila in basso a destra, sopra le attribuzioni —
             feed attività, legende degli indici, azioni rapide di campo — che
             si sposta a fianco del pannello laterale quando è aperto
             (agro-right-overlay, index.css). */
          <div className="agro-right-overlay pointer-events-none absolute bottom-9 right-3 z-30 flex max-w-[20rem] flex-col items-end gap-2">
            <TransferTagsFeed
              limit={3}
              autoHideMs={10000}
              className="flex flex-col items-end gap-1"
            />
            <Colorbar stacked />
            {mapReady && <DesktopMapFabs />}
          </div>
        )}

        {/* Pannelli strumenti (bottom-sheet mobile / drawer desktop). Lazy:
            il fallback è nullo perché sono overlay e il caricamento è breve.
            Desktop: stanno tutti nella pila della colonna di destra
            (agro-drawer-dock, index.css), così più moduli restano aperti
            insieme: l'ultimo in cima, gli altri ridotti all'intestazione. Sul
            telefono la pila non esiste (display: contents), un foglio alla
            volta. */}
        <div className="agro-drawer-dock">
        <Suspense fallback={null}>
          {openPanels.includes("quaderno") && (
            <DrawerSlot id="quaderno">
              <LogbookPanel onClose={() => togglePanel("quaderno")} />
            </DrawerSlot>
          )}
          {/* Scheda dell'appezzamento (tap sul field in mappa): task
              programmate avviabili + operazioni registrate su QUEL field.
              L'ambito aziendale completo resta nel Quaderno, pannello a sé. */}
          {openPanels.includes("plot-sheet") && (
            <DrawerSlot id="plot-sheet">
              <PlotSheet />
            </DrawerSlot>
          )}
          {openPanels.includes("raccolta") && (
            <DrawerSlot id="raccolta">
              <HarvestPanel onClose={() => togglePanel("raccolta")} />
            </DrawerSlot>
          )}
          {openPanels.includes("magazzino") && (
            <DrawerSlot id="magazzino">
              <WarehousePanel
                onClose={() => togglePanel("magazzino")}
                mapControllerRef={mapControllerRef}
              />
            </DrawerSlot>
          )}
          {/* Refill carburante: pannello a sé (staccato dal Magazzino), aperto
              solo dal FAB rapido a bordo campo (§6.2). */}
          {openPanels.includes("refill") && (
            <DrawerSlot id="refill">
              <FuelRefillPanel onClose={() => togglePanel("refill")} />
            </DrawerSlot>
          )}
          {openPanels.includes("ndvi") && (
            <DrawerSlot id="ndvi">
              <SoilPanel onClose={() => togglePanel("ndvi")} />
            </DrawerSlot>
          )}
          {openPanels.includes("vra") && (
            <DrawerSlot id="vra">
              <VraPanel onClose={() => togglePanel("vra")} />
            </DrawerSlot>
          )}
          {openPanels.includes("stampa") && (
            <DrawerSlot id="stampa">
              <PrintComposer
                onClose={() => togglePanel("stampa")}
                mapControllerRef={mapControllerRef}
              />
            </DrawerSlot>
          )}
          {/* Adozione di particelle da fonti pubbliche: riceve la mappa per
              leggere il riquadro visibile e per il click puntuale. */}
          {openPanels.includes("parcel-adoption") && (
            <DrawerSlot id="parcel-adoption">
              <ParcelAdoptionPanel
                onClose={() => togglePanel("parcel-adoption")}
                mapControllerRef={mapControllerRef}
              />
            </DrawerSlot>
          )}
          {openPanels.includes("coltura") && (
            <DrawerSlot id="coltura">
              <CropDataPanel onClose={() => togglePanel("coltura")} />
            </DrawerSlot>
          )}
          {openPanels.includes("coltura-dss") && (
            <DrawerSlot id="coltura-dss">
              <CropDssPanel onClose={() => togglePanel("coltura-dss")} />
            </DrawerSlot>
          )}
          {openPanels.includes("acqua") && (
            <DrawerSlot id="acqua">
              <WaterBalancePanel onClose={() => togglePanel("acqua")} />
            </DrawerSlot>
          )}
          {openPanels.includes("sync") && (
            <DrawerSlot id="sync">
              <SyncPanel onClose={() => togglePanel("sync")} />
            </DrawerSlot>
          )}
          {openPanels.includes("anagrafica") && (
            <DrawerSlot id="anagrafica">
              <RegistryPanel onClose={() => togglePanel("anagrafica")} />
            </DrawerSlot>
          )}
          {openPanels.includes("impostazioni") && (
            <DrawerSlot id="impostazioni">
              <SettingsPanel onClose={() => togglePanel("impostazioni")} />
            </DrawerSlot>
          )}
          {openPanels.includes("geocompliance") && (
            <DrawerSlot id="geocompliance">
              <GeoCompliancePanel onClose={() => togglePanel("geocompliance")} />
            </DrawerSlot>
          )}
          {openPanels.includes("compliance-monitor") && (
            <DrawerSlot id="compliance-monitor">
              <CompliancePanel onClose={() => togglePanel("compliance-monitor")} />
            </DrawerSlot>
          )}
          {/* Impostazioni Profilo: montate in App.tsx, sopra TUTTE le viste
              (si aprono anche da Calendario e Command Center). */}
          {/* Registro: drawer destro come la scheda dettaglio. Quando un
              elemento è selezionato lascia il posto alla scheda e riappare alla
              sua chiusura, così si possono gestire più elementi di fila. */}
          {openPanels.includes("registro") &&
            !selectedFeature &&
            !pendingGeometry && (
              <DrawerSlot id="registro">
                <GeometryRegistry
                  onClose={() => togglePanel("registro")}
                  mapControllerRef={mapControllerRef}
                />
              </DrawerSlot>
            )}

          {/* Scheda dati: si apre automaticamente a fine disegno (Modulo UI §3). */}
          {pendingGeometry && <DataEntrySheet pending={pendingGeometry} />}

          {/* Scheda dettaglio/editing: si apre alla selezione di un elemento
              esistente sulla mappa (Modulo 4). Non coesiste con la scheda di
              creazione di un nuovo disegno. */}
          {!pendingGeometry && selectedFeature && (
            <DetailEditSheet selected={selectedFeature} />
          )}
        </Suspense>
        {/* Pannello rilievo GPS (mobile + desktop). */}
        <Suspense fallback={null}>
          {openPanels.includes("scouting") && (
            <DrawerSlot id="scouting">
              <FieldCollectionTool
                onClose={() => togglePanel("scouting")}
                mapControllerRef={mapControllerRef}
              />
            </DrawerSlot>
          )}
        </Suspense>
        </div>

        {/* Riquadro Pianificazione Task / Ricette: pagina a tutto schermo
            come le Impostazioni Profilo (non un drawer). Sta FUORI dalla pila
            dei pannelli laterali: dentro, il suo `absolute inset-0` prendeva
            le misure della pila (larga zero senza pannelli) e non si vedeva. */}
        <Suspense fallback={null}>
          {openPanels.includes("tasks") && (
            <TaskPlannerPanel onClose={() => togglePanel("tasks")} />
          )}
        </Suspense>

        {/* Command Palette globale (Ctrl/Cmd+K): overlay sopra mappa e pannelli. */}
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          mapControllerRef={mapControllerRef}
          undoRedo={undoRedo}
        />


        {/* Modalità Campo: modale di rilevamento ingresso in field, sopra ogni
            altro overlay (z-index massimo). Compare da sé quando il geofencing
            conferma l'ingresso in un appezzamento. */}
        <Suspense fallback={null}>
          <FieldDetectionModal />
        </Suspense>
      </div>
    </div>
  );
}
