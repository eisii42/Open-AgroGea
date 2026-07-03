import { v4 as uuidv4 } from "uuid";
import { controlPlane } from "../control-plane";
import type { RuoloMembro } from "../types";
import { assertWritable } from "./helpers";
import type { DomainSlice, StoreGet, StoreSet } from "./state";

/** Slice dominio: anagrafiche, Quaderno, raccolte, meteo e campagne. */
export function createDomainSlice(set: StoreSet, get: StoreGet): DomainSlice {
  return {
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
    campagnaAttiva: new Date().getFullYear(),
    campiCampagna: [],
    memberships: [],

    setAziendaAttiva: async (aziendaId) => {
      set({
        aziendaAttivaId: aziendaId,
        appezzamentoSelezionatoId: null,
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
        selectedFeature: null,
        geomEdit: null,
        geomEditRequest: null,
        geometryUndo: [],
        geometryRedo: [],
        pendingGeometry: null,
        drawIntent: null,
        quadernoApriAppezzamentoId: null,
        operazioniMappaIds: null,
      });
      if (aziendaId) await get().refreshDomainData();
    },

    switchTenant: async (aziendaId) => {
      // `setAziendaAttiva` azzera già lo stato derivato e ricarica dal PGlite il
      // sottoinsieme di dati filtrato per la nuova azienda; il remount della
      // dashboard (key in App) ricostruisce mappa e sorgenti, ripulendo la cache
      // dei vettori sulla WebView.
      await get().setAziendaAttiva(aziendaId);
    },

    creaAzienda: async (input) => {
      const { dal, claims, offlineUnlocked } = get();
      if (!dal || !claims) {
        throw new Error("Sessione non valida: impossibile creare l'azienda.");
      }
      const ragioneSociale = input.business_name.trim();
      if (!ragioneSociale) {
        throw new Error("La Ragione Sociale è obbligatoria.");
      }

      const id = uuidv4();
      const partitaIva = input.vat_number?.trim() || null;
      const nationalId =
        input.national_company_id?.trim() || partitaIva || null;

      // INSERT diretto sul data plane remoto (online, se l'edizione ha un
      // adapter): è il percorso che attraversa i vincoli server-side (licenza e
      // limite di piano), la cui eccezione risale al form come messaggio
      // leggibile. Offline — o senza adapter — si crea solo in locale (la coda
      // outbox sincronizzerà al ritorno della rete, dove i vincoli valgono
      // comunque).
      const insertCompany = controlPlane().insertCompany;
      const online =
        !offlineUnlocked &&
        typeof navigator !== "undefined" &&
        navigator.onLine !== false;
      if (online && insertCompany) {
        await insertCompany({
          id,
          tenant_id: claims.tenantId,
          business_name: ragioneSociale,
          vat_number: partitaIva,
          national_company_id: nationalId,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          province: input.province?.trim() || null,
          postal_code: input.postal_code?.trim() || null,
          region: input.region?.trim() || null,
          country: input.country?.trim() || null,
        });
      }

      // Specchio locale (PGlite): rende l'azienda disponibile offline e idrata lo
      // store. La riga porta `tenant_id = claims.tenantId` (uid nel self-service).
      const record = await dal.upsertAzienda({
        id,
        business_name: ragioneSociale,
        national_company_id: nationalId,
        vat_number: partitaIva,
        legal_form: null,
        address: input.address?.trim() || null,
        city: input.city?.trim() || null,
        province: input.province?.trim() || null,
        region: input.region?.trim() || null,
        postal_code: input.postal_code?.trim() || null,
        country: input.country?.trim() || null,
        email: null,
        pec: null,
        sdi_code: null,
        centroid: null,
        certifications: [],
        farm_file_id: null,
        paying_agency: null,
        contact_name: null,
        contact_role: null,
      });
      set((s) => ({
        aziende: [...s.aziende.filter((a) => a.id !== record.id), record],
      }));
      get().syncRouter?.notifyLocalWrite();

      // Multiutente: registra il posto OWNER dell'abbonato principale per la nuova
      // azienda (via DAL → outbox). switchTenant → refreshDomainData lo idrata.
      const principalEmail =
        get().session?.user?.email ?? get().profilo?.email ?? null;
      if (principalEmail) {
        await dal.upsertMembership({
          company_id: record.id,
          email: principalEmail,
          role: "OWNER",
          status: "active",
          invited_at: null,
          joined_at: new Date().toISOString(),
        });
        get().syncRouter?.notifyLocalWrite();
      }

      await get().switchTenant(record.id);
      return record;
    },

    salvaMembership: async (input) => {
      const { dal, syncRouter } = get();
      if (!dal) return null;
      const record = await dal.upsertMembership(input);
      set((s) => ({
        memberships: [
          ...s.memberships.filter((m) => m.id !== record.id),
          record,
        ],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    eliminaMembership: async (id) => {
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteMembership(id);
      set((s) => ({ memberships: s.memberships.filter((m) => m.id !== id) }));
      syncRouter?.notifyLocalWrite();
    },

    ensureOwnerMembership: async (companyId, email) => {
      const { dal } = get();
      if (!dal || !companyId || !email) return;
      const target = email.trim().toLowerCase();
      const exists = get().memberships.some(
        (m) =>
          m.company_id === companyId &&
          m.deleted_at == null &&
          m.email.trim().toLowerCase() === target,
      );
      if (exists) return;
      const role: RuoloMembro = "OWNER";
      const record = await dal.upsertMembership({
        company_id: companyId,
        email,
        role,
        status: "active",
        invited_at: null,
        joined_at: new Date().toISOString(),
      });
      set((s) => ({
        memberships: [
          ...s.memberships.filter((m) => m.id !== record.id),
          record,
        ],
      }));
      get().syncRouter?.notifyLocalWrite();
    },

    refreshDomainData: async () => {
      const { dal, aziendaAttivaId } = get();
      if (!dal) return;
      const aziende = await dal.listAziende();
      if (!aziendaAttivaId) {
        set({ aziende });
        return;
      }
      const [
        appezzamenti,
        crops,
        trattamenti,
        assets,
        campionamenti,
        raccolte,
        configMeteo,
        dataTransferLogs,
        campiCampagna,
        memberships,
      ] = await Promise.all([
        dal.listAppezzamenti(aziendaAttivaId),
        dal.listCrops(),
        dal.listTrattamenti(aziendaAttivaId),
        dal.listAssets(aziendaAttivaId),
        dal.listCampionamenti(aziendaAttivaId),
        dal.listRaccolte(aziendaAttivaId),
        dal.getConfigMeteo(aziendaAttivaId),
        dal.listDataTransferLogs(),
        dal.listCampiCampagna({ anno: get().campagnaAttiva }),
        dal.listMemberships(),
      ]);
      set({
        aziende,
        appezzamenti,
        crops,
        trattamenti,
        assets,
        campionamenti,
        raccolte,
        configMeteo,
        dataTransferLogs,
        campiCampagna,
        memberships,
      });
    },

    aggiornaAzienda: async (patch) => {
      assertWritable(get);
      const { dal, aziendaAttivaId, syncRouter } = get();
      if (!dal || !aziendaAttivaId) {
        throw new Error("Nessuna azienda attiva: impossibile salvare l'anagrafica.");
      }
      const existing = get().aziende.find((a) => a.id === aziendaAttivaId);
      if (!existing) return;
      // Si riscrive la riga intera (esistente + patch): l'area di sync è LWW su
      // updated_at, quindi un upsert completo è il percorso canonico.
      const record = await dal.upsertAzienda({ ...existing, ...patch });
      set((s) => ({
        aziende: s.aziende.map((a) => (a.id === record.id ? record : a)),
      }));
      syncRouter?.notifyLocalWrite();
    },

    salvaConfigMeteo: async (patch) => {
      assertWritable(get);
      const { dal, aziendaAttivaId } = get();
      if (!dal || !aziendaAttivaId) {
        throw new Error("Nessuna azienda attiva: impossibile salvare la configurazione meteo.");
      }
      const config = await dal.upsertConfigMeteo({
        company_id: aziendaAttivaId,
        ...patch,
      });
      set({ configMeteo: config });
    },

    registraTrattamento: async (input) => {
      assertWritable(get);
      const { dal, aziendaAttivaId, syncRouter } = get();
      if (!dal || !aziendaAttivaId) {
        throw new Error("Nessuna azienda attiva: impossibile registrare.");
      }
      const record = await dal.insertTrattamento({
        ...input,
        company_id: aziendaAttivaId,
      });
      set((s) => ({ trattamenti: [record, ...s.trattamenti] }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    eliminaTrattamento: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteTrattamento(id);
      set((s) => ({ trattamenti: s.trattamenti.filter((t) => t.id !== id) }));
      syncRouter?.notifyLocalWrite();
      // L'ultima operazione mostrata nella scheda dettaglio può essere quella
      // appena eliminata: la si ricalcola per l'appezzamento selezionato.
      const apzId = get().appezzamentoSelezionatoId;
      if (apzId) {
        const ultima = await dal.ultimaOperazione(apzId);
        if (get().appezzamentoSelezionatoId === apzId) {
          set({ ultimaOperazione: ultima });
        }
      }
    },

    aggiornaTrattamento: async (id, patch) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return null;
      const existing = get().trattamenti.find((t) => t.id === id);
      if (!existing) return null;
      // insertTrattamento esegue INSERT ... ON CONFLICT (id) DO UPDATE: passando
      // l'id esistente la riga viene aggiornata (created_at è preservato dal DAL).
      const record = await dal.insertTrattamento({ ...existing, ...patch, id });
      set((s) => ({
        trattamenti: s.trattamenti.map((t) => (t.id === record.id ? record : t)),
      }));
      syncRouter?.notifyLocalWrite();
      // L'ultima operazione mostrata nella scheda dettaglio può essere quella
      // appena modificata: la si ricalcola per l'appezzamento selezionato.
      const apzId = get().appezzamentoSelezionatoId;
      if (apzId && (record.plot_id === apzId || existing.plot_id === apzId)) {
        const ultima = await dal.ultimaOperazione(apzId);
        if (get().appezzamentoSelezionatoId === apzId) {
          set({ ultimaOperazione: ultima });
        }
      }
      return record;
    },

    salvaNdviMedio: async (appezzamentoId, ndviMedio) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.aggiornaNdviMedio(appezzamentoId, ndviMedio);
      set((s) => ({
        appezzamenti: s.appezzamenti.map((a) =>
          a.id === appezzamentoId ? { ...a, last_ndvi_mean: ndviMedio } : a,
        ),
      }));
      syncRouter?.notifyLocalWrite();
    },

    salvaRaccolta: async (input) => {
      assertWritable(get);
      const { dal, aziendaAttivaId, syncRouter } = get();
      if (!dal || !aziendaAttivaId) return null;
      const record = await dal.upsertRaccolta({
        id: input.id ?? uuidv4(),
        company_id: aziendaAttivaId,
        plot_id: input.plot_id ?? null,
        plot_campaign_id: input.plot_campaign_id ?? null,
        cultivar: input.cultivar ?? null,
        destination_logistics: input.destination_logistics ?? null,
        quantity_kg: input.quantity_kg ?? null,
        harvested_at: input.harvested_at,
        geometry: input.geometry ?? null,
        notes: input.notes ?? null,
        metadata: input.metadata ?? {},
      });
      set((s) => ({
        raccolte: [record, ...s.raccolte.filter((r) => r.id !== record.id)],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    eliminaRaccolta: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteRaccolta(id);
      set((s) => ({ raccolte: s.raccolte.filter((r) => r.id !== id) }));
      syncRouter?.notifyLocalWrite();
    },

    registraTrasferimento: async (input) => {
      const { dal } = get();
      if (!dal) return null;
      const record = await dal.logDataTransfer(input);
      set((s) => ({
        dataTransferLogs: [record, ...s.dataTransferLogs].slice(0, 50),
      }));
      return record;
    },

    setCampagnaAttiva: async (anno) => {
      set({ campagnaAttiva: anno });
      const dal = get().dal;
      if (!dal || !get().aziendaAttivaId) return;
      set({ campiCampagna: await dal.listCampiCampagna({ anno }) });
    },

    salvaCampoCampagna: async (input) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal || !get().aziendaAttivaId) return null;
      const record = await dal.upsertCampoCampagna(input);
      // Idrata solo se appartiene alla campagna attiva (evita righe fuori anno).
      if (record.campaign_year === get().campagnaAttiva) {
        set((s) => ({
          campiCampagna: [
            record,
            ...s.campiCampagna.filter((c) => c.id !== record.id),
          ],
        }));
      }
      syncRouter?.notifyLocalWrite();
      return record;
    },

    salvaCrop: async (input) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return null;
      const record = await dal.upsertCrop(input);
      set((s) => ({
        crops: [...s.crops.filter((c) => c.id !== record.id), record],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    salvaCampionamento: async (input) => {
      assertWritable(get);
      const { dal, aziendaAttivaId, syncRouter } = get();
      if (!dal || !aziendaAttivaId) return null;
      const record = await dal.upsertCampionamento({
        id: input.id ?? uuidv4(),
        company_id: aziendaAttivaId,
        plot_id: input.plot_id ?? null,
        sampled_at: input.sampled_at,
        sampling_position: input.sampling_position,
        depth_cm: input.depth_cm ?? null,
        nitrogen: input.nitrogen ?? null,
        phosphorus: input.phosphorus ?? null,
        potassium: input.potassium ?? null,
        organic_matter: input.organic_matter ?? null,
        ph: input.ph ?? null,
        texture: input.texture ?? null,
        metadata: input.metadata ?? {},
      });
      set((s) => ({
        campionamenti: [
          ...s.campionamenti.filter((c) => c.id !== record.id),
          record,
        ],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },
  };
}
