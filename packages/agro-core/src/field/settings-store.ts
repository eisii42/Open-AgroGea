import { create } from "zustand";
import { controlPlane } from "../control-plane";
import type { ProfiloUtente } from "../types";
import { loadLocale } from "./locale";
import {
  DEFAULT_UNITS,
  type DashboardLayoutConfig,
  type DashboardModuleId,
  type UnitSystem,
  loadDashboardLayout,
  loadUnits,
  mergeDashboardLayout,
  persistDashboardLayout,
  persistUnits,
} from "./settings";

/**
 * Store delle preferenze d'interfaccia dell'utente (Modulo Profilo §1).
 *
 * Persistenza LOCAL-FIRST a due livelli:
 *   1. ogni mutazione scrive SUBITO in localStorage (istantaneo, offline-safe);
 *   2. una push DEBOUNCED sincronizza il control plane
 *      (`profili_utenti.dashboard_layout_config` / `preferenze`) appena la rete
 *      è disponibile, così le preferenze seguono l'utente cross-device.
 *
 * È deliberatamente separato da {@link useAgroStore}: lo stato di dominio
 * (per-tenant, da PGlite) e le preferenze d'utente (per-account, da localStorage
 * + control plane) hanno cicli di vita e scope diversi.
 */

/** Stato della sincronizzazione remota delle preferenze. */
export type PreferencesSyncState = "idle" | "saving" | "saved" | "error" | "offline";

export interface SettingsState {
  dashboardLayout: DashboardLayoutConfig;
  units: UnitSystem;
  /** Esito dell'ultima sincronizzazione cross-device (UI feedback). */
  remoteSync: PreferencesSyncState;

  setModuleEnabled: (id: DashboardModuleId, enabled: boolean) => void;
  toggleModule: (id: DashboardModuleId) => void;
  isModuleEnabled: (id: DashboardModuleId) => boolean;
  /** Ripristina il layout di default (tutti i moduli ai valori iniziali). */
  resetLayout: () => void;
  setUnits: (patch: Partial<UnitSystem>) => void;
  /**
   * Idrata le preferenze dal profilo remoto (al login), se presenti: il control
   * plane vince per garantire la coerenza cross-device. Persiste anche in
   * localStorage così l'avvio offline successivo parte già allineato.
   */
  hydrateFromProfile: (profilo: ProfiloUtente | null) => void;
  /** Forza la sincronizzazione remota immediata (annulla il debounce). */
  flushRemote: () => Promise<void>;
}

/** Ritardo del debounce della push remota: assorbe sequenze di toggle rapide. */
const REMOTE_PUSH_DEBOUNCE_MS = 800;

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const scheduleRemotePush = () => {
    if (!isOnline()) {
      // Offline: localStorage è già aggiornato; si risincronizza al rientro
      // (un listener `online` lato app può richiamare flushRemote).
      set({ remoteSync: "offline" });
      return;
    }
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      void get().flushRemote();
    }, REMOTE_PUSH_DEBOUNCE_MS);
  };

  return {
    dashboardLayout: loadDashboardLayout(),
    units: loadUnits(),
    remoteSync: "idle",

    setModuleEnabled: (id, enabled) => {
      const next = { ...get().dashboardLayout, [id]: enabled };
      persistDashboardLayout(next);
      set({ dashboardLayout: next });
      scheduleRemotePush();
    },

    toggleModule: (id) => {
      get().setModuleEnabled(id, !get().dashboardLayout[id]);
    },

    isModuleEnabled: (id) => get().dashboardLayout[id] !== false,

    resetLayout: () => {
      const next = mergeDashboardLayout(null);
      persistDashboardLayout(next);
      set({ dashboardLayout: next });
      scheduleRemotePush();
    },

    setUnits: (patch) => {
      const next = { ...get().units, ...patch };
      persistUnits(next);
      set({ units: next });
      scheduleRemotePush();
    },

    hydrateFromProfile: (profilo) => {
      if (!profilo) return;
      const updates: Partial<SettingsState> = {};
      if (profilo.dashboard_layout_config) {
        const merged = mergeDashboardLayout(profilo.dashboard_layout_config);
        persistDashboardLayout(merged);
        updates.dashboardLayout = merged;
      }
      const remoteUnits = profilo.preferences?.units;
      if (remoteUnits) {
        const units: UnitSystem = {
          area: remoteUnits.area ?? DEFAULT_UNITS.area,
          yield: remoteUnits.yield ?? DEFAULT_UNITS.yield,
          water: remoteUnits.water ?? DEFAULT_UNITS.water,
        };
        persistUnits(units);
        updates.units = units;
      }
      if (Object.keys(updates).length > 0) set(updates);
    },

    flushRemote: async () => {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      const updatePreferences = controlPlane().updateUserPreferences;
      if (!updatePreferences) {
        // Nessun control plane registrato (standalone): localStorage basta.
        set({ remoteSync: "idle" });
        return;
      }
      if (!isOnline()) {
        set({ remoteSync: "offline" });
        return;
      }
      set({ remoteSync: "saving" });
      try {
        await updatePreferences({
          dashboard_layout_config: get().dashboardLayout,
          preferences: { units: get().units, locale: loadLocale() },
        });
        set({ remoteSync: "saved" });
      } catch {
        // Errore non fatale: localStorage resta la fonte locale autorevole.
        set({ remoteSync: "error" });
      }
    },
  };
});
