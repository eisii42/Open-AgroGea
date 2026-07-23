import {
  type DashboardModuleId,
  type FieldPanel,
  type DrawnGeometry,
  expiryStatus,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import { disableGeoEditorModes } from "@geolibre/plugins";
import { cn } from "@geolibre/ui";
import {
  Building2,
  ChevronRight,
  CloudSun,
  Droplets,
  FileDown,
  Grid3x3,
  Leaf,
  type LucideIcon,
  MapPin,
  MousePointerClick,
  NotebookPen,
  PencilRuler,
  Printer,
  Route,
  Satellite,
  Settings,
  Shapes,
  ShieldCheck,
  Sprout,
  Tractor,
  Warehouse,
  Wheat,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useReadOnly } from "@agrogea/core";
import { STANDALONE } from "../standalone";
import { SianExportDialog } from "../modules/sian/SianExportDialog";

/**
 * Sidebar moduli a scomparsa (Modulo UI §5 + §6). Raccoglie gli strumenti
 * agronomici nei rispettivi moduli (Suolo→NDVI, Acqua→bilancio idrico,
 * Disegno→GeoEditor, QDC→Quaderno + export SIAN). Scorre fuori schermo via
 * transform (la mappa non si rimonta): il toggle è la maniglia fluttuante in
 * `FieldDashboard`.
 */

type ToolAction =
  | { kind: "panel"; panel: FieldPanel }
  | { kind: "draw"; intent: DrawnGeometry }
  | { kind: "run"; run: () => void }
  | { kind: "soon" };

interface ToolDef {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  action: ToolAction;
  /** Flag del layout che ne governa la visibilità; assente = sempre visibile. */
  flag?: DashboardModuleId;
  /** Strumento proprietario/cloud: nascosto nelle build standalone/OSS. */
  cloudOnly?: boolean;
}

interface ModuleDef {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  tools: ToolDef[];
}

export function ModuleSidebar({
  embedded = false,
}: {
  /**
   * true quando è annidato nel BottomSheet mobile "Moduli" (FieldDashboard),
   * che fornisce già title, chiusura e larghezza piena: sopprime l'intestazione
   * e i vincoli di layout desktop (larghezza fissa, bordo, altezza piena) per
   * evitare la doppia intestazione "MODULI AGRONOMICI".
   */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const openWarehouseTab = useAgroStore((s) => s.openWarehouseTab);
  const drawIntent = useAgroStore((s) => s.drawIntent);
  const setDrawIntent = useAgroStore((s) => s.setDrawIntent);
  const flags = useSettingsStore((s) => s.dashboardLayout);
  // Sola reading (ruolo VIEWER): gli strumenti che MUTANO la geometria/i Field
  // Attributes (disegno, Modifica/Elimina) vanno disattivati.
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);

  // Dialog di configurazione dell'export SIAN (filters + struttura CSV).
  const [sianOpen, setSianOpen] = useState(false);

  // Badge alert Magazzino (v17): lots con stock scaduti o in scadenza.
  const lots = useAgroStore((s) => s.lots);
  const warehouseAlerts = lots.filter(
    (l) =>
      l.deleted_at == null &&
      Number(l.quantity_on_hand) > 0 &&
      expiryStatus(l.expires_at) !== "valid",
  ).length;

  const moduli: ModuleDef[] = [
    {
      id: "suolo",
      labelKey: "nav.moduleSoil",
      Icon: Sprout,
      tools: [
        {
          id: "ndvi",
          labelKey: "nav.toolNdvi",
          Icon: Satellite,
          action: { kind: "panel", panel: "ndvi" },
          flag: "panelNdvi",
        },
        {
          id: "vra",
          labelKey: "nav.toolVra",
          Icon: Grid3x3,
          action: { kind: "panel", panel: "vra" },
          flag: "panelVra",
        },
      ],
    },
    {
      id: "coltura",
      labelKey: "nav.moduleCrop",
      Icon: Leaf,
      tools: [
        {
          id: "coltura",
          labelKey: "moduleSidebar.cropData",
          Icon: Leaf,
          action: { kind: "panel", panel: "coltura" },
          flag: "panelColtura",
        },
        {
          id: "coltura-dss",
          labelKey: "moduleSidebar.dssModels",
          Icon: Leaf,
          action: { kind: "panel", panel: "coltura-dss" },
          flag: "panelColtura",
        },
      ],
    },
    {
      id: "acqua",
      labelKey: "nav.moduleWater",
      Icon: Droplets,
      tools: [
        {
          id: "irrigazione",
          labelKey: "nav.toolWaterBalance",
          Icon: Droplets,
          action: { kind: "panel", panel: "acqua" },
          flag: "panelAcqua",
        },
      ],
    },
    {
      id: "disegno",
      labelKey: "nav.moduleDraw",
      Icon: PencilRuler,
      tools: [
        {
          id: "draw-appezzamento",
          labelKey: "nav.toolDrawPlot",
          Icon: Shapes,
          action: { kind: "draw", intent: "polygon" },
        },
        {
          id: "draw-infrastruttura",
          labelKey: "nav.toolDrawInfra",
          Icon: Route,
          action: { kind: "draw", intent: "line" },
        },
        {
          id: "draw-poi",
          labelKey: "nav.toolDrawPoi",
          Icon: MapPin,
          action: { kind: "draw", intent: "point" },
        },
        {
          id: "manage",
          labelKey: "nav.toolManage",
          Icon: MousePointerClick,
          action: { kind: "panel", panel: "registro" },
          flag: "panelRegistro",
        },
        {
          id: "stampa",
          labelKey: "nav.toolPrint",
          Icon: Printer,
          action: { kind: "panel", panel: "stampa" },
          flag: "panelStampa",
        },
      ],
    },
    {
      id: "qdc",
      labelKey: "nav.moduleLogbook",
      Icon: NotebookPen,
      tools: [
        {
          id: "quaderno",
          labelKey: "nav.toolOperations",
          Icon: NotebookPen,
          action: { kind: "panel", panel: "quaderno" },
          flag: "panelQuaderno",
        },
        {
          id: "raccolta",
          labelKey: "nav.toolHarvest",
          Icon: Wheat,
          action: { kind: "panel", panel: "raccolta" },
          flag: "panelRaccolta",
        },
        {
          id: "sian",
          labelKey: "moduleSidebar.exportSian",
          Icon: FileDown,
          action: { kind: "run", run: () => setSianOpen(true) },
          flag: "panelSian",
        },
      ],
    },
    {
      id: "magazzino",
      labelKey: "nav.moduleWarehouse",
      Icon: Warehouse,
      tools: [
        {
          id: "magazzino",
          labelKey: "nav.toolWarehouse",
          Icon: Warehouse,
          action: { kind: "run", run: () => openWarehouseTab("products") },
          flag: "panelMagazzino",
        },
        {
          id: "mezzi",
          labelKey: "nav.toolMachinery",
          Icon: Tractor,
          action: { kind: "run", run: () => openWarehouseTab("machines") },
          flag: "panelMezzi",
        },
      ],
    },
    {
      id: "impostazioni",
      labelKey: "nav.moduleSettings",
      Icon: Settings,
      tools: [
        {
          id: "anagrafica",
          labelKey: "nav.toolProfile",
          Icon: Building2,
          action: { kind: "panel", panel: "anagrafica" },
          flag: "panelAnagrafica",
        },
        {
          id: "impostazioni",
          labelKey: "nav.toolWeather",
          Icon: CloudSun,
          action: { kind: "panel", panel: "impostazioni" },
          flag: "panelMeteo",
        },
        {
          id: "geocompliance",
          labelKey: "nav.toolGeoCompliance",
          Icon: ShieldCheck,
          action: { kind: "panel", panel: "geocompliance" },
          flag: "panelGeoCompliance",
          cloudOnly: true,
        },
      ],
    },
  ];

  // All'avvio TUTTI i moduli sono richiusi (solo l'elenco delle voci di primo
  // livello): la sidebar si presenta compatta e l'utente espande ciò che serve.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-2",
        embedded
          ? "w-full"
          : "h-full w-[260px] overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)]",
      )}
    >
      {!embedded && (
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("nav.modulesHeading")}
        </p>
      )}
      {moduli.map((mod) => {
        // I tool disattivati nel layout dell'utente spariscono; un module senza
        // più tool visibili viene nascosto del tutto (UI pulita).
        const visibleTools = mod.tools.filter(
          (tool) =>
            (!tool.flag || flags[tool.flag]) &&
            !(tool.cloudOnly && STANDALONE),
        );
        if (visibleTools.length === 0) return null;
        const isOpen = expanded[mod.id] ?? false;
        return (
          <div key={mod.id}>
            <button
              type="button"
              onClick={() =>
                setExpanded((e) => ({ ...e, [mod.id]: !isOpen }))
              }
              className="flex w-full items-center gap-2 rounded-[var(--r-2)] px-2 py-2 text-left text-sm font-medium hover:bg-[var(--panel-2)]"
            >
              <mod.Icon size={16} className="text-[var(--accent)]" />
              <span className="flex-1">{t(mod.labelKey as never)}</span>
              {mod.id === "magazzino" && warehouseAlerts > 0 && (
                <span
                  title={t("moduleSidebar.warehouseAlerts", {
                    count: warehouseAlerts,
                  })}
                  className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] font-semibold text-[var(--warn)]"
                >
                  {warehouseAlerts} ⚠
                </span>
              )}
              <ChevronRight
                size={15}
                className={cn(
                  "text-[var(--ink-4)] transition-transform",
                  isOpen && "rotate-90",
                )}
              />
            </button>
            {isOpen && (
              <div className="ml-2 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                {visibleTools.map((tool) => {
                  const active =
                    (tool.action.kind === "panel" &&
                      openPanels.includes(tool.action.panel)) ||
                    (tool.action.kind === "draw" &&
                      drawIntent === tool.action.intent);
                  // In sola reading blocco disegno e gestione (Modifica/Elimina).
                  const mutating =
                    tool.action.kind === "draw" ||
                    (tool.action.kind === "panel" &&
                      tool.action.panel === "registro");
                  const lockedReadOnly = readOnly && mutating;
                  const disabled = tool.action.kind === "soon" || lockedReadOnly;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      disabled={disabled}
                      title={
                        lockedReadOnly
                          ? t("moduleSidebar.readOnlyUnavailable")
                          : undefined
                      }
                      onClick={() => {
                        if (lockedReadOnly) return;
                        const action = tool.action;
                        if (action.kind === "panel") {
                          // Aprire il registro = entrare in modalità gestione:
                          // si esce dal disegno così il tap select gli elementi.
                          if (action.panel === "registro") {
                            setDrawIntent(null);
                            disableGeoEditorModes();
                          }
                          togglePanel(action.panel);
                        } else if (action.kind === "draw") {
                          // Apre la suite di disegno (attiva il GeoEditor) e
                          // imposta la modalità geometrica richiesta.
                          if (!openPanels.includes("geoeditor")) {
                            togglePanel("geoeditor");
                          }
                          setDrawIntent(action.intent);
                        } else if (action.kind === "run") {
                          action.run();
                        }
                      }}
                      className={cn(
                        "flex min-h-[40px] items-center gap-2 rounded-[var(--r-2)] px-2 py-1.5 text-left text-[13px]",
                        active
                          ? "bg-[var(--accent-l)] font-medium text-[var(--accent)]"
                          : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <tool.Icon size={15} className="shrink-0" />
                      <span className="flex-1">{t(tool.labelKey as never)}</span>
                      {tool.action.kind === "soon" && (
                        <span className="rounded-full bg-[var(--panel-3)] px-1.5 text-[10px] text-[var(--ink-4)]">
                          {t("nav.soon")}
                        </span>
                      )}
                      {lockedReadOnly && (
                        <span className="rounded-full bg-[var(--panel-3)] px-1.5 text-[10px] text-[var(--ink-4)]">
                          {t("moduleSidebar.readOnly")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <SianExportDialog open={sianOpen} onClose={() => setSianOpen(false)} />
    </div>
  );
}
