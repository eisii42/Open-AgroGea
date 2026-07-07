import { v4 as uuidv4 } from "uuid";
import { controlPlane } from "../control-plane";
import type { MemberRole } from "../types";
import { assertWritable } from "./helpers";
import type { DomainSlice, StoreGet, StoreSet } from "./state";

/** Slice dominio: anagrafiche, Quaderno, harvests, meteo e campagne. */
export function createDomainSlice(set: StoreSet, get: StoreGet): DomainSlice {
  return {
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
    activeCampaign: new Date().getFullYear(),
    campaignFields: [],
    memberships: [],
    products: [],
    lots: [],

    setActiveCompany: async (companyId) => {
      set({
        activeCompanyId: companyId,
        selectedPlotId: null,
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
        products: [],
        lots: [],
        activeView: "map",
        selectedFeature: null,
        geomEdit: null,
        geomEditRequest: null,
        geometryUndo: [],
        geometryRedo: [],
        pendingGeometry: null,
        drawIntent: null,
        logbookOpenPlotId: null,
        cropOpenPlotId: null,
        mapOperationIds: null,
      });
      if (companyId) await get().refreshDomainData();
    },

    switchTenant: async (companyId) => {
      // `setActiveCompany` azzera già lo stato derivato e ricarica dal PGlite il
      // sottoinsieme di dati filtrato per la nuova azienda; il remount della
      // dashboard (key in App) ricostruisce mappa e sorgenti, ripulendo la cache
      // dei vettori sulla WebView.
      await get().setActiveCompany(companyId);
    },

    createCompany: async (input) => {
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
        companies: [...s.companies.filter((a) => a.id !== record.id), record],
      }));
      get().syncRouter?.notifyLocalWrite();

      // Multiutente: registra il posto OWNER dell'abbonato principale per la nuova
      // azienda (via DAL → outbox). switchTenant → refreshDomainData lo idrata.
      const principalEmail =
        get().session?.user?.email ?? get().profile?.email ?? null;
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

    saveMembership: async (input) => {
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

    deleteMembership: async (id) => {
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
      const role: MemberRole = "OWNER";
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
      const { dal, activeCompanyId } = get();
      if (!dal) return;
      const companies = await dal.listAziende();
      if (!activeCompanyId) {
        set({ companies });
        return;
      }
      const [
        plots,
        crops,
        treatments,
        assets,
        soilSamples,
        harvests,
        weatherConfig,
        dataTransferLogs,
        campaignFields,
        memberships,
        products,
        lots,
      ] = await Promise.all([
        dal.listAppezzamenti(activeCompanyId),
        dal.listCrops(),
        dal.listTrattamenti(activeCompanyId),
        dal.listAssets(activeCompanyId),
        dal.listCampionamenti(activeCompanyId),
        dal.listRaccolte(activeCompanyId),
        dal.getConfigMeteo(activeCompanyId),
        dal.listDataTransferLogs(),
        dal.listCampiCampagna({ anno: get().activeCampaign }),
        dal.listMemberships(),
        dal.listProdotti(activeCompanyId),
        dal.listLotti(activeCompanyId),
      ]);
      set({
        companies,
        plots,
        crops,
        treatments,
        assets,
        soilSamples,
        harvests,
        weatherConfig,
        dataTransferLogs,
        campaignFields,
        memberships,
        products,
        lots,
      });
    },

    updateCompany: async (patch) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) {
        throw new Error("Nessuna azienda attiva: impossibile salvare l'anagrafica.");
      }
      const existing = get().companies.find((a) => a.id === activeCompanyId);
      if (!existing) return;
      // Si riscrive la riga intera (esistente + patch): l'area di sync è LWW su
      // updated_at, quindi un upsert completo è il percorso canonico.
      const record = await dal.upsertAzienda({ ...existing, ...patch });
      set((s) => ({
        companies: s.companies.map((a) => (a.id === record.id ? record : a)),
      }));
      syncRouter?.notifyLocalWrite();
    },

    saveWeatherConfig: async (patch) => {
      assertWritable(get);
      const { dal, activeCompanyId } = get();
      if (!dal || !activeCompanyId) {
        throw new Error("Nessuna azienda attiva: impossibile salvare la configurazione meteo.");
      }
      const config = await dal.upsertConfigMeteo({
        company_id: activeCompanyId,
        ...patch,
      });
      set({ weatherConfig: config });
    },

    recordTreatment: async (input, scarichi) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) {
        throw new Error("Nessuna azienda attiva: impossibile registrare.");
      }
      // Con scarichi: attività + scarico lots + costo CUMP in un'unica
      // transazione (l'eccezione WarehouseError risale al form senza scritture
      // parziali). Senza scarichi: percorso classico (fallback testo libero).
      const { trattamento: record } = await dal.insertTrattamentoConScarichi(
        { ...input, company_id: activeCompanyId },
        scarichi ?? [],
      );
      set((s) => ({ treatments: [record, ...s.treatments] }));
      if (scarichi && scarichi.length > 0) {
        set({ lots: await dal.listLotti(activeCompanyId) });
      }
      syncRouter?.notifyLocalWrite();
      return record;
    },

    deleteTreatment: async (id) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal) return;
      await dal.deleteTrattamento(id);
      set((s) => ({ treatments: s.treatments.filter((t) => t.id !== id) }));
      // Lo storno magazzino del DAL può aver reintegrato giacenze: si riidratano.
      if (activeCompanyId) {
        set({ lots: await dal.listLotti(activeCompanyId) });
      }
      syncRouter?.notifyLocalWrite();
      // L'ultima operazione mostrata nella scheda dettaglio può essere quella
      // appena eliminata: la si ricalcola per l'appezzamento selezionato.
      const apzId = get().selectedPlotId;
      if (apzId) {
        const ultima = await dal.lastOperation(apzId);
        if (get().selectedPlotId === apzId) {
          set({ lastOperation: ultima });
        }
      }
    },

    updateTreatment: async (id, patch) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return null;
      const existing = get().treatments.find((t) => t.id === id);
      if (!existing) return null;
      // insertTrattamento esegue INSERT ... ON CONFLICT (id) DO UPDATE: passando
      // l'id esistente la riga viene aggiornata (created_at è preservato dal DAL).
      const record = await dal.insertTrattamento({ ...existing, ...patch, id });
      set((s) => ({
        treatments: s.treatments.map((t) => (t.id === record.id ? record : t)),
      }));
      syncRouter?.notifyLocalWrite();
      // L'ultima operazione mostrata nella scheda dettaglio può essere quella
      // appena modificata: la si ricalcola per l'appezzamento selezionato.
      const apzId = get().selectedPlotId;
      if (apzId && (record.plot_id === apzId || existing.plot_id === apzId)) {
        const ultima = await dal.lastOperation(apzId);
        if (get().selectedPlotId === apzId) {
          set({ lastOperation: ultima });
        }
      }
      return record;
    },

    saveMeanNdvi: async (plotId, meanNdvi) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.aggiornaNdviMedio(plotId, meanNdvi);
      set((s) => ({
        plots: s.plots.map((a) =>
          a.id === plotId ? { ...a, last_ndvi_mean: meanNdvi } : a,
        ),
      }));
      syncRouter?.notifyLocalWrite();
    },

    saveHarvest: async (input) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) return null;
      const record = await dal.upsertRaccolta({
        id: input.id ?? uuidv4(),
        company_id: activeCompanyId,
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
        harvests: [record, ...s.harvests.filter((r) => r.id !== record.id)],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    deleteHarvest: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteRaccolta(id);
      set((s) => ({ harvests: s.harvests.filter((r) => r.id !== id) }));
      syncRouter?.notifyLocalWrite();
    },

    recordTransfer: async (input) => {
      const { dal } = get();
      if (!dal) return null;
      const record = await dal.logDataTransfer(input);
      set((s) => ({
        dataTransferLogs: [record, ...s.dataTransferLogs].slice(0, 50),
      }));
      return record;
    },

    setActiveCampaign: async (anno) => {
      set({ activeCampaign: anno });
      const dal = get().dal;
      if (!dal || !get().activeCompanyId) return;
      set({ campaignFields: await dal.listCampiCampagna({ anno }) });
    },

    savePlotCampaign: async (input) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal || !get().activeCompanyId) return null;
      const record = await dal.upsertCampoCampagna(input);
      // Idrata solo se appartiene alla campagna attiva (evita righe fuori anno).
      if (record.campaign_year === get().activeCampaign) {
        set((s) => ({
          campaignFields: [
            record,
            ...s.campaignFields.filter((c) => c.id !== record.id),
          ],
        }));
      }
      syncRouter?.notifyLocalWrite();
      return record;
    },

    closeCampaign: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      const record = await dal.closeCampaign(id);
      if (!record) return;
      // La riga resta nello store (i registri storici la referenziano) ma con
      // closed_at valorizzato: mappa e DSS la ignorano da subito.
      set((s) => ({
        campaignFields: s.campaignFields.map((c) =>
          c.id === record.id ? record : c,
        ),
      }));
      syncRouter?.notifyLocalWrite();
    },

    saveCrop: async (input) => {
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

    saveSoilSample: async (input) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) return null;
      const record = await dal.upsertCampionamento({
        id: input.id ?? uuidv4(),
        company_id: activeCompanyId,
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
        soilSamples: [
          ...s.soilSamples.filter((c) => c.id !== record.id),
          record,
        ],
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    saveProduct: async (input) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) return null;
      const record = await dal.upsertProdotto({
        ...input,
        company_id: activeCompanyId,
      });
      set((s) => ({
        products: [
          ...s.products.filter((p) => p.id !== record.id),
          record,
        ].sort((a, b) =>
          a.category === b.category
            ? a.name.localeCompare(b.name)
            : a.category.localeCompare(b.category),
        ),
      }));
      syncRouter?.notifyLocalWrite();
      return record;
    },

    deleteProduct: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteProdotto(id);
      set((s) => ({ products: s.products.filter((p) => p.id !== id) }));
      syncRouter?.notifyLocalWrite();
    },

    receiveLot: async (input) => {
      assertWritable(get);
      const { dal, activeCompanyId, syncRouter } = get();
      if (!dal || !activeCompanyId) return null;
      const record = await dal.receiveLot(input);
      // Il carico aggiorna anche il CUMP del prodotto: si riidratano entrambi.
      const [products, lots] = await Promise.all([
        dal.listProdotti(activeCompanyId),
        dal.listLotti(activeCompanyId),
      ]);
      set({ products, lots });
      syncRouter?.notifyLocalWrite();
      return record;
    },

    deleteLot: async (id) => {
      assertWritable(get);
      const { dal, syncRouter } = get();
      if (!dal) return;
      await dal.deleteLotto(id);
      set((s) => ({ lots: s.lots.filter((l) => l.id !== id) }));
      syncRouter?.notifyLocalWrite();
    },
  };
}
