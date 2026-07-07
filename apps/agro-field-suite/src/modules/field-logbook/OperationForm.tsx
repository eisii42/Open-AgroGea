import {
  type Plot,
  type SoilSample,
  type CatalogEntry,
  categoryForOperation,
  centroid,
  type DoseUnit,
  irrigationToLitres,
  litresToIrrigation,
  type ProductLot,
  type Product,
  type IssueRequest,
  expiryStatus,
  type OperationType,
  type ValidationError,
  validateFertilizationLog,
  validateTreatmentLog,
  type WaterUnit,
  waterUnitLabel,
  useAgroStore,
  useSettingsStore,
} from "@agrogea/core";
import {
  AVVERSITA_PAN,
  type CampoCampagnaOption,
  type ComplianceTrattamento,
  type TrattamentoFormValues,
} from "@agrogea/ui";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import type { Point } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";

/**
 * Form UNICO e ADATTIVO del Quaderno di Campagna: a partire dal tipo operazione
 * scelto, mostra SOLO i campi pertinenti (es. la lavorazione non chiede il
 * patentino; il rilievo solo data/operatore/note). I tipi "di registro" scrivono
 * nella stessa tabella `treatment_logs` (colonne nullable): nessuna modifica di
 * schema. Il campionamento di SUOLO è un caso speciale: scrive sulla tabella
 * dedicata `soil_samples` (via `onSubmitSoil`), con posizione = centroid del
 * campo.
 */

const UNITA: DoseUnit[] = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"];

type ProductMode = "phyto" | "fertilizer" | "seed";

interface OpFieldSpec {
  product?: ProductMode;
  registrationNumber?: boolean;
  activeSubstance?: boolean;
  targetDisease?: boolean;
  dose?: boolean;
  /** Volume d'acqua della botte/atomizzatore (litri) — treatments fitosanitari. */
  waterVolume?: boolean;
  /** Apporto irriguo in mm/hl (lama d'acqua o volume) — irrigazione. */
  irrigationAmount?: boolean;
  /** Totale automatico dose × superficie (unità /ha). */
  totalAuto?: boolean;
  /** Totale inserito a mano in kg. */
  totalManual?: boolean;
  fertilizerType?: boolean;
  npkRatio?: boolean;
  operatorTaxCode?: boolean;
  licenseNumber?: boolean;
  machinery?: boolean;
  /** Nome/tipo della lavorazione (→ product_name). */
  tillageType?: boolean;
  reentry?: boolean;
  safety?: boolean;
  validate?: "phyto" | "fert";
  nitrogen?: boolean;
}

export interface OperazioneSpec {
  type: OperationType;
  label: string;
  descr: string;
  fields: OpFieldSpec;
}

/**
 * Registro dei tipi operazione e dei campi pertinenti a ciascuno. `label` e
 * `descr` sono getter che risolvono la traduzione al momento della lettura
 * (tramite l'istanza `i18n` condivisa, non un hook React): così i consumer
 * esterni che leggono `OPERAZIONI` come semplice array di dati (es.
 * `LogbookPanel`) vedono comunque il testo nella lingua attiva a ogni
 * render, senza dover convertire l'array in una funzione.
 */
export const OPERAZIONI: OperazioneSpec[] = [
  {
    type: "phytosanitary",
    get label() {
      return i18n.t("operazioneForm.type.phytosanitary.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.phytosanitary.descr");
    },
    fields: {
      product: "phyto",
      registrationNumber: true,
      activeSubstance: true,
      targetDisease: true,
      dose: true,
      waterVolume: true,
      totalAuto: true,
      operatorTaxCode: true,
      licenseNumber: true,
      reentry: true,
      safety: true,
      validate: "phyto",
    },
  },
  {
    type: "fertilization",
    get label() {
      return i18n.t("operazioneForm.type.fertilization.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.fertilization.descr");
    },
    fields: {
      product: "fertilizer",
      fertilizerType: true,
      npkRatio: true,
      totalManual: true,
      validate: "fert",
      nitrogen: true,
    },
  },
  {
    type: "irrigation",
    get label() {
      return i18n.t("operazioneForm.type.irrigation.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.irrigation.descr");
    },
    fields: { irrigationAmount: true, machinery: true },
  },
  {
    type: "tillage",
    get label() {
      return i18n.t("operazioneForm.type.tillage.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.tillage.descr");
    },
    fields: { tillageType: true, machinery: true },
  },
  {
    type: "sowing",
    get label() {
      return i18n.t("operazioneForm.type.sowing.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.sowing.descr");
    },
    fields: { product: "seed", dose: true, machinery: true },
  },
  {
    type: "sampling",
    get label() {
      return i18n.t("operazioneForm.type.sampling.label");
    },
    get descr() {
      return i18n.t("operazioneForm.type.sampling.descr");
    },
    fields: {},
  },
];

export function operazioneSpec(type: OperationType): OperazioneSpec {
  return OPERAZIONI.find((o) => o.type === type) ?? OPERAZIONI[0];
}

/** Input del campionamento suolo emesso dal form (verso `soil_samples`). */
export type CampionamentoSuoloInput = Omit<
  SoilSample,
  "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
>;

/** Riga di scarico magazzino in compilazione nel form. */
interface ScaricoRow {
  productId: string;
  lotId: string;
  quantity: string;
  /**
   * true dopo un edit manuale della quantità: la riconciliazione automatica
   * dose → scarico smette di sovrascriverla (l'utente ha preso il controllo).
   */
  manual?: boolean;
}

/**
 * Proposta di assegnazione coltura al campo generata da una SEMINA con scarico
 * di una semente (automazione v17): il chiamante (LogbookPanel) crea
 * `crops` + `plots_campaign` dopo la registrazione dell'operazione.
 */
export interface AssegnazioneColtura {
  plotId: string;
  /** Nome comune della specie (dall'anagrafica semente o dal nome prodotto). */
  species: string;
  scientificName: string | null;
  varietyName: string | null;
  /** Categoria DSS del campo ("seminativo" | "orticoltura"). */
  cropCategory: string;
  /** Densità di semina derivata dalla dose (kg/ha), se disponibile. */
  densitaSemina: number | null;
  declaredAreaHa: number;
}

