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
 * slice per dominio (sessione, dominio dati, UI di campo, disegno/geometrie),
 * ricomposte in {@link AgroState}: ogni slice vive nel proprio modulo
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
 * Vista di primo livello dell'app di campo. `map` è la Dashboard geocentrica
 * (mappa + moduli); `command-center` è il Data Command Center analitico, dove la
 * mappa MaplLibre viene smontata per liberare risorse. Il contesto aziendale
 * (azienda attiva, DAL, dati di dominio) vive nello store e SOPRAVVIVE allo
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
  profilo: UserProfile | null;
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
  /** Ricarica il profilo/licenza dal control plane (pulsante "Ricontrolla"). */
  refreshProfilo: () => Promise<UserProfile | null>;

  // -- coda di sincronizzazione (outbox) --
  /** Carica la coda di mutazioni non ancora sincronizzate (per il pannello Sync). */
  caricaCodaSync: () => Promise<OutboxMutation[]>;
  /** Rimuove una voce dalla coda di sync (non sincronizzerà più). */
  eliminaMutazioneCoda: (mutationId: string) => Promise<void>;
  /** Svuota l'intera coda di mutazioni non sincronizzate. */
  svuotaCodaSync: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Slice: dominio (idratato dal DAL, mai costruito dai componenti)
// ---------------------------------------------------------------------------

export interface DomainSlice {
  aziende: Company[];
  aziendaAttivaId: string | null;
  appezzamenti: Plot[];
  /** Specie/varietà coltivate del workspace (catalogo `crops`). */
  crops: Crop[];
  trattamenti: TreatmentLog[];
  /** Infrastrutture (CAD-GIS): layer "infrastrutture". */
  assets: InfrastructureAsset[];
  /** Campionamenti suolo georeferenziati: layer "poi". */
  campionamenti: SoilSample[];
  /** Eventi di raccolta dell'azienda attiva (Modulo Harvest): layer "raccolte". */
  raccolte: Harvest[];
  /** Configurazione meteo dell'azienda attiva (Modulo Meteo), o null. */
  configMeteo: CompanyWeatherConfig | null;
  /** Giornale dei trasferimenti dati (import/export), più recenti prima. */
  dataTransferLogs: DataTransferLog[];
  /** Anno della Campagna Agraria attiva (filtra i campi burocratici/registri). */
  campagnaAttiva: number;
  /** Stato di campagna dei campi (SIAN/AGEA) dell'anno attivo. */
  campiCampagna: PlotCampaign[];
  /** Posti collaboratore del workspace (multiutente), idratati dal DAL. */
  memberships: TenantMembership[];
  /** Anagrafica prodotti di magazzino dell'azienda attiva (Modulo Magazzino). */
  prodotti: Product[];
  /** Lotti di magazzino (tutti i prodotti dell'azienda attiva). */
  lotti: ProductLot[];

