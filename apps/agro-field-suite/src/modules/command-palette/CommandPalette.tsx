import {
  boundingBox,
  cropForPlot,
  type DashboardModuleId,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ComandoBase,
  filterCommands,
} from "./command-match";
import type { UndoRedoApi } from "../../hooks/useGeometryUndoRedo";

/**
 * Command Palette globale (Ctrl/Cmd+K): navigazione headless della suite.
 * Digitando il name di un plot si esegue il flyTo sul suo poligono;
 * digitando un'azione si apre il pannello / si attiva lo strumento. Annulla e
 * ripristina geometria compaiono durante una sessione di editing.
 */

interface Comando extends ComandoBase {
  esegui: () => void;
  /** Suggerimento scorciatoia tastiera mostrato a destra (es. "Ctrl+Z"). */
  scorciatoia?: string;
  /** Flag del layout che ne governa la visibilità; assente = sempre visibile. */
  flag?: DashboardModuleId;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  mapControllerRef: RefObject<MapController | null>;
  undoRedo: UndoRedoApi;
}

export function CommandPalette({
  open,
  onClose,
  mapControllerRef,
  undoRedo,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const crops = useAgroStore((s) => s.crops);
  const campaignFields = useAgroStore((s) => s.campaignFields);
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const setDrawIntent = useAgroStore((s) => s.setDrawIntent);
  const selectPlot = useAgroStore((s) => s.selectPlot);
  const setActiveView = useAgroStore((s) => s.setActiveView);
  const flags = useSettingsStore((s) => s.dashboardLayout);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const comandi = useMemo<Comando[]>(() => {
    const openPanel = (panel: Parameters<typeof togglePanel>[0]) => () => {
      if (!openPanels.includes(panel)) togglePanel(panel);
      onClose();
    };
    const disegna = (intent: "polygon" | "line" | "point") => () => {
      if (!openPanels.includes("geoeditor")) togglePanel("geoeditor");
      setDrawIntent(intent);
      onClose();
    };

    const azioni: Comando[] = [
      {
        id: "act-ndvi",
        title: t("commandPalette.actions.ndvi"),
        categoria: "azione",
        paroleChiave: ["analisi", "suolo", "satellite", "sentinel"],
        esegui: openPanel("ndvi"),
        flag: "panelNdvi",
      },
      {
        id: "act-vra",
        title: t("commandPalette.actions.vra"),
        categoria: "azione",
        paroleChiave: ["prescrizione", "isobus", "concimazione"],
        esegui: openPanel("vra"),
        flag: "panelVra",
      },
      {
        id: "act-tratt",
        title: t("commandPalette.actions.newTreatment"),
        categoria: "azione",
        paroleChiave: ["quaderno", "registro", "operazione"],
        esegui: openPanel("quaderno"),
        flag: "panelQuaderno",
      },
      {
        id: "act-coltura",
        title: t("commandPalette.actions.cropSheet"),
        categoria: "azione",
        paroleChiave: ["fenologia", "modelli"],
        esegui: openPanel("coltura"),
        flag: "panelColtura",
      },
      {
        id: "act-draw-poly",
        title: t("commandPalette.actions.drawPlot"),
        categoria: "azione",
        paroleChiave: ["poligono", "nuovo campo"],
        esegui: disegna("polygon"),
      },
      {
        id: "act-draw-line",
        title: t("commandPalette.actions.drawInfrastructure"),
        categoria: "azione",
        paroleChiave: ["linea", "asset"],
        esegui: disegna("line"),
      },
      {
        id: "act-draw-poi",
        title: t("commandPalette.actions.drawPoi"),
        categoria: "azione",
        paroleChiave: ["punto", "trappola", "sensore"],
        esegui: disegna("point"),
      },
      {
        id: "act-registro",
        title: t("commandPalette.actions.editGeometries"),
        categoria: "azione",
        paroleChiave: ["registro", "gestione"],
        esegui: openPanel("registro"),
        flag: "panelRegistro",
      },
      {
        id: "act-stampa",
        title: t("commandPalette.actions.printMap"),
        categoria: "azione",
        paroleChiave: ["print", "composer", "pdf", "pac", "psr"],
        esegui: openPanel("stampa"),
        flag: "panelStampa",
      },
      {
        id: "act-impostazioni",
        title: t("commandPalette.actions.companySettings"),
        categoria: "azione",
        paroleChiave: ["meteo", "config"],
        esegui: openPanel("impostazioni"),
        flag: "panelMeteo",
      },
      {
        id: "act-profile",
        title: t("commandPalette.actions.profileSettings"),
        categoria: "azione",
        paroleChiave: ["profile", "preferenze", "lingua", "unità", "moduli", "account"],
        esegui: openPanel("profile"),
      },
      // Switch di vista: la freccia → è la scorciatoia globale registrata in
      // App.tsx (← riporta alla mappa). La palette vive nella vista mappa,
      // quindi qui serve solo la direzione verso il Command Center.
      {
        id: "act-command-center",
        title: t("commandPalette.actions.openCommandCenter"),
        categoria: "azione",
        paroleChiave: ["dashboard", "dati", "kpi", "analisi", "report", "vista"],
        scorciatoia: "→",
        esegui: () => {
          setActiveView("command-center");
          onClose();
        },
      },
    ];

    if (undoRedo.canUndo) {
      azioni.push({
        id: "act-undo",
        title: t("commandPalette.actions.undoGeometry"),
        categoria: "azione",
        paroleChiave: ["undo", "indietro"],
        scorciatoia: "Ctrl+Z",
        esegui: () => {
          undoRedo.undo();
          onClose();
        },
      });
    }
    if (undoRedo.canRedo) {
      azioni.push({
        id: "act-redo",
        title: t("commandPalette.actions.redoGeometry"),
        categoria: "azione",
        paroleChiave: ["redo", "avanti"],
        scorciatoia: "Ctrl+Y",
        esegui: () => {
          undoRedo.redo();
          onClose();
        },
      });
    }

    const navigazione: Comando[] = plots.map((plot) => {
      const crop = cropForPlot(plot.id, campaignFields, crops);
      return {
      id: `apz-${plot.id}`,
      title: plot.user_plot_name,
      sottotitolo: crop ?? undefined,
      categoria: "appezzamento",
      paroleChiave: [crop ?? "", "vai", "mappa"].filter(Boolean),
      esegui: () => {
        const bounds = boundingBox(plot.geometry);
        mapControllerRef.current?.fitBounds(bounds);
        void selectPlot(plot.id);
        onClose();
      },
      };
    });

    // Le azioni di moduli disattivati nel layout dell'utente non compaiono.
    const azioniVisibili = azioni.filter((a) => !a.flag || flags[a.flag]);
    return [...azioniVisibili, ...navigazione];
  }, [
    plots,
    crops,
    campaignFields,
    openPanels,
    togglePanel,
    setDrawIntent,
    selectPlot,
    setActiveView,
    mapControllerRef,
    onClose,
    undoRedo,
    flags,
    t,
  ]);

  const risultati = useMemo(
    () => filterCommands(comandi, query),
    [comandi, query],
  );

  // Reset query/selezione e focus all'apertura.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus dopo il mount dell'overlay.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Mantiene la selezione entro i risultati correnti.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, risultati.length - 1)));
  }, [risultati.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, risultati.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      risultati[activeIndex]?.esegui();
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[60vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-2)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("commandPalette.searchPlaceholder")}
          className="border-b border-[var(--line)] bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {risultati.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--ink-4)]">
              {t("commandPalette.noResults", { query })}
            </p>
          ) : (
            risultati.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => cmd.esegui()}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                  i === activeIndex
                    ? "bg-[var(--accent-l)] text-[var(--accent)]"
                    : "text-[var(--ink-2)]",
                )}
              >
                <span className="flex-1 truncate">{cmd.title}</span>
                {cmd.sottotitolo && (
                  <span className="truncate text-xs text-[var(--ink-4)]">
                    {cmd.sottotitolo}
                  </span>
                )}
                {cmd.scorciatoia && (
                  <kbd className="rounded border border-[var(--line)] bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-3)]">
                    {cmd.scorciatoia}
                  </kbd>
                )}
                <span className="rounded-full bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--ink-4)]">
                  {cmd.categoria === "appezzamento"
                    ? t("commandPalette.category.goTo")
                    : t("commandPalette.category.action")}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