/** Memoria per-device dell'ultimo operatore usato (precompilazione form). */
const OPERATOR_KEY = "agrogea.last_operator";

interface OperatorMemory {
  name?: string;
  taxCode?: string;
  license?: string;
}

function loadOperatorMemory(): OperatorMemory {
  try {
    const raw = globalThis.localStorage?.getItem(OPERATOR_KEY);
    return raw ? (JSON.parse(raw) as OperatorMemory) : {};
  } catch {
    return {};
  }
}

function persistOperatorMemory(memory: OperatorMemory) {
  try {
    globalThis.localStorage?.setItem(OPERATOR_KEY, JSON.stringify(memory));
  } catch {
    // storage non disponibile: la memoria resta di sessione.
  }
}

/** Stringa da numero nullable (per i default della ripetizione operazione). */
const numStr = (v: number | null | undefined) => (v == null ? "" : String(v));

export interface OperazioneFormProps {
  operationType: OperationType;
  plots: Plot[];
  campaignFields?: CampoCampagnaOption[];
  prodottiCatalogo?: CatalogEntry[];
  concimiCatalogo?: CatalogEntry[];
  /**
   * Anagrafica e lots del Magazzino (0.2.0). Se ci sono products della
   * categoria pertinente al tipo operazione, il form mostra la sezione
   * "Scarico da magazzino": prodotto → lotto → quantità. I lots SCADUTI sono
   * mostrati ma NON selezionabili (uso bloccato, §5.1).
   */
  prodottiMagazzino?: Product[];
  lottiMagazzino?: ProductLot[];
  valutaCompliance?: (appezzamento: Plot) => ComplianceTrattamento | null;
  defaultAppezzamentoId?: string | null;
  /**
   * Salvataggio dell'operazione; `scarichi` non vuoto attiva lo scarico
   * ATOMICO dei lots (§5.2): un errore (giacenza/lotto scaduto) annulla tutto
   * e risale qui, dove il form lo mostra senza chiudersi. `assegnazione` è la
   * proposta di coltura da una semina (automazione v17), null se disattivata.
   */
  onSubmit: (
    values: TrattamentoFormValues,
    scarichi?: IssueRequest[],
    assegnazione?: AssegnazioneColtura | null,
  ) => Promise<void> | void;
  /** Salvataggio del campionamento di suolo (tabella dedicata). */
  onSubmitSoil?: (input: CampionamentoSuoloInput) => Promise<void> | void;
  onCancel?: () => void;
  /**
   * Valori iniziali per "Ripeti operazione": precompila i campi dal record
   * esistente (la data resta oggi, gli scarichi si riscelgono sui lots attuali).
   */
  defaults?: Partial<TrattamentoFormValues>;
}

