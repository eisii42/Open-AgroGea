import type { Feature, Geometry } from "geojson";
import type { StoreApi } from "zustand";
import type { AgroDal } from "../db/dal";
import type { AgroTheme } from "../field/theme";
import type { DrawnGeometry } from "../geo/area";
import type { SyncRouter } from "../sync/router";
import type {
  Plot,
  InfrastructureAsset,
  AuthSession,
  Company,
  SoilSample,
  PlotCampaign,
  CompanyWeatherConfig,
  Crop,
  DataTransferLog,
  FieldPanel,
  ProductLot,
  OutboxMutation,
  PanelMode,
  Product,
  UserProfile,
  Harvest,
  TreatmentLog,
  IssueRequest,
  SyncSnapshot,
  TenantClaims,
  TenantMembership,
  LastOperation,
} from "../types";

/**
 * Tipi dello store Zustand agronomico. Lo stato è partizionato in QUATTRO
 * slice per dominio (sessione, dominio dati, UI di field, disegno/geometrie),
 * ricomposte in {@link AgroState}: ogni slice vive nel proprio module
 * (`session-slice.ts`, `domain-slice.ts`, `ui-slice.ts`, `geometry-slice.ts`)
 * ma condivide `set`/`get` sull'intero stato, quindi le azioni possono
 * attraversare i confini di slice quando serve (es. `endSession` azzera tutto).
 */

/**
 * Geometria appena disegnata col GeoEditor, in attesa di compilazione nella
 * scheda dati (data-entry). Conserva la chiave dello sketch per poterlo
 * rimuovere se l'utente annulla.
 */
export interface PendingGeometry {
  feature: Feature;
  kind: DrawnGeometry;
  /** Chiave dello sketch nel layer geo-editor, per la rimozione su annulla. */
  sketchKey: string;
  /** Area in ettari pre-calcolata (solo poligoni). */
  areaHa: number | null;
}

/** Layer semantici selezionabili sulla mappa. */
export type SelectableKind = "appezzamento" | "infrastruttura" | "poi";

/** Riferimento all'elemento selezionato sulla mappa (apre la scheda dettaglio). */
export interface SelectedFeatureRef {
  kind: SelectableKind;
  id: string;
}

/**
 * Sessione di editing spaziale di un elemento esistente. È un semplice
 * MARCATORE (quale elemento) — l'editing dei vertici è delegato al motore NATIVO
 * di GeoLibre (`startLayerGeometryEdit`/`endLayerGeometryEdit` in
 * `@geolibre/plugins`), che modifica le feature in-place e le riscrive in modo
 * atomico al salvataggio. Niente più geometria/area "live" intermedia nello
 * store (era la fonte di crash, perdita dati e tipo/Z drift).
 */
export interface GeomEditSession {
  kind: SelectableKind;
  id: string;
}

/**
 * Snapshot per l'undo/redo DAL-aware di una modifica geometrica: il modello
 * agro ha la verità in PGlite (i layer sono solo proiezione), quindi l'undo
 * nativo di GeoLibre (zundo sui layer) desincronizzerebbe layer↔DB. Qui si
 * registra la geometria PRIMA e DOPO ogni salvataggio e l'undo/redo riapplica
 * `before`/`after` al DAL (il layer si riproietta da sé).
 */
export interface GeometrySnapshot {
  kind: SelectableKind;
  id: string;
  before: Geometry;
  after: Geometry;
}

/** Azione richiesta sulla sessione di editing nativo, consumata da useFieldPlugins. */
export type GeomEditRequest = "save" | "cancel" | null;

/**
 * Vista di primo livello dell'app di field. `map` è la Dashboard geocentrica
 * (mappa + moduli); `command-center` è il Data Command Center analitico, dove la
 * mappa MaplLibre viene smontata per liberare risorse. Il contesto aziendale
 * (company attiva, DAL, dati di dominio) vive nello store e SOPRAVVIVE allo
 * switch: cambiare vista non perde il workspace.
 */
