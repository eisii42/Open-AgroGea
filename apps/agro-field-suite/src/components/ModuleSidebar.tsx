import {
  type DashboardModuleId,
  type FieldPanel,
  type DrawnGeometry,
  expiryStatus,
  loadOperatorMemory,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import {
  requestDrawerFocus,
  useBackDismiss,
  useEscapeDismiss,
  useMenuKeyboard,
} from "@agrogea/ui";
import { disableGeoEditorModes } from "@geolibre/plugins";
import { cn } from "@geolibre/ui";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CloudSun,
  Droplets,
  FileDown,
  Grid3x3,
  LandPlot,
  Leaf,
  List,
  ListChecks,
  type LucideIcon,
  MapPin,
  NotebookPen,
  PencilRuler,
  Printer,
  Route,
  Satellite,
  Settings,
  Shapes,
  ScanEye,
  ShieldCheck,
  Sprout,
  Tractor,
  Warehouse,
  Wheat,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useReadOnly } from "@agrogea/core";
import { SianExportDialog } from "../modules/sian/SianExportDialog";
import { buildTaskCompletenessEntries } from "../modules/tasks/task-completeness-view";

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
  /** `panel`: pannello che l'azione apre (per portarlo in primo piano). */
  | { kind: "run"; run: () => void; panel?: FieldPanel }
  | { kind: "soon" };

interface ToolDef {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  action: ToolAction;
  /** Flag del layout che ne governa la visibilità; assente = sempre visibile. */
  flag?: DashboardModuleId;
}

interface ModuleDef {
  id: string;
  labelKey: string;
  /** Etichetta breve sotto l'icona nella barra desktop (una parola). */
  railLabelKey: string;
  Icon: LucideIcon;
  tools: ToolDef[];
}

