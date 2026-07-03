import { controlPlane } from "../control-plane";
import { AgroDal } from "../db/dal";
import { useSettingsStore } from "../field/settings-store";
import { SyncRouter } from "../sync/router";
import type { ProfiloUtente } from "../types";
import { OFFLINE_SNAPSHOT, profiloDaClaims } from "./helpers";
import type { SessionSlice, StoreGet, StoreSet } from "./state";

/** Slice sessione: ciclo di vita del workspace, profilo/licenza e coda sync. */
export function createSessionSlice(
  set: StoreSet,
  get: StoreGet,
): SessionSlice {
  return {
    session: null,
    claims: null,
    profilo: null,
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
      let profilo: ProfiloUtente | null = null;
      if (!options.offlineUnlocked) {
        try {
          profilo = (await controlPlane().fetchUserProfile?.()) ?? null;
        } catch {
          profilo = null;
        }
      }
      if (!profilo) profilo = profiloDaClaims(claims);

      // Idrata le preferenze d'interfaccia dal control plane (cross-device): le
      // preferenze remote vincono sul local-first per garantire la coerenza tra
      // dispositivi. È un no-op se il profilo non porta preferenze (offline/pre-v12).
      useSettingsStore.getState().hydrateFromProfile(profilo);

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
        profilo,
        session: options.session ?? null,
        offlineUnlocked: options.offlineUnlocked ?? false,
        dal,
        syncRouter,
        aziendaAttivaId: null,
        appezzamenti: [],
        crops: [],
        trattamenti: [],
        assets: [],
        campionamenti: [],
        raccolte: [],
        configMeteo: null,
        dataTransferLogs: [],
        campiCampagna: [],
        memberships: [],
      });
      syncRouter.start();
      set({ aziende: await dal.listAziende() });
    },

    endSession: () => {
      get().syncRouter?.stop();
      set({
        session: null,
        claims: null,
        profilo: null,
        offlineUnlocked: false,
        dal: null,
        syncRouter: null,
        sync: OFFLINE_SNAPSHOT,
        aziende: [],
        aziendaAttivaId: null,
        appezzamenti: [],
        crops: [],
        trattamenti: [],
        assets: [],
        campionamenti: [],
        raccolte: [],
        configMeteo: null,
        dataTransferLogs: [],
        campiCampagna: [],
        memberships: [],
        activeView: "map",
        openPanels: [],
        appezzamentoSelezionatoId: null,
        ultimaOperazione: null,
        pendingGeometry: null,
        drawIntent: null,
        selectedFeature: null,
        geomEdit: null,
        geomEditRequest: null,
        geometryUndo: [],
        geometryRedo: [],
        quadernoApriAppezzamentoId: null,
        operazioniMappaIds: null,
      });
    },

    refreshProfilo: async () => {
      const { claims, offlineUnlocked } = get();
      let profilo: ProfiloUtente | null = null;
      if (!offlineUnlocked) {
        try {
          profilo = (await controlPlane().fetchUserProfile?.()) ?? null;
        } catch {
          profilo = null;
        }
      }
      if (!profilo && claims) profilo = profiloDaClaims(claims);
      useSettingsStore.getState().hydrateFromProfile(profilo);
      set({ profilo });
      return profilo;
    },

    caricaCodaSync: async () => {
      const dal = get().dal;
      if (!dal) return [];
      return dal.listOutbox();
    },

    eliminaMutazioneCoda: async (mutationId) => {
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteMutation(mutationId);
      // Ricalcola il conteggio e ritenta (la coda potrebbe ora svuotarsi).
      syncRouter?.notifyLocalWrite();
    },

    svuotaCodaSync: async () => {
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.clearOutbox();
      syncRouter?.notifyLocalWrite();
    },
  };
}