export type AppView = "map" | "command-center";

export interface AssetDrawAttrs {
  id?: string;
  asset_type?: string;
  category?: "fixed" | "mobile";
  name?: string | null;
  attributes?: Record<string, unknown>;
  length_m?: number | null;
}

export interface PlotDrawAttrs {
  id?: string;
  /** Nome libero dell'appezzamento (LPIS user plot name). */
  name?: string;
  cadastral_sheet?: string | null;
  cadastral_parcel?: string | null;
  irrigation_type?: string | null;
  planting_year?: number | null;
}

/**
 * Dati raccolti dal form "Crea Nuova Company" dell'onboarding. L'indirizzo
 * completo (in particolare `country`) è metadato critico per la Country
 * Resolution GIS: governa cataloghi e regole burocratiche del workspace.
 */
export interface NewCompanyInput {
  business_name: string;
  /** P.IVA aziendale. */
  vat_number?: string | null;
  /** Identificativo fiscale nazionale (ex CUAA / codice fiscale). */
  national_company_id?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  region?: string | null;
  /** Paese ISO 3166-1 alpha-2 (sorgente primaria del Country Resolution). */
  country?: string | null;
}

// ---------------------------------------------------------------------------
// Slice: sessione / control plane / sync
// ---------------------------------------------------------------------------

export interface SessionSlice {
  session: AuthSession | null;
  claims: TenantClaims | null;
  /**
   * Profilo/licenza dell'utente (`profili_utenti`), fonte del gate di
   * onboarding. `null` finché non risolto; il consumo lato UI decide il
   * blocco di "attesa approvazione" quando `stato_licenza !== 'active'`.
   */
  profile: UserProfile | null;
  /** true quando lo sblocco è avvenuto offline (PIN) e non c'è JWT fresco. */
  offlineUnlocked: boolean;

  // -- data plane locale --
  dal: AgroDal | null;
  syncRouter: SyncRouter | null;
  sync: SyncSnapshot;

  startTenantSession: (
    claims: TenantClaims,
    options?: { session?: AuthSession | null; offlineUnlocked?: boolean },
  ) => Promise<void>;
  endSession: () => void;
  /** Ricarica il profile/licenza dal control plane (pulsante "Ricontrolla"). */
  refreshProfile: () => Promise<UserProfile | null>;

  // -- coda di sincronizzazione (outbox) --
  /** Carica la coda di mutazioni non ancora sincronizzate (per il pannello Sync). */
  loadSyncQueue: () => Promise<OutboxMutation[]>;
  /** Rimuove una voce dalla coda di sync (non sincronizzerà più). */
  deleteQueuedMutation: (mutationId: string) => Promise<void>;
  /** Svuota l'intera coda di mutazioni non sincronizzate. */
  clearSyncQueue: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Slice: dominio (idratato dal DAL, mai costruito dai componenti)
// ---------------------------------------------------------------------------

export interface DomainSlice {
  companies: Company[];
  activeCompanyId: string | null;
  plots: Plot[];
  /** Specie/varietà coltivate del workspace (catalog `crops`). */
  crops: Crop[];
  treatments: TreatmentLog[];
  /** Infrastrutture (CAD-GIS): layer "infrastrutture". */
  assets: InfrastructureAsset[];
  /** Campionamenti soil georeferenziati: layer "poi". */
  soilSamples: SoilSample[];
  /** Eventi di harvest dell'azienda attiva (Modulo Harvest): layer "harvests". */
  harvests: Harvest[];
  /** Configurazione meteo dell'azienda attiva (Modulo Meteo), o null. */
  weatherConfig: CompanyWeatherConfig | null;
  /** Giornale dei trasferimenti dati (import/export), più recenti prima. */
  dataTransferLogs: DataTransferLog[];
  /** Anno della Campagna Agraria attiva (filtra i campi burocratici/registri). */
  activeCampaign: number;
  /** Stato di campagna dei campi (SIAN/AGEA) dell'anno active. */
  campaignFields: PlotCampaign[];
  /** Posti collaboratore del workspace (multiutente), idratati dal DAL. */
  memberships: TenantMembership[];
  /** Anagrafica products di warehouse dell'azienda attiva (Modulo Magazzino). */
  products: Product[];
  /** Lotti di warehouse (tutti i products dell'azienda attiva). */
  lots: ProductLot[];

