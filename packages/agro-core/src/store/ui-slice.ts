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
    appezzamentoSelezionatoId: null,
    ultimaOperazione: null,
    quadernoApriAppezzamentoId: null,
    scoutingApriOsservazioneId: null,
    colturaApriAppezzamentoId: null,
    operazioniMappaIds: null,
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

    selectAppezzamento: async (id) => {
      set({ appezzamentoSelezionatoId: id, ultimaOperazione: null });
      if (!id) return;
      const dal = get().dal;
      if (!dal) return;
      // Inietta l'ultima operazione del quaderno per la scheda di dettaglio.
      const ultima = await dal.ultimaOperazione(id);
      // Evita race: l'utente potrebbe aver già cambiato selezione.
      if (get().appezzamentoSelezionatoId === id) {
        set({ ultimaOperazione: ultima });
      }
    },

    apriQuadernoPerAppezzamento: (appezzamentoId) =>
      set((s) => ({
        quadernoApriAppezzamentoId: appezzamentoId,
        // La scheda dettaglio è un drawer destro come il Quaderno: la chiudo.
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["quaderno"]
            : s.openPanels.includes("quaderno")
              ? s.openPanels
              : [...s.openPanels, "quaderno"],
      })),

    consumaQuadernoApri: () => set({ quadernoApriAppezzamentoId: null }),

    apriScoutingPerOsservazione: (osservazioneId) =>
      set((s) => ({
        scoutingApriOsservazioneId: osservazioneId,
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["scouting"]
            : s.openPanels.includes("scouting")
              ? s.openPanels
              : [...s.openPanels, "scouting"],
      })),

    consumaScoutingApri: () => set({ scoutingApriOsservazioneId: null }),

    // CTA compliance SIAN (v17): apre la scheda "Dati coltura" già puntata
    // sull'appezzamento (stesso pattern del Quaderno/Scouting).
    apriColturaPerAppezzamento: (appezzamentoId) =>
      set((s) => ({
        colturaApriAppezzamentoId: appezzamentoId,
        selectedFeature: null,
        openPanels:
          s.panelMode === "docked"
            ? ["coltura"]
            : s.openPanels.includes("coltura")
              ? s.openPanels
              : [...s.openPanels, "coltura"],
      })),

    consumaColturaApri: () => set({ colturaApriAppezzamentoId: null }),

    setOperazioniMappaIds: (ids) => set({ operazioniMappaIds: ids }),

    setScoutingPlacing: (placing) => set({ scoutingPlacing: placing }),
  };
}