  setAziendaAttiva: (aziendaId: string | null) => Promise<void>;
  /**
   * Cambio di workspace (azienda) richiesto dalla pagina di selezione: pulisce
   * lo stato derivato, isola le tabelle locali PGlite sul nuovo `tenant_id`
   * (sottoinsieme filtrato per azienda) e aggiorna lo stato React. La cache di
   * rendering dei vettori della mappa sulla WebView viene azzerata dal remount
   * della dashboard (`key={aziendaAttivaId}` in App), che ricostruisce mappa e
   * sorgenti da zero.
   */
  switchTenant: (aziendaId: string) => Promise<void>;
  /**
   * Crea una nuova azienda (workspace) durante l'onboarding: INSERT remoto
   * (online) — soggetto ai vincoli server-side su licenza e limite di piano —
   * poi specchio su PGlite locale e attivazione. Propaga l'eccezione del
   * database (messaggio del vincolo) al chiamante per il banner di errore nel
   * form.
   */
  creaAzienda: (input: NewCompanyInput) => Promise<Company>;
  /**
   * Crea/aggiorna un posto collaboratore (`tenant_memberships`) via DAL → outbox
   * e idrata lo store. La quota per ruolo/piano è verificata a monte dal
   * chiamante (field-suite `MembershipGuard`): qui si persiste soltanto.
   */
  salvaMembership: (
    input: Omit<
      TenantMembership,
      "id" | "tenant_id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ) => Promise<TenantMembership | null>;
  /** Soft-delete (tombstone sincronizzato) di un posto collaboratore. */
  eliminaMembership: (id: string) => Promise<void>;
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
  aggiornaAzienda: (patch: Partial<Company>) => Promise<void>;
  /** Salva la configurazione meteo dell'azienda attiva e idrata lo store. */
  salvaConfigMeteo: (
    patch: Partial<
      Omit<
        CompanyWeatherConfig,
        "company_id" | "tenant_id" | "created_at" | "updated_at"
      >
    >,
  ) => Promise<void>;
  /**
   * Registra un'operazione del Quaderno; con `scarichi` valorizzato aggancia i
   * lotti di magazzino nella STESSA transazione (scarico atomico §5.2: giacenza
   * insufficiente o lotto scaduto ⇒ l'intera registrazione fallisce e
   * l'eccezione `WarehouseError` risale al form).
   */
  registraTrattamento: (
    input: Omit<
      TreatmentLog,
      "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
    >,
    scarichi?: IssueRequest[],
  ) => Promise<TreatmentLog>;
  /**
   * Cancellazione protetta di una singola operazione del Quaderno (soft-delete
   * via DAL → outbox) e rimozione reattiva dalla lista. La conferma invasiva
   * (banner + toggle) è responsabilità della UI: qui si esegue solo il DELETE.
   */
  eliminaTrattamento: (id: string) => Promise<void>;
  /**
   * UPDATE alfanumerico di un'operazione del Quaderno esistente (preserva i
   * campi non passati). Upsert via DAL → outbox come ogni mutazione di dominio;
   * usato dall'editing inline del Command Center (calendario / Raw Data Inspector).
   */
  aggiornaTrattamento: (
    id: string,
    patch: Partial<TreatmentLog>,
  ) => Promise<TreatmentLog | null>;
  /** Salva la cache NDVI di un appezzamento (pipeline STAC) e idrata lo store. */
  salvaNdviMedio: (appezzamentoId: string, ndviMedio: number) => Promise<void>;
  /** Registra/aggiorna un evento di raccolta (Modulo Harvest) e idrata lo store. */
  salvaRaccolta: (
    input: Partial<
      Omit<
        Harvest,
        "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
      >
    > & { harvested_at: string },
  ) => Promise<Harvest | null>;
  /**
   * Cancellazione protetta di un evento di raccolta (soft-delete via DAL →
   * outbox) e rimozione reattiva dalla lista. La conferma invasiva è
   * responsabilità della UI, come per {@link eliminaTrattamento}.
   */
  eliminaRaccolta: (id: string) => Promise<void>;
  /**
   * Registra un trasferimento dati (import/export) nel giornale locale e
   * aggiorna reattivamente il feed dei tag. Ritorna la voce creata (per un tag
   * immediato) o null se non c'è un DAL attivo.
   */
  registraTrasferimento: (
    input: Pick<
      DataTransferLog,
      "operation_type" | "file_format" | "file_name"
    >,
  ) => Promise<DataTransferLog | null>;
  /** Imposta l'anno della Campagna Agraria attiva e ricarica i campi di campagna. */
  setCampagnaAttiva: (anno: number) => Promise<void>;
  /**
   * Crea/aggiorna lo stato di Campagna Agraria di un campo (SIAN/AGEA) e idrata
   * lo store. Ritorna la riga o null senza azienda attiva.
   */
  salvaCampoCampagna: (
    input: Omit<
      PlotCampaign,
      "id" | "tenant_id" | "closed_at" | "created_at" | "updated_at" | "deleted_at"
    > &
      Partial<Pick<PlotCampaign, "closed_at">> & { id?: string },
  ) => Promise<PlotCampaign | null>;
  /**
   * Chiude il ciclo colturale di una campagna (v17, raccolto delle annuali):
   * il campo torna libero (mappa neutra, DSS spento) e una nuova semina può
   * ripartire nello stesso anno. Idrata lo store con la riga chiusa.
   */
  chiudiCampagna: (id: string) => Promise<void>;
  /**
   * Crea/aggiorna una specie/varietà coltivata (`crops`) e idrata lo store.
   * Ritorna la riga o null senza DAL attivo.
   */
  salvaCrop: (
    input: Omit<
      Crop,
      "tenant_id" | "id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string },
  ) => Promise<Crop | null>;
  /**
   * Crea/aggiorna un prodotto di magazzino (categorie rigide, validazione per
   * categoria nel DAL) e idrata lo store. Ritorna la riga o null senza DAL.
   */
  salvaProdotto: (
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
  /** Soft-delete di un prodotto di magazzino (i lotti restano storicizzati). */
  eliminaProdotto: (id: string) => Promise<void>;
  /**
   * CARICO di un nuovo lotto: crea il lotto e aggiorna il CUMP del prodotto
   * nella stessa transazione (§5.3), poi idrata prodotti e lotti nello store.
   */
  caricaLotto: (
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
  /** Soft-delete di un lotto di magazzino. */
  eliminaLotto: (id: string) => Promise<void>;
  /** Registra un campionamento di suolo (`soil_samples`) e idrata lo store. */
  salvaCampionamento: (
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
  appezzamentoSelezionatoId: string | null;
  /** Ultima operazione dell'appezzamento selezionato (scheda dettaglio). */
  ultimaOperazione: LastOperation | null;
  /**
   * Plot per cui aprire il Quaderno filtrato sulle sue lavorazioni
   * (click sul campo in mappa). `null` = nessuna richiesta pendente. Il
   * LogbookPanel lo consuma all'apertura impostando il filtro.
   */
  quadernoApriAppezzamentoId: string | null;
  /**
   * Osservazione scouting da aprire in scheda dettaglio (click sul punto in
   * mappa). `null` = nessuna richiesta pendente. Il FieldCollectionTool lo
   * consuma all'apertura mostrando la scheda della nota.
   */
  scoutingApriOsservazioneId: string | null;
  /**
   * Plot su cui aprire la scheda "Dati coltura" già puntata (CTA
   * "Completa ora" della compliance SIAN, v17). `null` = nessuna richiesta
   * pendente; il ColturaDatiPanel la consuma all'apertura.
   */
  colturaApriAppezzamentoId: string | null;
  /**
   * Operazioni del Quaderno da renderizzare come simboli sulla mappa (toggle
   * "Mostra sulla mappa"). `null` = layer spento (nessun simbolo creato); array
   * = gli ID delle SOLE operazioni attualmente visibili nel registro (rispetta
   * i filtri temporali/appezzamento applicati nel pannello).
   */
  operazioniMappaIds: string[] | null;
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
  selectAppezzamento: (id: string | null) => Promise<void>;
  /** Apre il Quaderno filtrato sulle lavorazioni dell'appezzamento (click sul campo). */
  apriQuadernoPerAppezzamento: (appezzamentoId: string | null) => void;
  /** Consuma la richiesta di apertura Quaderno (chiamata dal LogbookPanel). */
  consumaQuadernoApri: () => void;
  /** Apre il pannello Scouting con la scheda della nota (click sul punto in mappa). */
  apriScoutingPerOsservazione: (osservazioneId: string | null) => void;
  /** Consuma la richiesta di apertura Scouting (chiamata dal FieldCollectionTool). */
  consumaScoutingApri: () => void;
  /** Apre la scheda "Dati coltura" puntata sull'appezzamento (CTA compliance SIAN). */
  apriColturaPerAppezzamento: (appezzamentoId: string | null) => void;
  /** Consuma la richiesta di apertura Dati coltura (chiamata dal ColturaDatiPanel). */
  consumaColturaApri: () => void;
  /** Imposta gli ID delle operazioni da mostrare come simboli in mappa (null = spento). */
  setOperazioniMappaIds: (ids: string[] | null) => void;
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

  salvaAppezzamentoDisegnato: (
    geometria: Plot["geometry"],
    attrs?: PlotDrawAttrs,
  ) => Promise<Plot | null>;
  salvaAssetDisegnato: (
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
  undoGeometria: () => Promise<void>;
  /** Ripristina la modifica geometrica annullata (riapplica `after` al DAL). */
  redoGeometria: () => Promise<void>;
  eliminaElemento: (kind: SelectableKind, id: string) => Promise<void>;
  /** UPDATE alfanumerico di un appezzamento esistente (preserva i campi non passati). */
  aggiornaAppezzamento: (
    id: string,
    patch: Partial<Plot>,
  ) => Promise<void>;
  /** UPDATE alfanumerico di un asset/infrastruttura esistente. */
  aggiornaAsset: (
    id: string,
    patch: Partial<InfrastructureAsset>,
  ) => Promise<void>;
}

/**
 * Store Zustand agronomico completo: sessione/licenza, azienda attiva, dati di
 * dominio idratati dal DAL e stato della Modalità Campo. Specchio agronomico
 * dello `useAppStore` di GeoLibre (che resta il proprietario di mappa e layer):
 * questo store NON tiene stato cartografico (la visibilità dei layer è gestita
 * dal Layer Manager NATIVO di GeoLibre), solo dominio + UI di AgroGea.
 */
export type AgroState = SessionSlice & DomainSlice & UiSlice & GeometrySlice;

/** Firma di `setState`/`getState` condivisa dai creatori di slice. */
export type StoreSet = StoreApi<AgroState>["setState"];
export type StoreGet = StoreApi<AgroState>["getState"];