  setActiveCompany: (companyId: string | null) => Promise<void>;
  /**
   * Cambio di workspace (company) richiesto dalla pagina di selezione: pulisce
   * lo stato derivato, isola le tabelle locali PGlite sul nuovo `tenant_id`
   * (sottoinsieme filtrato per company) e update lo stato React. La cache di
   * rendering dei vettori della mappa sulla WebView viene azzerata dal remount
   * della dashboard (`key={activeCompanyId}` in App), che ricostruisce mappa e
   * sorgenti da zero.
   */
  switchTenant: (companyId: string) => Promise<void>;
  /**
   * Crea una nuova company (workspace) durante l'onboarding: INSERT remoto
   * (online) — soggetto ai vincoli server-side su licenza e limite di piano —
   * poi specchio su PGlite locale e attivazione. Propaga l'eccezione del
   * database (messaggio del vincolo) al chiamante per il banner di errore nel
   * form.
   */
  createCompany: (input: NewCompanyInput) => Promise<Company>;
  /**
   * Crea/update un posto collaboratore (`tenant_memberships`) via DAL → outbox
   * e idrata lo store. La quota per ruolo/piano è verificata a monte dal
   * chiamante (field-suite `MembershipGuard`): qui si persiste soltanto.
   */
  saveMembership: (
    input: Omit<
      TenantMembership,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ) => Promise<TenantMembership | null>;
  /** Soft-delete (tombstone sincronizzato) di un posto collaboratore. */
  deleteMembership: (id: string) => Promise<void>;
  /**
   * Garantisce il posto OWNER dell'abbonato principale per un'azienda (così i
   * contatori partono da "Owners 1/…" e gli inviti sono validati sui posti
   * residui). Idempotente: no-op se l'email è già membro dell'azienda.
   */
  ensureOwnerMembership: (companyId: string, email: string) => Promise<void>;
  refreshDomainData: () => Promise<void>;
  /**
   * UPDATE alfanumerico dell'anagrafica dell'azienda attiva (preserva i campi
   * non passati). Scrive via DAL → outbox come ogni altra mutazione di dominio.
   */
  updateCompany: (patch: Partial<Company>) => Promise<void>;
  /** Salva la configurazione meteo dell'azienda attiva e idrata lo store. */
  saveWeatherConfig: (
    patch: Partial<
      Omit<
        CompanyWeatherConfig,
        "company_id" | "tenant_id" | "created_at" | "updated_at"
      >
    >,
  ) => Promise<void>;
  /**
   * Registra un'operazione del Quaderno; con `scarichi` valorizzato aggancia i
   * lots di warehouse nella STESSA transazione (issue atomico §5.2: stock
   * insufficiente o lot scaduto ⇒ l'intera registrazione fallisce e
   * l'eccezione `WarehouseError` risale al form).
   */
  recordTreatment: (
    input: Omit<
      TreatmentLog,
      "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
    >,
    issues?: IssueRequest[],
  ) => Promise<TreatmentLog>;
  /**
   * Cancellazione protetta di una singola operation del Quaderno (soft-delete
   * via DAL → outbox) e rimozione reattiva dalla lista. La confirm invasiva
   * (banner + toggle) è responsabilità della UI: qui si esegue solo il DELETE.
   */
  deleteTreatment: (id: string) => Promise<void>;
  /**
   * UPDATE alfanumerico di un'operazione del Quaderno esistente (preserva i
   * campi non passati). Upsert via DAL → outbox come ogni mutazione di dominio;
   * usato dall'editing inline del Command Center (calendario / Raw Data Inspector).
   */
  updateTreatment: (
    id: string,
    patch: Partial<TreatmentLog>,
  ) => Promise<TreatmentLog | null>;
  /** Salva la cache NDVI di un plot (pipeline STAC) e idrata lo store. */
  saveMeanNdvi: (plotId: string, meanNdvi: number) => Promise<void>;
  /** Registra/update un evento di harvest (Modulo Harvest) e idrata lo store. */
  saveHarvest: (
    input: Partial<
      Omit<
        Harvest,
        "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
      >
    > & { harvested_at: string },
  ) => Promise<Harvest | null>;
  /**
   * Cancellazione protetta di un evento di harvest (soft-delete via DAL →
   * outbox) e rimozione reattiva dalla lista. La confirm invasiva è
   * responsabilità della UI, come per {@link deleteTreatment}.
   */
  deleteHarvest: (id: string) => Promise<void>;
  /**
   * Registra un trasferimento dati (import/export) nel giornale locale e
   * update reattivamente il feed dei tag. Ritorna la voce creata (per un tag
   * immediato) o null se non c'è un DAL active.
   */
  recordTransfer: (
    input: Pick<
      DataTransferLog,
      "operation_type" | "file_format" | "file_name"
    >,
  ) => Promise<DataTransferLog | null>;
  /** Imposta l'anno della Campagna Agraria attiva e reload i campi di campagna. */
  setActiveCampaign: (anno: number) => Promise<void>;
  /**
   * Crea/update lo stato di Campagna Agraria di un field (SIAN/AGEA) e idrata
   * lo store. Ritorna la row o null senza company attiva.
   */
  savePlotCampaign: (
    input: Omit<
      PlotCampaign,
      "id" | "tenant_id" | "closed_at" | "created_at" | "updated_at" | "deleted_at"
    > &
      Partial<Pick<PlotCampaign, "closed_at">> & { id?: string },
  ) => Promise<PlotCampaign | null>;
  /**
   * Chiude il ciclo colturale di una campagna (v17, raccolto delle annuali):
   * il field torna libero (mappa neutra, DSS spento) e una nuova semina può
   * ripartire nello stesso anno. Idrata lo store con la row chiusa.
   */
  closeCampaign: (id: string) => Promise<void>;
  /**
   * Crea/update una specie/varietà coltivata (`crops`) e idrata lo store.
   * Ritorna la row o null senza DAL active.
   */
  saveCrop: (
    input: Omit<
      Crop,
      "tenant_id" | "id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ) => Promise<Crop | null>;
  /**
   * Crea/update un product di warehouse (categorie rigide, validazione per
   * categoria nel DAL) e idrata lo store. Ritorna la row o null senza DAL.
   */
  saveProduct: (
    input: Omit<
      Product,
      | "id"
      | "tenant_id"
      | "company_id"
      | "metadata"
      | "avg_unit_cost"
      | "created_at"
      | "updated_at"
      | "deleted_at"
    > &
      Partial<Pick<Product, "metadata">> & { id?: string },
  ) => Promise<Product | null>;
  /** Soft-delete di un product di warehouse (i lots restano storicizzati). */
  deleteProduct: (id: string) => Promise<void>;
  /**
   * CARICO di un nuovo lot: crea il lot e update il CUMP del product
   * nella stessa transazione (§5.3), poi idrata products e lots nello store.
   */
  receiveLot: (
    input: Omit<
      ProductLot,
      | "id"
      | "tenant_id"
      | "quantity_on_hand"
      | "created_at"
      | "updated_at"
      | "deleted_at"
    > & { id?: string },
  ) => Promise<ProductLot | null>;
  /** Soft-delete di un lot di warehouse. */
  deleteLot: (id: string) => Promise<void>;
  /** Registra un soilSample di soil (`soil_samples`) e idrata lo store. */
  saveSoilSample: (
    input: Omit<
      SoilSample,
      "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ) => Promise<SoilSample | null>;
}

// ---------------------------------------------------------------------------
// Slice: UI Modalità Campo
// ---------------------------------------------------------------------------

export interface UiSlice {
  theme: AgroTheme;
  /** Vista di primo livello: mappa vs Data Command Center analitico. */
  activeView: AppView;
  panelMode: PanelMode;
  openPanels: FieldPanel[];
  /** Sidebar moduli compressa (modalità mappa a schermo intero). */
  sidebarCollapsed: boolean;
  selectedPlotId: string | null;
  /** Ultima operation dell'appezzamento selezionato (scheda dettaglio). */
  lastOperation: LastOperation | null;
  /**
   * Plot per cui aprire il Quaderno filtrato sulle sue lavorazioni
   * (click sul field in mappa). `null` = nessuna richiesta pendente. Il
   * LogbookPanel lo consuma all'apertura impostando il filtro.
   */
  logbookOpenPlotId: string | null;
  /**
   * Osservazione scouting da aprire in scheda dettaglio (click sul punto in
   * mappa). `null` = nessuna richiesta pendente. Il FieldCollectionTool lo
   * consuma all'apertura mostrando la scheda della nota.
   */
  scoutingOpenObservationId: string | null;
  /**
   * Plot su cui aprire la scheda "Dati coltura" già puntata (CTA
   * "Completa ora" della compliance SIAN, v17). `null` = nessuna richiesta
   * pendente; il ColturaDatiPanel la consuma all'apertura.
   */
  cropOpenPlotId: string | null;
  /**
   * Operazioni del Quaderno da renderizzare come simboli sulla mappa (toggle
   * "Mostra sulla mappa"). `null` = layer spento (nessun simbolo creato); array
   * = gli ID delle SOLE operazioni attualmente visibili nel registro (rispetta
   * i filters temporali/plot applicati nel pannello).
   */
  mapOperationIds: string[] | null;
  /**
   * `true` mentre il tool Scouting è in attesa di un tap sulla mappa per posare
   * la nota. Inibisce la selezione globale delle feature (`useFeatureSelection`),
   * così il click serve a posizionare la nota e non apre il Quaderno/dettaglio.
   */
  scoutingPlacing: boolean;

  // -- tema / layout --
  setTheme: (theme: AgroTheme) => void;
  /** Cambia la vista di primo livello (mappa ↔ Data Command Center). */
  setActiveView: (view: AppView) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  togglePanel: (panel: FieldPanel) => void;
  setPanelMode: (mode: PanelMode) => void;
  selectPlot: (id: string | null) => Promise<void>;
  /** Apre il Quaderno filtrato sulle lavorazioni dell'appezzamento (click sul field). */
  openLogbookForPlot: (plotId: string | null) => void;
  /** Consuma la richiesta di apertura Quaderno (chiamata dal LogbookPanel). */
  consumeLogbookOpen: () => void;
  /** Apre il pannello Scouting con la scheda della nota (click sul punto in mappa). */
  openScoutingForObservation: (observationId: string | null) => void;
  /** Consuma la richiesta di apertura Scouting (chiamata dal FieldCollectionTool). */
  consumeScoutingOpen: () => void;
  /** Apre la scheda "Dati coltura" puntata sull'appezzamento (CTA compliance SIAN). */
  openCropForPlot: (plotId: string | null) => void;
  /** Consuma la richiesta di apertura Dati crop (chiamata dal ColturaDatiPanel). */
  consumeCropOpen: () => void;
  /** Imposta gli ID delle operazioni da mostrare come simboli in mappa (null = spento). */
  setMapOperationIds: (ids: string[] | null) => void;
  /** Attiva/disattiva l'attesa di un tap per posare la nota scouting. */
  setScoutingPlacing: (placing: boolean) => void;
}

// ---------------------------------------------------------------------------
// Slice: disegno / selezione / editing geometrico
// ---------------------------------------------------------------------------

export interface GeometrySlice {
  /** Geometria disegnata in attesa di data-entry (scheda dati). */
  pendingGeometry: PendingGeometry | null;
  /** Tipo di geometria che l'utente intende tracciare (menu rapido disegno). */
  drawIntent: DrawnGeometry | null;
  /** Elemento selezionato sulla mappa (apre la scheda dettaglio/editing). */
  selectedFeature: SelectedFeatureRef | null;
  /** Sessione di editing spaziale attiva (marcatore: quale elemento). */
  geomEdit: GeomEditSession | null;
  /** Richiesta pendente sulla sessione (save/cancel), eseguita da useFieldPlugins. */
  geomEditRequest: GeomEditRequest;
  /** Pila undo delle modifiche geometriche (DAL-aware). */
  geometryUndo: GeometrySnapshot[];
  /** Pila redo delle modifiche geometriche (DAL-aware). */
  geometryRedo: GeometrySnapshot[];

  saveDrawnPlot: (
    geometria: Plot["geometry"],
    attrs?: PlotDrawAttrs,
  ) => Promise<Plot | null>;
  saveDrawnAsset: (
    geometria: Geometry,
    attrs?: AssetDrawAttrs,
  ) => Promise<InfrastructureAsset | null>;

  // -- data-entry geometria --
  setPendingGeometry: (pending: PendingGeometry | null) => void;
  clearPendingGeometry: () => void;

  // -- disegno / selezione / editing completo --
  setDrawIntent: (kind: DrawnGeometry | null) => void;
  selectFeatureOnMap: (ref: SelectedFeatureRef | null) => Promise<void>;
  clearSelectedFeature: () => void;
  /** Avvia l'editing geometrico nativo di un elemento (marcatore + apertura suite). */
  startGeometryEdit: (kind: SelectableKind, id: string) => void;
  /** Richiede il salvataggio della geometria editata (lo esegue useFieldPlugins). */
  requestSaveGeometry: () => void;
  /** Richiede l'annullamento dell'editing geometrico in corso. */
  requestCancelGeometry: () => void;
  /** Chiude la sessione di editing senza persistere (usato su cancel/teardown). */
  finishGeometryEdit: () => void;
  /**
   * Persiste sul DAL la geometria riletta dal layer dopo il salvataggio nativo,
   * registrando lo snapshot per l'undo. Chiamata da useFieldPlugins.
   */
  applyEditedGeometry: (geometry: Geometry) => Promise<void>;
  /** Annulla l'ultima modifica geometrica (riapplica `before` al DAL). */
  undoGeometry: () => Promise<void>;
  /** Ripristina la modifica geometrica annullata (riapplica `after` al DAL). */
  redoGeometry: () => Promise<void>;
  deleteElement: (kind: SelectableKind, id: string) => Promise<void>;
  /** UPDATE alfanumerico di un plot esistente (preserva i campi non passati). */
  updatePlot: (
    id: string,
    patch: Partial<Plot>,
  ) => Promise<void>;
  /** UPDATE alfanumerico di un asset/infrastructure esistente. */
  updateAsset: (
    id: string,
    patch: Partial<InfrastructureAsset>,
  ) => Promise<void>;
}

/**
 * Store Zustand agronomico completo: sessione/licenza, company attiva, dati di
 * dominio idratati dal DAL e stato della Modalità Campo. Specchio agronomico
 * dello `useAppStore` di GeoLibre (che resta il proprietario di mappa e layer):
 * questo store NON tiene stato cartografico (la visibilità dei layer è gestita
 * dal Layer Manager NATIVO di GeoLibre), solo dominio + UI di AgroGea.
 */
export type AgroState = SessionSlice & DomainSlice & UiSlice & GeometrySlice;

/** Firma di `setState`/`getState` condivisa dai creatori di slice. */
export type StoreSet = StoreApi<AgroState>["setState"];
export type StoreGet = StoreApi<AgroState>["getState"];