export function OperationForm({
  operationType,
  plots,
  campaignFields,
  prodottiCatalogo,
  concimiCatalogo,
  prodottiMagazzino,
  lottiMagazzino,
  valutaCompliance,
  defaultAppezzamentoId,
  onSubmit,
  onSubmitSoil,
  onCancel,
  defaults,
}: OperazioneFormProps) {
  const { t } = useTranslation();
  const spec = operazioneSpec(operationType);
  const f = spec.fields;
  const usaCampagna = (campaignFields?.length ?? 0) > 0;
  const catalogo =
    f.product === "phyto"
      ? prodottiCatalogo
      : f.product === "fertilizer"
        ? concimiCatalogo
        : undefined;
  const usaCatalogo = (catalogo?.length ?? 0) > 0;

  // Precompilazioni: appezzamento dal contesto (o dal record da ripetere),
  // ultimo operatore usato sul device, e — con `defaults` — i campi del record
  // da ripetere (la data resta oggi).
  const opMemory = useMemo(loadOperatorMemory, []);
  const initialApp = defaultAppezzamentoId || defaults?.plot_id || "";
  const [plotId, setAppezzamentoId] = useState(initialApp);
  const [campoCampagnaId, setCampoCampagnaId] = useState(() => {
    if (!usaCampagna || !initialApp) return "";
    return (
      campaignFields?.find((c) => c.plotId === initialApp)
        ?.campoCampagnaId ?? ""
    );
  });
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [prodotto, setProdotto] = useState(
    f.tillageType ? "" : defaults?.product_name ?? "",
  );
  const [prodottoCodice, setProdottoCodice] = useState("");
  const [numeroRegistrazione, setNumeroRegistrazione] = useState(
    defaults?.registration_number ?? "",
  );
  const [sostanzaAttiva, setSostanzaAttiva] = useState(
    defaults?.active_substance ?? "",
  );
  const [target, setTarget] = useState(defaults?.target_disease ?? "");
  const [doseValore, setDoseValore] = useState(numStr(defaults?.dose_value));
  const [doseUnita, setDoseUnita] = useState<DoseUnit>(
    defaults?.dose_unit ?? "kg/ha",
  );
  const [acquaVolume, setAcquaVolume] = useState(
    f.waterVolume ? numStr(defaults?.water_volume_l) : "",
  );
  // Irrigazione: quantità + unità (mm/hl). L'unità di default segue la preferenza
  // utente; è sovrascrivibile per singolo intervento.
  const waterPref = useSettingsStore((s) => s.units.water);
  const [irrAmount, setIrrAmount] = useState("");
  const [irrUnit, setIrrUnit] = useState<WaterUnit>(waterPref);
  const [totaleManuale, setTotaleManuale] = useState(
    f.totalManual ? numStr(defaults?.total_quantity) : "",
  );
  const [tipoConcime, setTipoConcime] = useState(
    defaults?.fertilizer_type ?? "minerale",
  );
  const [titoloNpk, setTitoloNpk] = useState(defaults?.npk_ratio ?? "");
  const [tipoLavorazione, setTipoLavorazione] = useState(
    f.tillageType ? defaults?.product_name ?? "" : "",
  );
  const [operatore, setOperatore] = useState(
    defaults?.operator_name ?? opMemory.name ?? "",
  );
  const [operatoreCf, setOperatoreCf] = useState(
    defaults?.operator_tax_code ?? opMemory.taxCode ?? "",
  );
  const [numPatentino, setNumPatentino] = useState(
    defaults?.license_number ?? opMemory.license ?? "",
  );
  const [mezzo, setMezzo] = useState(defaults?.machinery_equipment ?? "");
  const [rientro, setRientro] = useState(numStr(defaults?.reentry_interval_h));
  const [carenza, setCarenza] = useState(numStr(defaults?.safety_period_days));
  const [note, setNote] = useState("");
  // Campionamento: matrice + analisi del suolo.
  const [matrice, setMatrice] = useState<"suolo" | "altro">("suolo");
  const [profondita, setProfondita] = useState("");
  const [ph, setPh] = useState("");
  const [azoto, setAzoto] = useState("");
  const [fosforo, setFosforo] = useState("");
  const [potassio, setPotassio] = useState("");
  const [sostanzaOrganica, setSostanzaOrganica] = useState("");
  const [tessitura, setTessitura] = useState("");
  const [saving, setSaving] = useState(false);
  // Scarico da magazzino (0.2.0): righe prodotto → lotto → quantità.
  const [scarichiRows, setScarichiRows] = useState<ScaricoRow[]>([]);
  // Errore del salvataggio (es. giacenza insufficiente): il form resta aperto.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const appezzamento = useMemo(
    () => plots.find((a) => a.id === plotId) ?? null,
    [plots, plotId],
  );
  const campoSel = useMemo(
    () => campaignFields?.find((c) => c.campoCampagnaId === campoCampagnaId) ?? null,
    [campaignFields, campoCampagnaId],
  );
  const superficie = campoSel?.superficieHa ?? appezzamento?.area_ha ?? null;
  const isSampling = operationType === "sampling";
  const soilMode = isSampling && matrice === "suolo";

  // Volume irriguo (litri) canonico salvato su `water_volume_l`, dall'apporto in
  // mm/hl e dalla superficie del campo (i mm sono per ettaro).
  const irrLitres = useMemo(
    () =>
      f.irrigationAmount
        ? irrigationToLitres(Number.parseFloat(irrAmount), irrUnit, superficie)
        : null,
    [f.irrigationAmount, irrAmount, irrUnit, superficie],
  );

  const totaleAutomatico = useMemo(() => {
    const dose = Number.parseFloat(doseValore);
    if (!f.totalAuto || !Number.isFinite(dose) || !superficie || !doseUnita.endsWith("/ha")) {
      return null;
    }
    return Math.round(dose * superficie * 100) / 100;
  }, [f.totalAuto, doseValore, doseUnita, superficie]);

  const totaleManualeNum =
    totaleManuale.trim() === "" ? null : Number(totaleManuale);

  const compliance = useMemo(
    () => (appezzamento && valutaCompliance ? valutaCompliance(appezzamento) : null),
    [appezzamento, valutaCompliance],
  );
  const totalePerAzoto = totaleAutomatico ?? totaleManualeNum;
  const superaAzoto =
    f.nitrogen &&
    compliance?.azotoMaxTotaleKg != null &&
    totalePerAzoto != null &&
    totalePerAzoto > compliance.azotoMaxTotaleKg;

  const panErrors = useMemo<ValidationError[]>(() => {
    if (f.validate === "phyto") {
      return validateTreatmentLog({
        operation_date: data,
        target_disease: target,
        product_name: prodotto,
        registration_number: numeroRegistrazione,
        active_substance: sostanzaAttiva,
        applied_dose: doseValore ? Number.parseFloat(doseValore) : null,
        unit_of_measure: doseUnita,
        operator_license_number: numPatentino,
      });
    }
    if (f.validate === "fert") {
      return validateFertilizationLog({
        operation_date: data,
        fertilizer_type: tipoConcime,
        commercial_name: prodotto,
        total_amount_kg: totaleManualeNum,
        npk_ratio: titoloNpk,
      });
    }
    return [];
  }, [
    f.validate,
    data,
    target,
    prodotto,
    numeroRegistrazione,
    sostanzaAttiva,
    doseValore,
    doseUnita,
    numPatentino,
    tipoConcime,
    titoloNpk,
    totaleManualeNum,
  ]);
  const mancano = panErrors.length > 0;
  // Per il campione di suolo serve un campo georeferenziato (centroid = posizione).
  const soilSenzaCampo = soilMode && !appezzamento;

  // -- Magazzino (0.2.0): categoria pertinente e validazione righe scarico ----
  const categoriaMagazzino = categoryForOperation(operationType);
  const prodottiCategoria = useMemo(
    () =>
      categoriaMagazzino
        ? (prodottiMagazzino ?? []).filter(
            (p) => p.category === categoriaMagazzino,
          )
        : [],
    [prodottiMagazzino, categoriaMagazzino],
  );
  const usaMagazzino = prodottiCategoria.length > 0;
  const lottoById = useMemo(() => {
    const map = new Map<string, ProductLot>();
    for (const l of lottiMagazzino ?? []) map.set(l.id, l);
    return map;
  }, [lottiMagazzino]);

  // -- riconciliazione dose ⇄ scarico (v17) -----------------------------------
  // Unità di base della quantità prevista: il prefisso della dose (kg/l) o kg
  // per il totale manuale delle fertilizzazioni. La quantità di scarico segue
  // il totale calcolato finché l'utente non la modifica a mano (row.manual).
  const baseDose = f.totalManual ? "kg" : doseUnita.split("/")[0];
  const totalePrevisto =
    totaleAutomatico ?? (f.totalManual ? totaleManualeNum : null);
  /** true se l'unità del prodotto può riconciliarsi con la quantità prevista. */
  const unitaCompatibile = (unit: string) =>
    totalePrevisto == null || unit === baseDose;

  /** Lotti utilizzabili del prodotto (giacenza > 0, non scaduti) in ordine FEFO. */
  const lottiUtilizzabili = (productId: string): ProductLot[] =>
    (lottiMagazzino ?? []).filter(
      (l) =>
        l.product_id === productId &&
        Number(l.quantity_on_hand) > 0 &&
        expiryStatus(l.expires_at) !== "expired",
    );

  /** Riga compilata per intero e coerente: quantità > 0 e ≤ giacenza, lotto non scaduto. */
  const rowValida = (row: ScaricoRow): boolean => {
    const qty = Number.parseFloat(row.quantity);
    const lotto = lottoById.get(row.lotId);
    return Boolean(
      row.productId &&
        lotto &&
        Number.isFinite(qty) &&
        qty > 0 &&
        qty <= Number(lotto.quantity_on_hand) &&
        expiryStatus(lotto.expires_at) !== "expired",
    );
  };
  const scarichiValidi: IssueRequest[] = scarichiRows
    .filter(rowValida)
    .map((row) => ({
      product_lot_id: row.lotId,
      quantity: Number.parseFloat(row.quantity),
    }));
  // Una riga toccata ma non valida blocca il submit (niente scarichi "a metà").
  const scarichiIncompleti = scarichiRows.some(
    (row) =>
      (row.productId || row.lotId || row.quantity.trim() !== "") &&
      !rowValida(row),
  );

  // Auto-fill (v17): con UNA riga di scarico non modificata a mano, la quantità
  // segue il totale previsto (dose × superficie, o totale manuale in kg).
  useEffect(() => {
    if (totalePrevisto == null || totalePrevisto <= 0) return;
    setScarichiRows((rows) => {
      if (rows.length !== 1) return rows;
      const row = rows[0];
      if (row.manual || !row.productId) return rows;
      const p = prodottiCategoria.find((x) => x.id === row.productId);
      if (!p || p.unit !== baseDose) return rows;
      const q = String(totalePrevisto);
      return row.quantity === q ? rows : [{ ...row, quantity: q }];
    });
  }, [totalePrevisto, baseDose, prodottiCategoria]);

  // -- automazione semina → coltura di campagna (v17) -------------------------
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const seedProdotto =
    operationType === "sowing"
      ? prodottiCategoria.find((p) => p.id === scarichiRows[0]?.productId) ?? null
      : null;
  // Il campo scelto non ha una campagna APERTA per l'annata: la semina può
  // assegnargli la coltura (crops + plots_campaign) automaticamente.
  const plotSenzaCampagna = Boolean(
    plotId &&
      !(campaignFields ?? []).some((c) => c.plotId === plotId),
  );
  const [assegnaColtura, setAssegnaColtura] = useState(true);
  const proponiAssegnazione = Boolean(
    seedProdotto && plotId && plotSenzaCampagna,
  );
  const metaSeed = (seedProdotto?.metadata ?? {}) as Record<string, unknown>;
  const metaSeedStr = (key: string): string | null => {
    const v = metaSeed[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const speciesName = metaSeedStr("species") ?? seedProdotto?.name ?? "";
  const assegnazione: AssegnazioneColtura | null =
    proponiAssegnazione && assegnaColtura && superficie != null
      ? {
          plotId: plotId,
          species: speciesName,
          scientificName: metaSeedStr("scientific_name"),
          varietyName: metaSeedStr("variety_name"),
          cropCategory: metaSeedStr("crop_category") ?? "seminativo",
          densitaSemina:
            doseUnita === "kg/ha" && doseValore
              ? Number.parseFloat(doseValore)
              : null,
          declaredAreaHa: superficie,
        }
      : null;

  const canSubmit = !saving && !mancano && !soilSenzaCampo && !scarichiIncompleti;

  function selezionaCampagna(value: string) {
    setCampoCampagnaId(value);
    setAppezzamentoId(
      campaignFields?.find((c) => c.campoCampagnaId === value)?.plotId ?? "",
    );
  }

  function selezionaProdotto(codice: string) {
    setProdottoCodice(codice);
    const voce = catalogo?.find((p) => p.code === codice);
    setProdotto(voce?.name ?? "");
    if (voce?.active_substance) setSostanzaAttiva(voce.active_substance);
    if (voce?.registration_number) setNumeroRegistrazione(voce.registration_number);
    const npk = voce?.metadata?.["npk_ratio"];
    if (typeof npk === "string") setTitoloNpk(npk);
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  // -- righe scarico magazzino ------------------------------------------------

  function aggiornaScarico(index: number, patch: Partial<ScaricoRow>) {
    setScarichiRows((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        if (patch.productId !== undefined && patch.productId !== row.productId) {
          // Cambio prodotto: lotto ripreselezionato in FEFO (scadenza valida
          // più vicina); quantità riproposta dal totale previsto se l'utente
          // non l'ha ancora modificata a mano.
          const lotto = patch.productId
            ? lottiUtilizzabili(patch.productId)[0] ?? null
            : null;
          const p = prodottiCategoria.find((x) => x.id === patch.productId);
          const auto =
            !row.manual && totalePrevisto != null && p?.unit === baseDose
              ? String(totalePrevisto)
              : row.quantity;
          return {
            productId: patch.productId,
            lotId: lotto?.id ?? "",
            quantity: auto,
            manual: row.manual,
          };
        }
        // Edit manuale della quantità: da qui in poi comanda l'utente (la
        // riconciliazione automatica smette di sovrascrivere).
        if (patch.quantity !== undefined) {
          return { ...row, quantity: patch.quantity, manual: true };
        }
        return { ...row, ...patch };
      }),
    );
    // Prima riga: auto-compila il nome prodotto (fallback testuale del registro)
    // e i default dell'anagrafica (registrazione, sostanza attiva, carenza e
    // rientro, v17) se i campi sono ancora vuoti.
    if (index === 0 && patch.productId) {
      const p = prodottiCategoria.find((x) => x.id === patch.productId);
      if (p) {
        setProdotto((corrente) => corrente || p.name);
        if (p.registration_number) {
          setNumeroRegistrazione((corrente) => corrente || p.registration_number || "");
        }
        if (p.active_substance) {
          setSostanzaAttiva((corrente) => corrente || p.active_substance || "");
        }
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        const carenzaDef = meta["safety_period_days"];
        if (f.safety && (typeof carenzaDef === "number" || typeof carenzaDef === "string")) {
          setCarenza((corrente) => corrente || String(carenzaDef));
        }
        const rientroDef = meta["reentry_interval_h"];
        if (f.reentry && (typeof rientroDef === "number" || typeof rientroDef === "string")) {
          setRientro((corrente) => corrente || String(rientroDef));
        }
      }
    }
  }

  function rimuoviScarico(index: number) {
    setScarichiRows((rows) => rows.filter((_, i) => i !== index));
  }

  /**
   * Divide la quantità della riga su più lots in ordine FEFO (v17): la riga
   * viene sostituita da una riga per lotto finché la quantità è coperta.
   * No-op se la giacenza complessiva del prodotto non basta.
   */
  function dividiFefo(index: number) {
    setScarichiRows((rows) => {
      const row = rows[index];
      const qty = Number.parseFloat(row?.quantity ?? "");
      if (!row || !Number.isFinite(qty) || qty <= 0) return rows;
      const nuove: ScaricoRow[] = [];
      let resto = qty;
      for (const lotto of lottiUtilizzabili(row.productId)) {
        if (resto <= 0) break;
        const presa = Math.min(resto, Number(lotto.quantity_on_hand));
        nuove.push({
          productId: row.productId,
          lotId: lotto.id,
          quantity: String(Math.round(presa * 1000) / 1000),
          manual: true,
        });
        resto = Math.round((resto - presa) * 1000) / 1000;
      }
      if (nuove.length === 0 || resto > 0) return rows;
      return [...rows.slice(0, index), ...nuove, ...rows.slice(index + 1)];
    });
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSaving(true);
    try {
      if (soilMode && appezzamento) {
        const [lon, lat] = centroid(appezzamento.geometry);
        const position: Point = { type: "Point", coordinates: [lon, lat] };
        await onSubmitSoil?.({
          plot_id: appezzamento.id,
          sampled_at: new Date(`${data}T12:00:00`).toISOString(),
          sampling_position: position,
          depth_cm: profondita ? Number.parseInt(profondita, 10) : null,
          nitrogen: num(azoto),
          phosphorus: num(fosforo),
          potassium: num(potassio),
          organic_matter: num(sostanzaOrganica),
          ph: num(ph),
          texture: tessitura.trim() || null,
          metadata: note.trim() ? { note: note.trim() } : {},
        });
        return;
      }

      await onSubmit({
        operation_type: operationType,
        plot_id: plotId || null,
        plot_campaign_id: campoCampagnaId || null,
        product_name: f.product
          ? prodotto || null
          : f.tillageType
            ? tipoLavorazione.trim() || null
            : null,
        registration_number: f.registrationNumber ? numeroRegistrazione || null : null,
        active_substance: f.activeSubstance ? sostanzaAttiva || null : null,
        target_disease: f.targetDisease ? target || null : null,
        dose_value: f.dose && doseValore ? Number.parseFloat(doseValore) : null,
        dose_unit: f.dose && doseValore ? doseUnita : null,
        total_quantity: totaleAutomatico ?? (f.totalManual ? totaleManualeNum : null),
        // water_volume_l = volume in litri: la botte (fitosanitari) o l'apporto
        // irriguo convertito da mm/hl (irrigazione). È la forma che il bilancio
        // idrico riconverte in lama d'acqua (mm) sulla superficie del campo.
        water_volume_l: f.waterVolume
          ? acquaVolume
            ? Number.parseInt(acquaVolume, 10)
            : null
          : f.irrigationAmount
            ? irrLitres
            : null,
        fertilizer_type: f.fertilizerType ? tipoConcime : null,
        npk_ratio: f.npkRatio ? titoloNpk || null : null,
        operator_name: operatore.trim() || null,
        operator_tax_code: f.operatorTaxCode ? operatoreCf.trim().toUpperCase() || null : null,
        license_number: f.licenseNumber ? numPatentino || null : null,
        machinery_equipment: f.machinery ? mezzo.trim() || null : null,
        reentry_interval_h: f.reentry && rientro ? Number.parseInt(rientro, 10) : null,
        safety_period_days: f.safety && carenza ? Number.parseInt(carenza, 10) : null,
        executed_at: new Date(`${data}T12:00:00`).toISOString(),
        weather_conditions: null,
        note: note.trim() || null,
      }, scarichiValidi, assegnazione);
      // Memoria operatore (v17): l'ultimo operatore usato precompila i form.
      if (operatore.trim() || operatoreCf.trim() || numPatentino.trim()) {
        persistOperatorMemory({
          name: operatore.trim() || undefined,
          taxCode: operatoreCf.trim() || undefined,
          license: numPatentino.trim() || undefined,
        });
      }
    } catch (e) {
      // Scarico atomico fallito (giacenza insufficiente, lotto scaduto…): la
      // transazione è stata annullata per intero; il form resta aperto con il
      // messaggio, l'utente corregge e riprova.
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const productLabel =
    f.product === "phyto"
      ? t("operazioneForm.productPhyto")
      : f.product === "fertilizer"
        ? t("operazioneForm.productFertilizer")
        : t("operazioneForm.productSeed");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--ink-3)]">
        {spec.descr}
      </p>

      {/* Data + appezzamento/campagna (comuni a tutti i tipi) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-data">{t("operazioneForm.date")}</Label>
          <Input id="op-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-app">
            {usaCampagna ? t("logbook.common.fieldCampaign") : t("logbook.common.plot")}
          </Label>
          {usaCampagna ? (
            <Select id="op-app" value={campoCampagnaId} onChange={(e) => selezionaCampagna(e.target.value)}>
              <option value="">
                {soilMode ? t("logbook.common.select") : t("logbook.common.wholeFarm")}
              </option>
              {campaignFields?.map((c) => (
                <option key={c.campoCampagnaId} value={c.campoCampagnaId}>
                  {c.nome}
                  {c.codiceColturaSian ? ` · ${c.codiceColturaSian}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Select id="op-app" value={plotId} onChange={(e) => setAppezzamentoId(e.target.value)}>
              <option value="">
                {soilMode ? t("logbook.common.select") : t("logbook.common.wholeFarm")}
              </option>
              {plots.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                  {a.area_ha != null ? ` · ${a.area_ha.toFixed(2)} ha` : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {/* Campionamento: scelta della matrice */}
      {isSampling && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-matrice">{t("operazioneForm.sampledMatrix")}</Label>
          <Select
            id="op-matrice"
            value={matrice}
            onChange={(e) => setMatrice(e.target.value as "suolo" | "altro")}
          >
            <option value="suolo">{t("operazioneForm.soilAnalysisOption")}</option>
            <option value="altro">{t("operazioneForm.otherSampleOption")}</option>
          </Select>
        </div>
      )}

      {soilSenzaCampo && (
        <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          {t("operazioneForm.selectPlotForSoilSample")}
        </p>
      )}

      {/* Campi analisi suolo → soil_samples */}
      {soilMode && (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("operazioneForm.soilAnalysis")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-prof">{t("operazioneForm.depthCm")}</Label>
              <Input id="soil-prof" type="number" inputMode="numeric" min="0" value={profondita} onChange={(e) => setProfondita(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-ph">{t("detailEditSheet.ph")}</Label>
              <Input id="soil-ph" type="number" inputMode="decimal" step="any" value={ph} onChange={(e) => setPh(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-so">{t("operazioneForm.organicMatterPercent")}</Label>
              <Input id="soil-so" type="number" inputMode="decimal" step="any" value={sostanzaOrganica} onChange={(e) => setSostanzaOrganica(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-n">{t("operazioneForm.nitrogenN")}</Label>
              <Input id="soil-n" type="number" inputMode="decimal" step="any" value={azoto} onChange={(e) => setAzoto(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-p">{t("operazioneForm.phosphorusP")}</Label>
              <Input id="soil-p" type="number" inputMode="decimal" step="any" value={fosforo} onChange={(e) => setFosforo(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-k">{t("operazioneForm.potassiumK")}</Label>
              <Input id="soil-k" type="number" inputMode="decimal" step="any" value={potassio} onChange={(e) => setPotassio(e.target.value)} className="agro-num" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soil-tex">{t("operazioneForm.texture")}</Label>
            <Input id="soil-tex" value={tessitura} onChange={(e) => setTessitura(e.target.value)} placeholder={t("operazioneForm.texturePlaceholder")} />
          </div>
        </section>
      )}

      {compliance && compliance.note.length > 0 && f.nitrogen && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          {compliance.note.map((n) => (
            <span key={n}>• {n}</span>
          ))}
          {compliance.azotoMaxTotaleKg != null && (
            <span className="text-[var(--ink-3)]">
              {t("operazioneForm.nitrogenMax")}{" "}
              <strong className="agro-num">{compliance.azotoMaxTotaleKg} kg</strong>
            </span>
          )}
        </div>
      )}

      {/* Tipo lavorazione (→ product_name) */}
      {f.tillageType && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-lav">{t("operazioneForm.tillageTypeLabel")}</Label>
          <Input id="op-lav" value={tipoLavorazione} onChange={(e) => setTipoLavorazione(e.target.value)} placeholder={t("operazioneForm.tillageTypePlaceholder")} />
        </div>
      )}

      {/* Product (fito/concime/seme) */}
      {f.product && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-prod">{productLabel}</Label>
          {usaCatalogo ? (
            <Select id="op-prod" value={prodottoCodice} onChange={(e) => selezionaProdotto(e.target.value)}>
              <option value="">{t("operazioneForm.selectFromNationalRegister")}</option>
              {catalogo?.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                  {p.registration_number ? ` · ${p.registration_number}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="op-prod" value={prodotto} onChange={(e) => setProdotto(e.target.value)} />
          )}
        </div>
      )}

      {/* Scarico da magazzino (0.2.0): prodotto → lotto → quantità. Lotti
          scaduti visibili ma NON selezionabili (uso bloccato §5.1). */}
      {usaMagazzino && !isSampling && (
        <section className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("operazioneForm.warehouseSection")}
          </p>
          {scarichiRows.length === 0 && (
            <p className="text-[11px] text-[var(--ink-3)]">
              {t("operazioneForm.warehouseFreeText")}
            </p>
          )}
          {scarichiRows.map((row, index) => {
            const prodottoSel = prodottiCategoria.find(
              (p) => p.id === row.productId,
            );
            const lottiProdotto = (lottiMagazzino ?? []).filter(
              (l) => l.product_id === row.productId,
            );
            const lottoSel = lottoById.get(row.lotId) ?? null;
            const disponibile = lottoSel ? Number(lottoSel.quantity_on_hand) : null;
            return (
              <div
                key={`scarico-${index}`}
                className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`op-mag-prod-${index}`}>
                      {t("operazioneForm.warehouseProduct")}
                    </Label>
                    <Select
                      id={`op-mag-prod-${index}`}
                      value={row.productId}
                      onChange={(e) =>
                        aggiornaScarico(index, { productId: e.target.value })
                      }
                    >
                      <option value="">{t("operazioneForm.selectEllipsis")}</option>
                      {prodottiCategoria.map((p) => {
                        // Product in unità non riconciliabile con la dose
                        // (kg vs l): non selezionabile finché c'è un totale
                        // previsto da far quadrare.
                        const incompatibile = !unitaCompatibile(p.unit);
                        return (
                          <option key={p.id} value={p.id} disabled={incompatibile}>
                            {p.name} · {p.unit}
                            {incompatibile
                              ? ` · ${t("operazioneForm.warehouseIncompatibleUnit", { unit: baseDose })}`
                              : ""}
                          </option>
                        );
                      })}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`op-mag-lotto-${index}`}>
                      {t("operazioneForm.warehouseLot")}
                    </Label>
                    <Select
                      id={`op-mag-lotto-${index}`}
                      value={row.lotId}
                      onChange={(e) =>
                        aggiornaScarico(index, { lotId: e.target.value })
                      }
                      disabled={!row.productId}
                    >
                      <option value="">{t("operazioneForm.selectEllipsis")}</option>
                      {lottiProdotto.map((l) => {
                        const stato = expiryStatus(l.expires_at);
                        const scaduto = stato === "expired";
                        return (
                          <option key={l.id} value={l.id} disabled={scaduto}>
                            {l.lot_number ?? l.id.slice(0, 8)}
                            {l.expires_at ? ` · ${l.expires_at}` : ""}
                            {" · "}
                            {t("operazioneForm.warehouseAvailable", {
                              qty: Number(l.quantity_on_hand),
                              unit: prodottoSel?.unit ?? "",
                            })}
                            {scaduto
                              ? ` · ${t("operazioneForm.warehouseExpiredOption")}`
                              : stato === "expiring"
                                ? ` · ${t("operazioneForm.warehouseExpiringOption")}`
                                : ""}
                          </option>
                        );
                      })}
                    </Select>
                    {row.productId && lottiProdotto.length === 0 && (
                      <p className="text-[11px] text-[var(--warn)]">
                        {t("operazioneForm.warehouseNoLots")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor={`op-mag-qta-${index}`}>
                      {t("operazioneForm.warehouseQuantity", {
                        unit: prodottoSel?.unit ?? "—",
                      })}
                    </Label>
                    <Input
                      id={`op-mag-qta-${index}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      max={disponibile ?? undefined}
                      value={row.quantity}
                      onChange={(e) =>
                        aggiornaScarico(index, { quantity: e.target.value })
                      }
                      className="agro-num"
                    />
                  </div>
                  {disponibile != null && (
                    <p className="pb-2 text-[11px] text-[var(--ink-3)]">
                      {t("operazioneForm.warehouseAvailable", {
                        qty: disponibile,
                        unit: prodottoSel?.unit ?? "",
                      })}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => rimuoviScarico(index)}
                    className="min-h-[40px] px-2 text-xs"
                  >
                    {t("operazioneForm.warehouseRemoveRow")}
                  </Button>
                </div>

                {/* Riconciliazione dose ⇄ scarico: dose effettiva, scostamento
                    dal totale previsto e split FEFO quando il lotto non basta. */}
                {(() => {
                  const qty = Number.parseFloat(row.quantity);
                  if (!Number.isFinite(qty) || qty <= 0) return null;
                  const unit = prodottoSel?.unit ?? "";
                  const doseEffettiva =
                    superficie && superficie > 0 ? qty / superficie : null;
                  const scostamento =
                    totalePrevisto != null &&
                    totalePrevisto > 0 &&
                    prodottoSel?.unit === baseDose &&
                    Math.abs(qty - totalePrevisto) / totalePrevisto > 0.05;
                  const oltreLotto =
                    disponibile != null && qty > disponibile;
                  const copribile =
                    oltreLotto &&
                    lottiUtilizzabili(row.productId).reduce(
                      (s, l) => s + Number(l.quantity_on_hand),
                      0,
                    ) >= qty;
                  if (!doseEffettiva && !scostamento && !oltreLotto) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {doseEffettiva != null && f.dose && (
                        <span className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[var(--ink-3)]">
                          {t("operazioneForm.warehouseEffectiveDose", {
                            dose: (Math.round(doseEffettiva * 100) / 100).toLocaleString("it-IT"),
                            unit: `${unit}/ha`,
                          })}
                        </span>
                      )}
                      {scostamento && (
                        <span className="rounded-full bg-[var(--warn-l)] px-2 py-0.5 font-medium text-[var(--warn)]">
                          {t("operazioneForm.warehouseMismatch", {
                            total: totalePrevisto,
                            unit,
                          })}
                        </span>
                      )}
                      {copribile && (
                        <button
                          type="button"
                          onClick={() => dividiFefo(index)}
                          className="rounded-full border border-[var(--accent-bd)] bg-[var(--accent-l)] px-2 py-0.5 font-medium text-[var(--accent)]"
                        >
                          {t("operazioneForm.warehouseSplitFefo")}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setScarichiRows((rows) => [
                ...rows,
                { productId: "", lotId: "", quantity: "" },
              ])
            }
            className="self-start text-xs font-medium text-[var(--accent)]"
          >
            {t("operazioneForm.warehouseAddRow")}
          </button>
        </section>
      )}

      {/* Automazione v17: la semina di una semente su un campo senza coltura
          propone di creare scheda coltura + campagna agraria in automatico. */}
      {proponiAssegnazione && (
        <label className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--accent-bd)] bg-[var(--accent-l)] px-3 py-2">
          <input
            type="checkbox"
            checked={assegnaColtura}
            onChange={(e) => setAssegnaColtura(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--accent)]">
              {t("operazioneForm.assignCropLabel", {
                crop:
                  speciesName +
                  (metaSeedStr("variety_name")
                    ? ` (${metaSeedStr("variety_name")})`
                    : ""),
                plot: appezzamento?.user_plot_name ?? "",
                year: activeCampaign,
              })}
            </span>
            <span className="block text-[11px] text-[var(--ink-3)]">
              {t("operazioneForm.assignCropHint")}
            </span>
          </span>
        </label>
      )}

      {f.fertilizerType && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-tipoconcime">{t("logbook.fertilization.type")}</Label>
            <Select id="op-tipoconcime" value={tipoConcime} onChange={(e) => setTipoConcime(e.target.value)}>
              <option value="minerale">{t("logbook.fertilization.mineral")}</option>
              <option value="organico">{t("logbook.fertilization.organic")}</option>
              <option value="organo-minerale">{t("operazioneForm.organoMineral")}</option>
            </Select>
          </div>
          {f.npkRatio && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-npk">{t("logbook.fertilization.npk")}</Label>
              <Input id="op-npk" value={titoloNpk} onChange={(e) => setTitoloNpk(e.target.value)} placeholder={t("logbook.fertilization.npkPlaceholder")} className="agro-num" />
            </div>
          )}
        </div>
      )}

      {f.registrationNumber && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-reg">{t("logbook.treatment.regNumber")}</Label>
            <Input id="op-reg" value={numeroRegistrazione} onChange={(e) => setNumeroRegistrazione(e.target.value)} className="agro-num" />
          </div>
          {f.activeSubstance && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-sa">{t("logbook.treatment.activeSubstance")}</Label>
              <Input id="op-sa" value={sostanzaAttiva} onChange={(e) => setSostanzaAttiva(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {f.targetDisease && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-target">{t("operazioneForm.targetPest")}</Label>
          <Select id="op-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("operazioneForm.selectEllipsis")}</option>
            {AVVERSITA_PAN.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
      )}

      {(f.dose || f.waterVolume) && (
        <div className="grid grid-cols-3 gap-3">
          {f.dose && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="op-dose">{t("logbook.treatment.dose")}</Label>
                <Input id="op-dose" type="number" inputMode="decimal" min="0" step="any" value={doseValore} onChange={(e) => setDoseValore(e.target.value)} className="agro-num" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="op-unita">{t("logbook.treatment.unit")}</Label>
                <Select id="op-unita" value={doseUnita} onChange={(e) => setDoseUnita(e.target.value as DoseUnit)}>
                  {UNITA.map((u) => (
                    <option key={u} value={u}>
                      {u === "m3" ? "m³" : u}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          {f.waterVolume && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-acqua">{t("logbook.treatment.water")}</Label>
              <Input id="op-acqua" type="number" inputMode="numeric" min="0" step="1" value={acquaVolume} onChange={(e) => setAcquaVolume(e.target.value)} className="agro-num" />
            </div>
          )}
        </div>
      )}

      {/* Irrigazione: apporto in mm (lama d'acqua) o hl (volume), per preferenza. */}
      {f.irrigationAmount && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="op-irr">{t("operazioneForm.irrigationAmount", { unit: waterUnitLabel(irrUnit) })}</Label>
              <Input
                id="op-irr"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={irrAmount}
                onChange={(e) => setIrrAmount(e.target.value)}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-irr-unit">{t("logbook.treatment.unit")}</Label>
              <Select
                id="op-irr-unit"
                value={irrUnit}
                onChange={(e) => setIrrUnit(e.target.value as WaterUnit)}
              >
                <option value="mm">{t("operazioneForm.mmSheet")}</option>
                <option value="hl">{t("operazioneForm.hlVolume")}</option>
              </Select>
            </div>
          </div>
          {irrLitres != null && (
            <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--ink-3)]">
              ≈{" "}
              <strong className="agro-num">
                {(irrLitres / 1000).toFixed(1)} m³
              </strong>
              {superficie != null && superficie > 0 && (
                <>
                  {" · "}
                  <strong className="agro-num">
                    {litresToIrrigation(
                      irrLitres,
                      irrUnit === "mm" ? "hl" : "mm",
                      superficie,
                    ).toFixed(1)}{" "}
                    {irrUnit === "mm" ? "hl" : "mm"}
                  </strong>{" "}
                  {t("operazioneForm.onSurface", { area: superficie.toFixed(2) })}
                </>
              )}
            </p>
          )}
          {superficie == null && irrUnit === "mm" && (
            <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-1.5 text-xs text-[var(--warn)]">
              {t("operazioneForm.selectPlotForMmConversion")}
            </p>
          )}
        </div>
      )}

      {totaleAutomatico != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
          {t("logbook.treatment.computedTotal")}{" "}
          <strong className="agro-num text-[var(--ink)]">
            {totaleAutomatico} {doseUnita.split("/")[0]}
          </strong>{" "}
          ({doseValore} {doseUnita} × {superficie?.toFixed(2)} ha)
        </p>
      )}

      {f.totalManual && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-tot">{t("operazioneForm.totalQuantityKg")}</Label>
          <Input id="op-tot" type="number" inputMode="decimal" min="0" step="any" value={totaleManuale} onChange={(e) => setTotaleManuale(e.target.value)} className="agro-num" />
        </div>
      )}

      {superaAzoto && compliance?.azotoMaxTotaleKg != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {t("logbook.treatment.nitrogenExceeded", { max: compliance.azotoMaxTotaleKg })}
        </p>
      )}

      {/* Operatore + (CF/patentino/mezzo solo dove richiesti) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-operatore">{t("operazioneForm.operator")}</Label>
          <Input id="op-operatore" value={operatore} onChange={(e) => setOperatore(e.target.value)} placeholder={t("operazioneForm.operatorPlaceholder")} />
        </div>
        {f.operatorTaxCode && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-cf">{t("logbook.treatment.operatorTaxCode")}</Label>
            <Input id="op-cf" value={operatoreCf} onChange={(e) => setOperatoreCf(e.target.value)} className="agro-num uppercase" maxLength={16} />
          </div>
        )}
        {f.licenseNumber && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-pat">{t("logbook.treatment.license")}</Label>
            <Input id="op-pat" value={numPatentino} onChange={(e) => setNumPatentino(e.target.value)} className="agro-num" />
          </div>
        )}
        {f.machinery && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-mezzo">{t("operazioneForm.machinery")}</Label>
            <Input id="op-mezzo" value={mezzo} onChange={(e) => setMezzo(e.target.value)} placeholder={t("operazioneForm.machineryPlaceholder")} />
          </div>
        )}
      </div>

      {(f.reentry || f.safety) && (
        <div className="grid grid-cols-2 gap-3">
          {f.reentry && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-rientro">{t("operazioneForm.reentryHours")}</Label>
              <Input id="op-rientro" type="number" inputMode="numeric" min="0" value={rientro} onChange={(e) => setRientro(e.target.value)} className="agro-num" />
            </div>
          )}
          {f.safety && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-carenza">{t("operazioneForm.safetyDays")}</Label>
              <Input id="op-carenza" type="number" inputMode="numeric" min="0" value={carenza} onChange={(e) => setCarenza(e.target.value)} className="agro-num" />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="op-note">{t("operazioneForm.notes")}</Label>
        <textarea
          id="op-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      {mancano && (
        <div className="flex flex-col gap-0.5 rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          <span className="font-semibold uppercase tracking-wide">{t("logbook.common.panRequired")}</span>
          {panErrors.map((e) => (
            <span key={`${e.field}-${e.messageKey}`}>• {e.field}</span>
          ))}
        </div>
      )}

      {/* Scarico atomico fallito: la transazione è annullata per intero (§5.2). */}
      {submitError && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {t("operazioneForm.warehouseSubmitError", { message: submitError })}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={!canSubmit} className={cn("min-h-[var(--touch-min)] flex-1")}>
          {saving ? t("logbook.common.saving") : t("operazioneForm.submit")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="min-h-[var(--touch-min)]">
            {t("logbook.common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
