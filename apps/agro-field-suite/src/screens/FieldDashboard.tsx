import { useAgroStore } from "@agrogea/core";
import { MapCanvas, type MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { Lock, MapPin, Menu, NotebookPen, PanelLeftClose, PanelLeftOpen, Wifi } from "lucide-react";
import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../components/BottomSheet";
import { usePlatform } from "../hooks/usePlatform";
import { AppHeader } from "../components/AppHeader";
import { BasemapSwitcher } from "../components/BasemapSwitcher";
import { CropLegend } from "../modules/crops/CropLegend";
import { GeometryEditToolbar } from "../components/GeometryEditToolbar";
import { Colorbar } from "../modules/colorbar/Colorbar";
import { CommandPalette } from "../modules/command-palette/CommandPalette";
import { MapControls } from "../components/MapControls";
import { MapTooltip } from "../components/MapTooltip";
import { OperationMarkers } from "../components/OperationMarkers";
import { HarvestMarkers } from "../components/HarvestMarkers";
import { ModuleSidebar } from "../components/ModuleSidebar";
import { TransferTagsFeed } from "../components/TransferTagsFeed";
import { useReadOnly } from "@agrogea/core";
import { useGeometryUndoRedo } from "../hooks/useGeometryUndoRedo";
import { usePlotsLayer } from "../hooks/usePlotsLayer";
import { useFeatureSelection } from "../hooks/useFeatureSelection";
import { useFieldLayers } from "../hooks/useFieldLayers";
import { useFieldPlugins } from "../hooks/useFieldPlugins";
import { useHoverTooltips } from "../hooks/useHoverTooltips";
import { useMapStyleEpoch } from "../hooks/useMapStyleEpoch";

/**
 * Pannelli overlay caricati on-demand (code-splitting): non servono al primo
 * render della mappa e trascinano dipendenze pesanti (Recharts nel pannello
 * Suolo, moduli crop, export logbook). Lazy → fuori dal chunk iniziale,
 * caricati solo all'apertura del relativo strumento.
 */
const LogbookPanel = lazy(() =>
  import("../modules/field-logbook/LogbookPanel").then((m) => ({ default: m.LogbookPanel })),
);
const HarvestPanel = lazy(() =>
  import("../modules/field-logbook/HarvestPanel").then((m) => ({ default: m.HarvestPanel })),
);
const WarehousePanel = lazy(() =>
  import("../modules/warehouse/WarehousePanel").then((m) => ({
    default: m.WarehousePanel,
  })),
);
const SoilPanel = lazy(() =>
  import("../modules/soil/SoilPanel").then((m) => ({ default: m.SoilPanel })),
);
const CropDataPanel = lazy(() =>
  import("../modules/crops/CropPanel").then((m) => ({
    default: m.CropDataPanel,
  })),
);
const CropDssPanel = lazy(() =>
  import("../modules/crops/CropPanel").then((m) => ({
    default: m.CropDssPanel,
  })),
);
const VraPanel = lazy(() =>
  import("../modules/vra/VraPanel").then((m) => ({ default: m.VraPanel })),
);
const WaterBalancePanel = lazy(() =>
  import("../modules/water-balance/WaterBalancePanel").then((m) => ({
    default: m.WaterBalancePanel,
  })),
);
const PrintComposer = lazy(() =>
  import("../modules/print/PrintComposer").then((m) => ({
    default: m.PrintComposer,
  })),
);
const DataEntrySheet = lazy(() =>
  import("../components/DataEntrySheet").then((m) => ({
    default: m.DataEntrySheet,
  })),
);
const DetailEditSheet = lazy(() =>
  import("../components/DetailEditSheet").then((m) => ({
    default: m.DetailEditSheet,
  })),
);
const GeometryRegistry = lazy(() =>
  import("../components/GeometryRegistry").then((m) => ({
    default: m.GeometryRegistry,
  })),
);
const SyncPanel = lazy(() =>
  import("../components/SyncPanel").then((m) => ({ default: m.SyncPanel })),
);
const SettingsPanel = lazy(() =>
  import("../modules/settings/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const RegistryPanel = lazy(() =>
  import("../modules/registry/RegistryPanel").then((m) => ({
    default: m.RegistryPanel,
  })),
);
const GeoCompliancePanel = lazy(() =>
  import("../modules/compliance/GeoCompliancePanel").then((m) => ({
    default: m.GeoCompliancePanel,
  })),
);
const UserProfileSettingsPage = lazy(() =>
  import("./UserProfileSettingsPage").then((m) => ({
    default: m.UserProfileSettingsPage,
  })),
);
const FieldCollectionTool = lazy(() =>
  import("../components/FieldCollectionTool").then((m) => ({
    default: m.FieldCollectionTool,
  })),
);
const OfflineAreaDialog = lazy(() =>
  import("../components/OfflineAreaDialog").then((m) => ({
    default: m.OfflineAreaDialog,
  })),
);

/**
 * Stadio 3 — Dashboard geocentrica. Layout: header in alto, sidebar moduli a
 * scomparsa (overlay che scorre via transform: la mappa NON viene rimontata e
 * non si ridimensiona), mappa persistente a tutto schermo, controlli nativi
 * (layer-control, terrain, measure) e tooltip hover sopra di essa.
 */
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

  const mapControllerRef = useRef<MapController | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);

  const platform = usePlatform();

  // Su mobile forziamo la sidebar collassata al primo render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al mount
  useEffect(() => {
    if (platform.isMobile && !sidebarCollapsed) toggleSidebar();
  }, [platform.isMobile]);

  // Undo/Redo geometrie + scorciatoie globali (Ctrl/Cmd+Z, Y).
  const undoRedo = useGeometryUndoRedo();

  // Command Palette globale: Ctrl/Cmd+K apre/chiude. La dashboard resta
  // montata anche col Command Center in primo piano (keep-alive in App.tsx):
  // la palette risponde solo quando la vista mappa è quella attiva, altrimenti
  // si aprirebbe invisibile sotto l'altra vista.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (useAgroStore.getState().activeView === "command-center") return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cambio/aggiunta basemap → lo stile MapLibre riparte da zero: questo epoch
  // bumpa su ogni style.load e fa ri-iniettare i layer AgroGea sopra la nuova
  // basemap (Modulo 1 §FIX: scomparsa dei vettori al cambio basemap).
  const styleEpoch = useMapStyleEpoch(mapControllerRef, mapReady);

  useFieldPlugins(mapControllerRef, mapReady);
  usePlotsLayer(mapControllerRef, styleEpoch);
  useFieldLayers(styleEpoch);
  const hover = useHoverTooltips(mapControllerRef, mapReady);
  useFeatureSelection(mapControllerRef, mapReady);

  return (
    <div className="flex h-full flex-col">
      <AppHeader onOpenCommandPalette={() => setPaletteOpen(true)} />

      {readOnly && (
        <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--ink-2)]">
          <Lock size={13} className="text-[var(--ink-3)]" />
          {t("fieldDashboard.readOnlyBanner.prefix")}{" "}
          <strong>{t("fieldDashboard.readOnlyBanner.strong")}</strong>
          {t("fieldDashboard.readOnlyBanner.suffix")}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Mappa persistente: mai rimontata, mai ridimensionata dai pannelli.
            `data-sidebar` permette al CSS di scostare i controlli nativi top-left
            (es. pannello Misura) a destra della colonna bottoni, così la scheda
            si apre di fianco al bottone without finire dietro la barra moduli. */}
        <div
          className="agro-field-map absolute inset-0"
          data-sidebar={sidebarCollapsed ? "collapsed" : "open"}
        >
          <MapCanvas
            controllerRef={mapControllerRef}
            onControllerReady={() => setMapReady(true)}
            // Vista 2D fissa (Mercatore): ottimale per il disegno tecnico di
            // plots e infrastrutture; niente toggle globo.
            projection={{ type: "mercator" }}
          />
        </div>

        {/* Sidebar moduli: overlay che scorre fuori schermo via transform. */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 z-20 transition-transform duration-300 ease-in-out",
            sidebarCollapsed ? "-translate-x-full" : "translate-x-0",
          )}
        >
          <ModuleSidebar />
        </div>

        {/* Colonna fluttuante: toggle sidebar + controlli mappa nativi. */}
        <div
          className={cn(
            "absolute top-3 z-30 flex flex-col gap-2 transition-all duration-300 ease-in-out",
            sidebarCollapsed ? "left-3" : "left-[272px]",
          )}
        >
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
          <MapControls mapControllerRef={mapControllerRef} />
          <BasemapSwitcher />
          {mapReady && (
            <button
              type="button"
              onClick={() => togglePanel("scouting")}
              title={t("fieldDashboard.scoutingTitle")}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-[var(--r-2)] border shadow-[var(--sh-1)]",
                openPanels.includes("scouting")
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
              )}
            >
              <MapPin size={18} />
            </button>
          )}
          {/* Strumenti di MODIFICA: compaiono a lato dei moduli solo durante
              l'editing geometrico, con i soli tool di modifica (non di disegno). */}
          <GeometryEditToolbar />
        </div>

        {/* Simboli operazioni del Quaderno e harvests (toggle "Mostra sulla
            mappa"): marker HTML on-demand, creati solo quando il toggle è
            active e rimossi allo spegnimento. Le harvests non sono un layer. */}
        <OperationMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />
        <HarvestMarkers mapControllerRef={mapControllerRef} mapReady={mapReady} />

        {/* Tooltip hover (Modulo UI §2). */}
        <MapTooltip hover={hover} />

        {/* Legenda a gradiente degli indici: compare con gli overlay attivi. */}
        <Colorbar />

        {/* Legenda crops: colore/icona per specie negli plots attivi. */}
        {!platform.isMobile && (
          <CropLegend mapControllerRef={mapControllerRef} />
        )}

        {/* Feed attività: tag temporali degli ultimi import/export (FIX 2).
            Si nasconde quando non c'è nulla da mostrare. */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex max-w-[min(20rem,70vw)] flex-col items-end gap-1">
          <TransferTagsFeed
            limit={3}
            autoHideMs={10000}
            className="flex flex-col items-end gap-1"
          />
        </div>

        {/* Pannelli strumenti (bottom-sheet mobile / drawer desktop). Lazy:
            il fallback è nullo perché sono overlay e il caricamento è breve. */}
        <Suspense fallback={null}>
          {openPanels.includes("quaderno") && (
            <LogbookPanel onClose={() => togglePanel("quaderno")} />
          )}
          {openPanels.includes("raccolta") && (
            <HarvestPanel onClose={() => togglePanel("raccolta")} />
          )}
          {openPanels.includes("magazzino") && (
            <WarehousePanel onClose={() => togglePanel("magazzino")} />
          )}
          {openPanels.includes("ndvi") && (
            <SoilPanel onClose={() => togglePanel("ndvi")} />
          )}
          {openPanels.includes("vra") && (
            <VraPanel onClose={() => togglePanel("vra")} />
          )}
          {openPanels.includes("stampa") && (
            <PrintComposer
              onClose={() => togglePanel("stampa")}
              mapControllerRef={mapControllerRef}
            />
          )}
          {openPanels.includes("coltura") && (
            <CropDataPanel onClose={() => togglePanel("coltura")} />
          )}
          {openPanels.includes("coltura-dss") && (
            <CropDssPanel onClose={() => togglePanel("coltura-dss")} />
          )}
          {openPanels.includes("acqua") && (
            <WaterBalancePanel onClose={() => togglePanel("acqua")} />
          )}
          {openPanels.includes("sync") && (
            <SyncPanel onClose={() => togglePanel("sync")} />
          )}
          {openPanels.includes("anagrafica") && (
            <RegistryPanel onClose={() => togglePanel("anagrafica")} />
          )}
          {openPanels.includes("impostazioni") && (
            <SettingsPanel onClose={() => togglePanel("impostazioni")} />
          )}
          {openPanels.includes("geocompliance") && (
            <GeoCompliancePanel onClose={() => togglePanel("geocompliance")} />
          )}
          {/* Impostazioni Profilo: pagina a tutto schermo (non un drawer), sopra
              mappa e pannelli. Raggiunta dal menù profile e dalla Command Palette. */}
          {openPanels.includes("profile") && (
            <UserProfileSettingsPage onClose={() => togglePanel("profile")} />
          )}
          {/* Registro: drawer destro come la scheda dettaglio. Quando un
              elemento è selezionato lascia il posto alla scheda e riappare alla
              sua chiusura, così si possono gestire più elementi di fila. */}
          {openPanels.includes("registro") &&
            !selectedFeature &&
            !pendingGeometry && (
              <GeometryRegistry
                onClose={() => togglePanel("registro")}
                mapControllerRef={mapControllerRef}
              />
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

        {/* Command Palette globale (Ctrl/Cmd+K): overlay sopra mappa e pannelli. */}
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          mapControllerRef={mapControllerRef}
          undoRedo={undoRedo}
        />

        {/* Pannello rilievo GPS (mobile + desktop). */}
        <Suspense fallback={null}>
          {openPanels.includes("scouting") && (
            <FieldCollectionTool
              onClose={() => togglePanel("scouting")}
              mapControllerRef={mapControllerRef}
            />
          )}
          {offlineOpen && (
            <OfflineAreaDialog
              onClose={() => setOfflineOpen(false)}
              mapControllerRef={mapControllerRef}
            />
          )}
        </Suspense>

        {/* Tab bar mobile: navigazione principale su smartphone (sostituisce la
            sidebar laterale che non è usabile con un solo pollice su schermi
            piccoli). Visibile solo su viewport < 768 px. */}
        {platform.isMobile && (
          <nav className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-[var(--line)] bg-[var(--panel)] px-2 pb-safe pt-2 shadow-[var(--sh-pop)]">
            <MobileTabBtn
              label={t("fieldDashboard.tabLogbook")}
              icon={<NotebookPen size={20} />}
              active={openPanels.includes("quaderno")}
              onClick={() => {
                setMobileSidebarOpen(false);
                togglePanel("quaderno");
              }}
            />
            <MobileTabBtn
              label={t("fieldDashboard.tabScouting")}
              icon={<MapPin size={20} />}
              active={openPanels.includes("scouting")}
              onClick={() => {
                setMobileSidebarOpen(false);
                togglePanel("scouting");
              }}
            />
            <MobileTabBtn
              label={t("fieldDashboard.tabOffline")}
              icon={<Wifi size={20} />}
              active={offlineOpen}
              onClick={() => {
                setMobileSidebarOpen(false);
                setOfflineOpen((v) => !v);
              }}
            />
            <MobileTabBtn
              label={t("fieldDashboard.tabModules")}
              icon={<Menu size={20} />}
              active={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen((v) => !v)}
            />
          </nav>
        )}

        {/* Sidebar moduli come BottomSheet su mobile. */}
        {platform.isMobile && (
          <BottomSheet
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            title={t("nav.modulesHeading")}
            maxHeight="70dvh"
          >
            <div className="px-2 pb-4">
              <ModuleSidebar embedded />
            </div>
          </BottomSheet>
        )}
      </div>
    </div>
  );
}

function MobileTabBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium",
        active ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
