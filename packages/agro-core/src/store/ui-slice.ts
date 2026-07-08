import { applyTheme, loadTheme, persistTheme } from "../field/theme";
import type { StoreGet, StoreSet, UiSlice } from "./state";

/** Slice UI della Modalità Campo: tema, viste, pannelli e selezioni di scheda. */
export function createUiSlice(set: StoreSet, get: StoreGet): UiSlice {
  return {
    theme: loadTheme(),
    activeView: "map",
    panelMode: "docked",
    openPanels: [],
    // All'avvio la barra moduli è chiusa: mappa a tutto schermo, l'utente apre i
    // moduli quando servono (toggle nella colonna fluttuante).
    sidebarCollapsed: true,
    selectedPlotId: null,
    lastOperation: null,
    logbookOpenPlotId: null,
    scoutingOpenObservationId: null,
    cropOpenPlotId: null,
    mapOperationIds: null,
    scoutingPlacing: false,

    setTheme: (theme) => {
      persistTheme(theme);
      applyTheme(theme);
      set({ theme });
    },

    setActiveView: (view) => set({ activeView: view }),

    toggleSidebar: () =>
      set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

    togglePanel: (panel) =>
      set((s) => {
        if (s.openPanels.includes(panel)) {
          return { openPanels: s.openPanels.filter((p) => p !== panel) };
        }
        // In modalità docked il drawer è single-instance (Design.md).
        return {
          openPanels:
            s.panelMode === "docked" ? [panel] : [...s.openPanels, panel],
        };
      }),

    setPanelMode: (mode) =>
      set((s) => ({
        panelMode: mode,
        openPanels: mode === "docked" ? s.openPanels.slice(-1) : s.openPanels,
      })),

    selectPlot: async (id) => {
      set({ selectedPlotId: id, lastOperation: null });
      if (!id) return;
      const dal = get().dal;
      if (!dal) return;
      // Inietta l'ultima operation del logbook per la scheda di dettaglio.
      const last = await dal.lastOperation(id);
      // Evita race: l'utente potrebbe aver già cambiato selezione.
      if (get().selectedPlotId === id) {
        set({ lastOperation: last });
      }
    },

    openLogbookForPlot: (plotId) =>
      set((s) => ({
        logbookOpenPlotId: plotId,
        // La scheda dettaglio è un drawer destro come il Quaderno: la chiudo.
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["quaderno"]
            : s.openPanels.includes("quaderno")
              ? s.openPanels
              : [...s.openPanels, "quaderno"],
      })),

    consumeLogbookOpen: () => set({ logbookOpenPlotId: null }),

    openScoutingForObservation: (observationId) =>
      set((s) => ({
        scoutingOpenObservationId: observationId,
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["scouting"]
            : s.openPanels.includes("scouting")
              ? s.openPanels
              : [...s.openPanels, "scouting"],
      })),

    consumeScoutingOpen: () => set({ scoutingOpenObservationId: null }),

    // CTA compliance SIAN (v17): apre la scheda "Dati coltura" già puntata
    // sull'appezzamento (stesso pattern del Quaderno/Scouting).
    openCropForPlot: (plotId) =>
      set((s) => ({
        cropOpenPlotId: plotId,
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["coltura"]
            : s.openPanels.includes("coltura")
              ? s.openPanels
              : [...s.openPanels, "coltura"],
      })),

    consumeCropOpen: () => set({ cropOpenPlotId: null }),

    setMapOperationIds: (ids) => set({ mapOperationIds: ids }),

    setScoutingPlacing: (placing) => set({ scoutingPlacing: placing }),
  };
}