export function ModuleSidebar({
  embedded = false,
  rail = false,
  onToolSelected,
}: {
  /**
   * Desktop: barra di icone (76 px) con l'elenco degli strumenti a comparsa a
   * fianco del modulo scelto, invece della lista a fisarmonica da 260 px. La
   * lista resta disponibile (FieldDashboard, `DESKTOP_MODULE_NAV`).
   */
  rail?: boolean;
  /**
   * Chiamato dopo aver attivato uno strumento. Su mobile chiude il BottomSheet
   * "Moduli": altrimenti resta sopra al pannello appena aperto e lo copre, e
   * sembra che la voce non abbia fatto nulla.
   */
  onToolSelected?: () => void;
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
  const openComplianceGroup = useAgroStore((s) => s.openComplianceGroup);
  const openLogbookAllOperations = useAgroStore(
    (s) => s.openLogbookAllOperations,
  );
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

  // Badge "Record incompleti" (completezza PAN): task PROGRAMMATE e righe del
  // Quaderno che, così come sono, produrrebbero/sono un record non conforme.
  // Stesso motore riusato dal Riquadro Pianificazione (§TaskCompletenessPanel).
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);
  const treatments = useAgroStore((s) => s.treatments);
  const operatorMemory = useMemo(loadOperatorMemory, []);
  const completenessEntries = useMemo(
    () =>
      buildTaskCompletenessEntries({
        plannedTasks,
        recipes,
        treatments,
        operatorName: operatorMemory.name ?? null,
        operatorLicenseNumber: operatorMemory.license ?? null,
      }),
    [plannedTasks, recipes, treatments, operatorMemory],
  );
  const taskCompletenessAlerts = completenessEntries.filter(
    (e) => e.kind === "plannedTask",
  ).length;
  const logCompletenessAlerts = completenessEntries.filter(
    (e) => e.kind === "treatmentLog",
  ).length;

  const moduli: ModuleDef[] = [
    {
      id: "suolo",
      labelKey: "nav.moduleSoil",
      railLabelKey: "moduleRail.soil",
      Icon: Sprout,
      tools: [
        // La lista degli elementi tracciati vive QUI e non nel module di
        // disegno: da ogni voce si apre la scheda dell'appezzamento, che è dove
        // si leggono/modificano i parametri del suolo (tessitura, composizione,
        // pH…). Cercarla sotto "Disegna elemento" era controintuitivo. La
        // scheda resta anche il punto di modifica geometria/eliminazione.
        {
          id: "manage",
          labelKey: "nav.toolPlotList",
          Icon: List,
          action: { kind: "panel", panel: "registro" },
          flag: "panelRegistro",
        },
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
      railLabelKey: "moduleRail.crop",
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
      railLabelKey: "moduleRail.water",
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
      railLabelKey: "moduleRail.draw",
      Icon: PencilRuler,
      tools: [
        // Primo della lista perché è il flusso PRINCIPALE: in gran parte
        // d'Europa le particelle sono già pubblicate come dato aperto, e
        // ridisegnarle a mano è il ripiego, non la norma.
        {
          id: "parcel-adoption",
          labelKey: "nav.toolParcelAdoption",
          Icon: LandPlot,
          action: { kind: "panel", panel: "parcel-adoption" },
        },
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
          id: "stampa",
          labelKey: "nav.toolPrint",
          Icon: Printer,
          action: { kind: "panel", panel: "stampa" },
          flag: "panelStampa",
        },
      ],
    },
    {
      id: "tasks",
      labelKey: "nav.moduleTasks",
      railLabelKey: "moduleRail.tasks",
      Icon: ClipboardList,
      tools: [
        {
          id: "task-planner",
          labelKey: "nav.toolTaskPlanner",
          Icon: ListChecks,
          action: { kind: "panel", panel: "tasks" },
          flag: "panelTasks",
        },
      ],
    },
    {
      id: "qdc",
      labelKey: "nav.moduleLogbook",
      railLabelKey: "moduleRail.logbook",
      Icon: NotebookPen,
      tools: [
        {
          id: "quaderno",
          labelKey: "nav.toolOperations",
          Icon: NotebookPen,
          // Dal modulo il Quaderno mostra SEMPRE il registro dell'intera
          // azienda: `openLogbookAllOperations` azzera i filtri anche se il
          // pannello è già aperto e filtrato su un appezzamento.
          action: {
            kind: "run",
            run: () => openLogbookAllOperations(),
            panel: "quaderno",
          },
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
      railLabelKey: "moduleRail.warehouse",
      Icon: Warehouse,
      tools: [
        {
          id: "magazzino",
          labelKey: "nav.toolWarehouse",
          Icon: Warehouse,
          action: {
            kind: "run",
            run: () => openWarehouseTab("products"),
            panel: "magazzino",
          },
          flag: "panelMagazzino",
        },
        {
          id: "mezzi",
          labelKey: "nav.toolMachinery",
          Icon: Tractor,
          action: {
            kind: "run",
            run: () => openWarehouseTab("machines"),
            panel: "magazzino",
          },
          flag: "panelMezzi",
        },
      ],
    },
    {
      id: "impostazioni",
      labelKey: "nav.moduleSettings",
      railLabelKey: "moduleRail.company",
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
      ],
    },
    {
      // Normativa: modulo a sé, non una voce delle Impostazioni. La
      // conformità PAC è lavoro agronomico ricorrente — si consulta durante la
      // campagna, non quando si configura l'applicazione — e stava sotto
      // "Impostazioni Azienda" solo perché lì era finita la geo-compliance
      // delle origini, che è un'altra cosa (marcare i layer vincolanti).
      id: "normativa",
      labelKey: "nav.moduleCompliance",
      railLabelKey: "moduleRail.compliance",
      Icon: ScanEye,
      tools: [
        // Una voce per famiglia di schede: l'utente sceglie l'ambito e il
        // pannello si apre già lì, come il Magazzino fa con Prodotti/Mezzi.
        {
          id: "compliance-eligibility",
          labelKey: "compliance.group.eligibility",
          Icon: LandPlot,
          action: {
            kind: "run",
            run: () => openComplianceGroup("eligibility"),
            panel: "compliance-monitor",
          },
          flag: "panelGeoCompliance",
        },
        {
          id: "compliance-conditionality",
          labelKey: "compliance.group.conditionality",
          Icon: ShieldCheck,
          action: {
            kind: "run",
            run: () => openComplianceGroup("conditionality"),
            panel: "compliance-monitor",
          },
          flag: "panelGeoCompliance",
        },
        {
          id: "compliance-eco-schemes",
          labelKey: "compliance.group.ecoSchemes",
          Icon: Sprout,
          action: {
            kind: "run",
            run: () => openComplianceGroup("ecoSchemes"),
            panel: "compliance-monitor",
          },
          flag: "panelGeoCompliance",
        },
        {
          id: "compliance-transversal",
          labelKey: "compliance.group.transversal",
          Icon: Satellite,
          action: {
            kind: "run",
            run: () => openComplianceGroup("transversal"),
            panel: "compliance-monitor",
          },
          flag: "panelGeoCompliance",
        },
        {
          id: "compliance-organic",
          labelKey: "compliance.group.organic",
          Icon: Leaf,
          action: {
            kind: "run",
            run: () => openComplianceGroup("organic"),
            panel: "compliance-monitor",
          },
          flag: "panelGeoCompliance",
        },
        {
          // Marcatura dei layer vincolanti (ZVN, SIC/ZPS, EUDR, reticolo
          // idrografico, zone umide): è il presupposto delle schede
          // geometriche, e sta quindi qui e non fra le impostazioni.
          id: "geocompliance",
          labelKey: "nav.toolGeoCompliance",
          Icon: Shapes,
          action: { kind: "panel", panel: "geocompliance" },
          flag: "panelGeoCompliance",
        },
      ],
    },
  ];

  // All'avvio TUTTI i moduli sono richiusi (solo l'elenco delle voci di primo
  // livello): la sidebar si presenta compatta e l'utente espande ciò che serve.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Telefono (embedded): modulo aperto nella vista a riquadri; null = griglia.
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  // Tasto indietro con un modulo aperto: torna alla griglia (sta sopra il
  // foglio nella pila, quindi viene servito per primo).
  useBackDismiss(() => setOpenModuleId(null), embedded && openModuleId !== null);

  const toolState = (tool: ToolDef) => {
    const active =
      (tool.action.kind === "panel" && openPanels.includes(tool.action.panel)) ||
      (tool.action.kind === "draw" && drawIntent === tool.action.intent);
    // In sola reading blocco disegno e gestione (Modifica/Elimina).
    const mutating =
      tool.action.kind === "draw" ||
      (tool.action.kind === "panel" && tool.action.panel === "registro");
    const lockedReadOnly = readOnly && mutating;
    const disabled = tool.action.kind === "soon" || lockedReadOnly;
    // Il modulo resta evidenziato nella barra anche quando il suo pannello
    // è aperto da un'azione (es. Normativa → famiglia di schede), senza
    // accendere le singole voci dell'elenco.
    const moduleActive =
      active ||
      (tool.action.kind === "run" &&
        tool.action.panel !== undefined &&
        openPanels.includes(tool.action.panel));
    return { active, moduleActive, lockedReadOnly, disabled };
  };

  const runTool = (tool: ToolDef) => {
    if (toolState(tool).lockedReadOnly) return;
    const action = tool.action;
    if (action.kind === "panel") {
      // Aprire il registro = entrare in modalità gestione:
      // si esce dal disegno così il tap select gli elementi.
      if (action.panel === "registro") {
        setDrawIntent(null);
        disableGeoEditorModes();
      }
      // Desktop, più moduli aperti insieme: un modulo già aperto (magari
      // ridotto all'intestazione) torna in primo piano invece di chiudersi.
      const focused =
        !embedded &&
        openPanels.includes(action.panel) &&
        requestDrawerFocus(action.panel);
      if (!focused) togglePanel(action.panel);
    } else if (action.kind === "draw") {
      // Apre la suite di disegno (attiva il GeoEditor) e
      // imposta la modalità geometrica richiesta.
      if (!openPanels.includes("geoeditor")) {
        togglePanel("geoeditor");
      }
      setDrawIntent(action.intent);
    } else if (action.kind === "run") {
      action.run();
      if (!embedded && action.panel) requestDrawerFocus(action.panel);
    }
    // Riaprendo il foglio Moduli si riparte dalla griglia.
    setOpenModuleId(null);
    onToolSelected?.();
  };

  /** Badge di attenzione di un modulo, o null. */
  const moduleBadge = (id: string): { count: number; title: string } | null => {
    if (id === "magazzino" && warehouseAlerts > 0) {
      return {
        count: warehouseAlerts,
        title: t("moduleSidebar.warehouseAlerts", { count: warehouseAlerts }),
      };
    }
    if (id === "tasks" && taskCompletenessAlerts > 0) {
      return {
        count: taskCompletenessAlerts,
        title: t("moduleSidebar.taskCompletenessAlerts", {
          count: taskCompletenessAlerts,
        }),
      };
    }
    if (id === "qdc" && logCompletenessAlerts > 0) {
      return {
        count: logCompletenessAlerts,
        title: t("moduleSidebar.logCompletenessAlerts", {
          count: logCompletenessAlerts,
        }),
      };
    }
    return null;
  };

  // Telefono: griglia di riquadri (un modulo = un riquadro con icona) e, al
  // tocco, l'elenco dei suoi strumenti con "indietro". Sostituisce la
  // fisarmonica a due livelli, lunga e poco leggibile su 375 px.
  if (embedded) {
    const visibleModules = moduli
      .map((mod) => ({
        mod,
        tools: mod.tools.filter((tool) => !tool.flag || flags[tool.flag]),
      }))
      .filter((m) => m.tools.length > 0);
    const current = visibleModules.find((m) => m.mod.id === openModuleId);

    return (
      <div className="w-full p-1">
        {current ? (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setOpenModuleId(null)}
              className="mb-1 flex min-h-11 items-center gap-2 rounded-[var(--r-2)] px-2 text-left text-[15px] font-semibold active:bg-[var(--panel-2)]"
            >
              <ChevronLeft size={18} className="text-[var(--ink-3)]" />
              <current.mod.Icon size={18} className="text-[var(--accent)]" />
              <span className="flex-1">{t(current.mod.labelKey as never)}</span>
            </button>
            <div className="flex flex-col gap-0.5">
              {current.tools.map((tool) => {
                const { active, lockedReadOnly, disabled } = toolState(tool);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => runTool(tool)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-[var(--r-2)] px-3 text-left text-[15px]",
                      active
                        ? "bg-[var(--accent-l)] font-medium text-[var(--accent)]"
                        : "text-[var(--ink-2)] active:bg-[var(--panel-2)]",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <tool.Icon size={18} className="shrink-0" />
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
                    {!disabled && (
                      <ChevronRight size={16} className="shrink-0 text-[var(--ink-4)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {visibleModules.map(({ mod }) => {
              const badge = moduleBadge(mod.id);
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setOpenModuleId(mod.id)}
                  className="relative flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] px-1.5 py-2 text-center active:bg-[var(--panel-2)]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent-l)] text-[var(--accent)]">
                    <mod.Icon size={22} />
                  </span>
                  <span className="line-clamp-2 text-[12px] font-medium leading-tight text-[var(--ink-2)]">
                    {t(mod.labelKey as never)}
                  </span>
                  {badge && (
                    <span
                      title={badge.title}
                      className="absolute right-1.5 top-1.5 rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] font-semibold text-[var(--warn)]"
                    >
                      {badge.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <SianExportDialog open={sianOpen} onClose={() => setSianOpen(false)} />
      </div>
    );
  }

  if (rail) {
    return (
      <ModuleRail
        modules={moduli
          .map((mod) => ({
            mod,
            tools: mod.tools.filter((tool) => !tool.flag || flags[tool.flag]),
          }))
          .filter((m) => m.tools.length > 0)}
        openModuleId={openModuleId}
        setOpenModuleId={setOpenModuleId}
        toolState={toolState}
        runTool={runTool}
        moduleBadge={moduleBadge}
      >
        <SianExportDialog open={sianOpen} onClose={() => setSianOpen(false)} />
      </ModuleRail>
    );
  }

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
          (tool) => !tool.flag || flags[tool.flag],
        );
        if (visibleTools.length === 0) return null;
        const isOpen = expanded[mod.id] ?? false;
        return (
          <div key={mod.id}>
            <button
              type="button"
              onClick={(event) => {
                setExpanded((e) => ({ ...e, [mod.id]: !isOpen }));
                // Espandendo un modulo in fondo all'elenco (es. Normativa) le
                // voci finirebbero sotto il bordo del foglio mobile, senza
                // alcun segnale: si porta in vista l'intero gruppo.
                if (!isOpen) {
                  const group = event.currentTarget.parentElement;
                  requestAnimationFrame(() =>
                    group?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
                  );
                }
              }}
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
              {mod.id === "tasks" && taskCompletenessAlerts > 0 && (
                <span
                  title={t("moduleSidebar.taskCompletenessAlerts", {
                    count: taskCompletenessAlerts,
                  })}
                  className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] font-semibold text-[var(--warn)]"
                >
                  {taskCompletenessAlerts} ⚠
                </span>
              )}
              {mod.id === "qdc" && logCompletenessAlerts > 0 && (
                <span
                  title={t("moduleSidebar.logCompletenessAlerts", {
                    count: logCompletenessAlerts,
                  })}
                  className="rounded-full bg-[var(--warn-l)] px-1.5 text-[10px] font-semibold text-[var(--warn)]"
                >
                  {logCompletenessAlerts} ⚠
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
                  const { active, lockedReadOnly, disabled } = toolState(tool);
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
                      onClick={() => runTool(tool)}
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

interface RailModule {
  mod: ModuleDef;
  tools: ToolDef[];
}

/**
 * Barra moduli desktop: una colonna di icone con etichetta breve e, al clic,
 * l'elenco degli strumenti del modulo in una scheda a comparsa accanto alla
 * voce (lo stesso "entra nel modulo" della griglia del telefono). La mappa
 * guadagna i 200 px che la lista a fisarmonica occupava sempre.
 *
 * La scheda si chiude scegliendo uno strumento, cliccando fuori, con Esc o
 * cliccando di nuovo sul modulo. Un modulo con uno strumento attivo (pannello
 * aperto, disegno in corso) resta evidenziato anche a scheda chiusa.
 */
function ModuleRail({
  modules,
  openModuleId,
  setOpenModuleId,
  toolState,
  runTool,
  moduleBadge,
  children,
}: {
  modules: RailModule[];
  openModuleId: string | null;
  setOpenModuleId: (id: string | null) => void;
  toolState: (tool: ToolDef) => {
    active: boolean;
    moduleActive: boolean;
    lockedReadOnly: boolean;
    disabled: boolean;
  };
  runTool: (tool: ToolDef) => void;
  moduleBadge: (id: string) => { count: number; title: string } | null;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  // Aperta da tastiera (Invio/Spazio sul modulo): il focus passa alla prima
  // voce dell'elenco, così si prosegue con le frecce.
  const focusFirstRef = useRef(false);
  const [anchorTop, setAnchorTop] = useState(0);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const current = modules.find((m) => m.mod.id === openModuleId) ?? null;
  const isOpen = current !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenModuleId(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen, setOpenModuleId]);
  useEscapeDismiss(() => setOpenModuleId(null), isOpen);
  // Frecce: fra i moduli nella barra, fra gli strumenti nell'elenco.
  useMenuKeyboard(navRef, true, "button");
  useMenuKeyboard(flyoutRef, isOpen);

  // La scheda parte all'altezza della voce, ma non esce dal fondo della mappa.
  useLayoutEffect(() => {
    const flyout = flyoutRef.current;
    const root = rootRef.current;
    if (!flyout || !root) return;
    const maxTop = root.clientHeight - flyout.offsetHeight - 8;
    setFlyoutTop(Math.max(8, Math.min(anchorTop, maxTop)));
    if (focusFirstRef.current) {
      focusFirstRef.current = false;
      flyout.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    }
  }, [anchorTop, openModuleId]);

  return (
    <div ref={rootRef} className="relative h-full">
      <nav
        ref={navRef}
        aria-label={t("nav.modulesHeading")}
        className="no-scrollbar flex h-full w-[76px] flex-col items-center gap-1 overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] py-2"
      >
        {modules.map(({ mod, tools }) => {
          const open = mod.id === openModuleId;
          const active = tools.some((tool) => toolState(tool).moduleActive);
          const badge = moduleBadge(mod.id);
          return (
            <button
              key={mod.id}
              type="button"
              title={t(mod.labelKey as never)}
              aria-expanded={open}
              aria-haspopup="menu"
              onClick={(e) => {
                if (open) {
                  setOpenModuleId(null);
                  return;
                }
                const nav = e.currentTarget.parentElement;
                setAnchorTop(e.currentTarget.offsetTop - (nav?.scrollTop ?? 0));
                // detail 0: clic generato da tastiera, non dal mouse.
                focusFirstRef.current = e.detail === 0;
                setOpenModuleId(mod.id);
              }}
              className={cn(
                "relative flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-[var(--r-2)] px-0.5 py-2 text-center",
                open || active
                  ? "bg-[var(--accent-l)] text-[var(--accent)]"
                  : "text-[var(--ink-3)] hover:bg-[var(--panel-2)] hover:text-[var(--ink-2)]",
              )}
            >
              <mod.Icon size={20} />
              <span className="w-full truncate text-[11px] font-medium leading-tight">
                {t(mod.railLabelKey as never)}
              </span>
              {badge && (
                <span
                  title={badge.title}
                  className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warn)] px-1 text-[10px] font-semibold leading-none text-white"
                >
                  {badge.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {current && (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={t(current.mod.labelKey as never)}
          style={{ top: flyoutTop }}
          className="absolute left-[calc(100%+8px)] z-10 flex max-h-[calc(100%-16px)] w-64 flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--line)] py-1.5 pl-3 pr-1.5">
            <current.mod.Icon size={16} className="shrink-0 text-[var(--accent)]" />
            <h2 className="flex-1 truncate text-sm font-semibold text-[var(--ink)]">
              {t(current.mod.labelKey as never)}
            </h2>
            <button
              type="button"
              onClick={() => setOpenModuleId(null)}
              aria-label={t("moduleRail.close")}
              title={t("moduleRail.close")}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1.5">
            {current.tools.map((tool) => {
              const { active, lockedReadOnly, disabled } = toolState(tool);
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  title={
                    lockedReadOnly ? t("moduleSidebar.readOnlyUnavailable") : undefined
                  }
                  onClick={() => runTool(tool)}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 rounded-[var(--r-2)] px-2.5 py-1.5 text-left text-[13px]",
                    active
                      ? "bg-[var(--accent-l)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <tool.Icon size={16} className="shrink-0" />
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
        </div>
      )}
      {children}
    </div>
  );
}
