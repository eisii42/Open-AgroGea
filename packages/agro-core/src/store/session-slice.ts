import { controlPlane } from "../control-plane";
import { AgroDal } from "../db/dal";
import { useSettingsStore } from "../field/settings-store";
import { SyncRouter } from "../sync/router";
import type { UserProfile } from "../types";
import { OFFLINE_SNAPSHOT, profiloDaClaims } from "./helpers";
import type { SessionSlice, StoreGet, StoreSet } from "./state";

/** Slice sessione: ciclo di vita del workspace, profile/licenza e coda sync. */
export function createSessionSlice(
  set: StoreSet,
  get: StoreGet,
): SessionSlice {
  return {
    session: null,
    claims: null,
    profile: null,
    offlineUnlocked: false,
    dal: null,
    syncRouter: null,
    sync: OFFLINE_SNAPSHOT,

    startTenantSession: async (claims, options = {}) => {
      // Chiude un'eventuale sessione precedente (cambio workspace).
      get().syncRouter?.stop();

      // Gate di licenza: online la fonte autorevole è il control plane
      // dell'edizione (se registrato); offline, o senza adapter, si ricade
      // sulle claims correnti.
      let profile: UserProfile | null = null;
      if (!options.offlineUnlocked) {
        try {
          profile = (await controlPlane().fetchUserProfile?.()) ?? null;
        } catch {
          profile = null;
        }
      }
      if (!profile) profile = profiloDaClaims(claims);

      // Idrata le preferenze d'interfaccia dal control plane (cross-device): le
      // preferenze remote vincono sul local-first per garantire la coerenza tra
      // dispositivi. È un no-op se il profile non porta preferenze (offline/pre-v12).
      useSettingsStore.getState().hydrateFromProfile(profile);

      const dal = await AgroDal.open(claims.tenantId);
      const syncRouter = new SyncRouter({
        dal,
        configStorage: claims.configStorage,
        onSnapshot: (sync) => {
          const prev = get().sync;
          set({ sync });
          // Dopo ogni pull dal data plane remoto la UI rilegge il dominio dal
          // DAL: è così che le anagrafiche remote compaiono al primo avvio.
          if (sync.lastPulledAt && sync.lastPulledAt !== prev.lastPulledAt) {
            void get().refreshDomainData();
          }
        },
      });
      set({
        claims,
        profile,
        session: options.session ?? null,
        offlineUnlocked: options.offlineUnlocked ?? false,
        dal,
        syncRouter,
        activeCompanyId: null,
        plots: [],
        crops: [],
        treatments: [],
        assets: [],
        soilSamples: [],
        harvests: [],
        weatherConfig: null,
        dataTransferLogs: [],
        campaignFields: [],
        memberships: [],
      });
      syncRouter.start();
      set({ companies: await dal.listAziende() });
    },

    endSession: () => {
      get().syncRouter?.stop();
      set({
        session: null,
        claims: null,
        profile: null,
        offlineUnlocked: false,
        dal: null,
        syncRouter: null,
        sync: OFFLINE_SNAPSHOT,
        companies: [],
        activeCompanyId: null,
        plots: [],
        crops: [],
        treatments: [],
        assets: [],
        soilSamples: [],
        harvests: [],
        weatherConfig: null,
        dataTransferLogs: [],
        campaignFields: [],
        memberships: [],
        activeView: "map",
        openPanels: [],
        selectedPlotId: null,
        lastOperation: null,
        pendingGeometry: null,
        drawIntent: null,
        selectedFeature: null,
        geomEdit: null,
        geomEditRequest: null,
        geometryUndo: [],
        geometryRedo: [],
        logbookOpenPlotId: null,
        mapOperationIds: null,
      });
    },

    refreshProfile: async () => {
      const { claims, offlineUnlocked } = get();
      let profile: UserProfile | null = null;
      if (!offlineUnlocked) {
        try {
          profile = (await controlPlane().fetchUserProfile?.()) ?? null;
        } catch {
          profile = null;
        }
      }
      if (!profile && claims) profile = profiloDaClaims(claims);
      useSettingsStore.getState().hydrateFromProfile(profile);
      set({ profile });
      return profile;
    },

    loadSyncQueue: async () => {
      const dal = get().dal;
      if (!dal) return [];
      return dal.listOutbox();
    },

    deleteQueuedMutation: async (mutationId) => {
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteMutation(mutationId);
      // Ricalcola il conteggio e ritenta (la coda potrebbe ora svuotarsi).
      syncRouter?.notifyLocalWrite();
    },

    clearSyncQueue: async () => {
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.clearOutbox();
      syncRouter?.notifyLocalWrite();
    },
  };
}
