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
  PAN_PESTS,
  type FieldCampaignOption,
  type ComplianceTreatment,
  type TreatmentFormValues,
} from "@agrogea/ui";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { X } from "lucide-react";
import type { Point } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";

/**
 * Form UNICO e ADATTIVO del Quaderno di Campagna: a partire dal tipo operation
 * scelto, mostra SOLO i campi pertinenti (es. la lavorazione non chiede il
 * patentino; il rilievo solo data/operatore/note). I tipi "di registro" scrivono
 * nella stessa tabella `treatment_logs` (columns nullable): nessuna modifica di
 * schema. Il soilSample di SOIL è un caso speciale: scrive sulla tabella
 * dedicata `soil_samples` (via `onSubmitSoil`), con posizione = centroid del
 * field.
 */

const UNITS: DoseUnit[] = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"];

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
  /** Totale automatico dose × area (unità /ha). */
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

export interface OperationSpec {
  type: OperationType;
  label: string;
  descr: string;
  fields: OpFieldSpec;
}

/**
 * Registro dei tipi operation e dei campi pertinenti a ciascuno. `label` e
 * `descr` sono getter che risolvono la traduzione al momento della reading
 * (tramite l'istanza `i18n` condivisa, non un hook React): così i consumer
 * esterni che leggono `OPERATIONS` come semplice array di dati (es.
 * `LogbookPanel`) vedono comunque il testo nella lingua attiva a ogni
 * render, senza dover convertire l'array in una funzione.
 */
export const OPERATIONS: OperationSpec[] = [
  {
    type: "phytosanitary",
    get label() {
      return i18n.t("operationForm.type.phytosanitary.label");
    },
    get descr() {
      return i18n.t("operationForm.type.phytosanitary.descr");
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
      return i18n.t("operationForm.type.fertilization.label");
    },
    get descr() {
      return i18n.t("operationForm.type.fertilization.descr");
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
      return i18n.t("operationForm.type.irrigation.label");
    },
    get descr() {
      return i18n.t("operationForm.type.irrigation.descr");
    },
    fields: { irrigationAmount: true, machinery: true },
  },
  {
    type: "tillage",
    get label() {
      return i18n.t("operationForm.type.tillage.label");
    },
    get descr() {
      return i18n.t("operationForm.type.tillage.descr");
    },
    fields: { tillageType: true, machinery: true },
  },
  {
    type: "sowing",
    get label() {
      return i18n.t("operationForm.type.sowing.label");
    },
    get descr() {
      return i18n.t("operationForm.type.sowing.descr");
    },
    fields: { product: "seed", dose: true, machinery: true },
  },
  {
    type: "sampling",
    get label() {
      return i18n.t("operationForm.type.sampling.label");
    },
    get descr() {
      return i18n.t("operationForm.type.sampling.descr");
    },
    fields: {},
  },
];

export function operationSpec(type: OperationType): OperationSpec {
  return OPERATIONS.find((o) => o.type === type) ?? OPERATIONS[0];
}

/** Input del soilSample soil emesso dal form (verso `soil_samples`). */
export type SoilSampleInput = Omit<
  SoilSample,
  "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
>;

/** Riga di issue warehouse in compilazione nel form. */
interface DischargeRow {
  productId: string;
  lotId: string;
  quantity: string;
  /**
   * true dopo un edit manuale della quantità: la riconciliazione automatica
   * dose → issue smette di sovrascriverla (l'utente ha preso il controllo).
   */
  manual?: boolean;
}

/**
 * Proposta di assegnazione crop al field generata da una SEMINA con issue
 * di una semente (automazione v17): il chiamante (LogbookPanel) crea
 * `crops` + `plots_campaign` dopo la registrazione dell'operazione.
 */
export interface CropAssignment {
  plotId: string;
  /** Nome comune della specie (dall'anagrafica semente o dal name product). */
  species: string;
  scientificName: string | null;
  varietyName: string | null;
  /** Categoria DSS del field ("seminativo" | "orticoltura"). */
  cropCategory: string;
  /** Densità di semina derivata dalla dose (kg/ha), se available. */
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
    // storage non available: la memoria resta di sessione.
  }
}

/** Stringa da number nullable (per i default della ripetizione operation). */
const numStr = (v: number | null | undefined) => (v == null ? "" : String(v));

/** Titolo N-P-K ("n-p-k") da un product di warehouse; vuoto se nessun titolo. */
function npkRatioFromProduct(p: {
  npk_n: number | null;
  npk_p: number | null;
  npk_k: number | null;
}): string {
  if (p.npk_n == null && p.npk_p == null && p.npk_k == null) return "";
  return [p.npk_n ?? 0, p.npk_p ?? 0, p.npk_k ?? 0].join("-");
}

/** Conversione dell'unità di stock del product in kg (per il totale concime). */
const UNIT_TO_KG: Record<string, number> = { kg: 1, q: 100, t: 1000 };

export interface OperationFormProps {
  operationType: OperationType;
  plots: Plot[];
  campaignFields?: FieldCampaignOption[];
  prodottiCatalogo?: CatalogEntry[];
  concimiCatalogo?: CatalogEntry[];
  /**
   * Anagrafica e lots del Magazzino (0.2.0). Se ci sono products della
   * categoria pertinente al tipo operation, il form mostra la sezione
   * "Scarico da magazzino": product → lot → quantità. I lots SCADUTI sono
   * mostrati ma NON selezionabili (uso bloccato, §5.1).
   */
  prodottiMagazzino?: Product[];
  lottiMagazzino?: ProductLot[];
  valutaCompliance?: (plot: Plot) => ComplianceTreatment | null;
  defaultAppezzamentoId?: string | null;
  /**
   * Salvataggio dell'operazione; `scarichi` non vuoto attiva lo issue
   * ATOMICO dei lots (§5.2): un errore (stock/lot scaduto) annulla tutto
   * e risale qui, dove il form lo mostra senza chiudersi. `assegnazione` è la
   * proposta di crop da una semina (automazione v17), null se disattivata.
   */
  onSubmit: (
    values: TreatmentFormValues,
    issues?: IssueRequest[],
    assegnazione?: CropAssignment | null,
  ) => Promise<void> | void;
  /** Salvataggio del soilSample di soil (tabella dedicata). */
  onSubmitSoil?: (input: SoilSampleInput) => Promise<void> | void;
  onCancel?: () => void;
  /**
   * Valori iniziali per "Ripeti operazione": precompila i campi dal record
   * esistente (la data resta oggi, gli issues si riscelgono sui lots attuali).
   */
  defaults?: Partial<TreatmentFormValues>;
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
}: OperationFormProps) {
  const { t } = useTranslation();
  const spec = operationSpec(operationType);
  const f = spec.fields;
  const usesCampaign = (campaignFields?.length ?? 0) > 0;
  // Semina, lavorazione e campionamento si fanno anche su suolo NUDO (senza
  // coltura in campagna): per questi tipi il selettore elenca TUTTI gli
  // appezzamenti, non solo i campi con coltura. Selezionando un plot con
  // campagna aperta il legame alla coltura resta agganciato automaticamente.
  const allowBarePlot =
    operationType === "sowing" ||
    operationType === "tillage" ||
    operationType === "sampling";
  const usePlotSelector = !usesCampaign || allowBarePlot;
  const catalog =
    f.product === "phyto"
      ? prodottiCatalogo
      : f.product === "fertilizer"
        ? concimiCatalogo
        : undefined;
  const usaCatalogo = (catalog?.length ?? 0) > 0;

  // Precompilazioni: plot dal contesto (o dal record da ripetere),
  // ultimo operatore usato sul device, e — con `defaults` — i campi del record
  // da ripetere (la data resta oggi).
  const opMemory = useMemo(loadOperatorMemory, []);
  const initialApp = defaultAppezzamentoId || defaults?.plot_id || "";
  const [plotId, setPlotId] = useState(initialApp);
  const [fieldCampaignId, setFieldCampaignId] = useState(() => {
    if (!usesCampaign || !initialApp) return "";
    return (
      campaignFields?.find((c) => c.plotId === initialApp)
        ?.fieldCampaignId ?? ""
    );
  });
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [product, setProduct] = useState(
    f.tillageType ? "" : defaults?.product_name ?? "",
  );
  const [productCode, setProductCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState(
    defaults?.registration_number ?? "",
  );
  const [sostanzaAttiva, setSostanzaAttiva] = useState(
    defaults?.active_substance ?? "",
  );
  const [target, setTarget] = useState(defaults?.target_disease ?? "");
  const [doseValue, setDoseValue] = useState(numStr(defaults?.dose_value));
  const [doseUnit, setDoseUnit] = useState<DoseUnit>(
    defaults?.dose_unit ?? "kg/ha",
  );
  const [waterVolume, setWaterVolume] = useState(
    f.waterVolume ? numStr(defaults?.water_volume_l) : "",
  );
  // Irrigazione: quantità + unità (mm/hl). L'unità di default segue la preferenza
  // utente; è sovrascrivibile per singolo intervento.
  const waterPref = useSettingsStore((s) => s.units.water);
  const [irrAmount, setIrrAmount] = useState("");
  const [irrUnit, setIrrUnit] = useState<WaterUnit>(waterPref);
  const [manualTotal, setManualTotal] = useState(
    f.totalManual ? numStr(defaults?.total_quantity) : "",
  );
  const [fertilizerType, setFertilizerType] = useState(
    defaults?.fertilizer_type ?? "minerale",
  );
  const [npkRatio, setNpkRatio] = useState(defaults?.npk_ratio ?? "");
  const [tillageType, setTillageType] = useState(
    f.tillageType ? defaults?.product_name ?? "" : "",
  );
  const [operator, setOperator] = useState(
    defaults?.operator_name ?? opMemory.name ?? "",
  );
  const [operatorTaxCode, setOperatorTaxCode] = useState(
    defaults?.operator_tax_code ?? opMemory.taxCode ?? "",
  );
  const [licenseNumber, setLicenseNumber] = useState(
    defaults?.license_number ?? opMemory.license ?? "",
  );
  const [machinery, setMachinery] = useState(defaults?.machinery_equipment ?? "");
  const [reentry, setReentry] = useState(numStr(defaults?.reentry_interval_h));
  const [safetyPeriod, setSafetyPeriod] = useState(numStr(defaults?.safety_period_days));
  const [note, setNote] = useState("");
  // Campionamento: matrice + analisi del soil.
  const [matrix, setMatrix] = useState<"suolo" | "altro">("suolo");
  const [depth, setDepth] = useState("");
  const [ph, setPh] = useState("");
  const [nitrogen, setNitrogen] = useState("");
  const [phosphorus, setPhosphorus] = useState("");
  const [potassium, setPotassium] = useState("");
  const [sostanzaOrganica, setSostanzaOrganica] = useState("");
  const [texture, setTexture] = useState("");
  const [saving, setSaving] = useState(false);
  // Scarico da warehouse (0.2.0): rows product → lot → quantità. Con products
  // della categoria in magazzino la row di scarico è GIÀ PRONTA all'apertura:
  // è il percorso primario dell'inserimento snello (product → quantità, il
  // resto si deriva dall'anagrafica del product).
  const [dischargeRows, setDischargeRows] = useState<DischargeRow[]>(() => {
    const cat = categoryForOperation(operationType);
    const available = cat
      ? (prodottiMagazzino ?? []).some((p) => p.category === cat)
      : false;
    return available ? [{ productId: "", lotId: "", quantity: "" }] : [];
  });
  // "Altro": inserimento manuale di materiale NON presente in magazzino
  // (nessuno issue di stock; il registro resta testuale come prima del v17).
  const [manualProduct, setManualProduct] = useState(false);
  // Errore del salvataggio (es. stock insufficiente): il form resta aperto.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const plot = useMemo(
    () => plots.find((a) => a.id === plotId) ?? null,
    [plots, plotId],
  );
  const selectedField = useMemo(
    () => campaignFields?.find((c) => c.fieldCampaignId === fieldCampaignId) ?? null,
    [campaignFields, fieldCampaignId],
  );
  const area = selectedField?.superficieHa ?? plot?.area_ha ?? null;
  const isSampling = operationType === "sampling";
  const soilMode = isSampling && matrix === "suolo";

  // Volume irriguo (litri) canonico salvato su `water_volume_l`, dall'apporto in
  // mm/hl e dalla area del field (i mm sono per ettaro).
  const irrLitres = useMemo(
    () =>
      f.irrigationAmount
        ? irrigationToLitres(Number.parseFloat(irrAmount), irrUnit, area)
        : null,
    [f.irrigationAmount, irrAmount, irrUnit, area],
  );

  const automaticTotal = useMemo(() => {
    const dose = Number.parseFloat(doseValue);
    if (!f.totalAuto || !Number.isFinite(dose) || !area || !doseUnit.endsWith("/ha")) {
      return null;
    }
    return Math.round(dose * area * 100) / 100;
  }, [f.totalAuto, doseValue, doseUnit, area]);

  const manualTotalNum =
    manualTotal.trim() === "" ? null : Number(manualTotal);

  const compliance = useMemo(
    () => (plot && valutaCompliance ? valutaCompliance(plot) : null),
    [plot, valutaCompliance],
  );
  const totalForNitrogen = automaticTotal ?? manualTotalNum;
  const exceedsNitrogen =
    f.nitrogen &&
    compliance?.azotoMaxTotaleKg != null &&
    totalForNitrogen != null &&
    totalForNitrogen > compliance.azotoMaxTotaleKg;

  const panErrors = useMemo<ValidationError[]>(() => {
    if (f.validate === "phyto") {
      return validateTreatmentLog({
        operation_date: data,
        target_disease: target,
        product_name: product,
        registration_number: registrationNumber,
        active_substance: sostanzaAttiva,
        applied_dose: doseValue ? Number.parseFloat(doseValue) : null,
        unit_of_measure: doseUnit,
        operator_license_number: licenseNumber,
      });
    }
    if (f.validate === "fert") {
      return validateFertilizationLog({
        operation_date: data,
        fertilizer_type: fertilizerType,
        commercial_name: product,
        total_amount_kg: manualTotalNum,
        npk_ratio: npkRatio,
      });
    }
    return [];
  }, [
    f.validate,
    data,
    target,
    product,
    registrationNumber,
    sostanzaAttiva,
    doseValue,
    doseUnit,
    licenseNumber,
    fertilizerType,
    npkRatio,
    manualTotalNum,
  ]);
  const missing = panErrors.length > 0;
  // Per il campione di soil serve un field georeferenziato (centroid = posizione).
  const soilWithoutField = soilMode && !plot;

  // -- Magazzino (0.2.0): categoria pertinente e validazione rows issue ----
  const warehouseCategory = categoryForOperation(operationType);
  const categoryProducts = useMemo(
    () =>
      warehouseCategory
        ? (prodottiMagazzino ?? []).filter(
            (p) => p.category === warehouseCategory,
          )
        : [],
    [prodottiMagazzino, warehouseCategory],
  );
  const usesWarehouse = categoryProducts.length > 0;
  // Con un product di warehouse selezionato, i parametri specifici del product
  // (registrazione, sostanza attiva, tipo/titolo concime, dose, totale, carenza,
  // rientro) sono automatici e i relativi campi vengono nascosti (UX snellita).
  const hasWarehouseProduct =
    usesWarehouse && dischargeRows.some((r) => r.productId);
  // Modalità manuale ("Altro"): senza products in magazzino, o su scelta
  // esplicita dell'utente (materiale non censito). In modalità magazzino i
  // campi di anagrafica del product NON si mostrano: arrivano dal DB.
  const manualMode = !usesWarehouse || manualProduct;
  // Eccezione anti-blocco: se il product scelto NON fornisce un dato richiesto
  // dalla validazione PAN (es. sostanza attiva assente in anagrafica), il campo
  // ricompare per il completamento manuale — mai un obbligo nascosto.
  const showIfMissing = (value: string) =>
    manualMode || (hasWarehouseProduct && value.trim() === "");
  // Dose: nel percorso magazzino è CALCOLATA dallo scarico (quantità/area) e il
  // campo resta nascosto e non modificabile (compare nella scheda operazione).
  // Ricompare SOLO se non è derivabile: quantità inserita ma area ignota
  // ("intera azienda") — la validazione PAN la richiede per i fitosanitari.
  const dischargeQtyPresent = dischargeRows.some(
    (r) => r.productId && Number.parseFloat(r.quantity) > 0,
  );
  const doseNotDerivable =
    hasWarehouseProduct && dischargeQtyPresent && (area == null || area <= 0);
  const showDose = manualMode || doseNotDerivable;
  const lotById = useMemo(() => {
    const map = new Map<string, ProductLot>();
    for (const l of lottiMagazzino ?? []) map.set(l.id, l);
    return map;
  }, [lottiMagazzino]);

  // -- riconciliazione dose ⇄ issue (v17) -----------------------------------
  // Unità di base della quantità prevista: il prefisso della dose (kg/l) o kg
  // per il totale manuale delle fertilizzazioni. La quantità di issue segue
  // il totale calcolato finché l'utente non la modifica a mano (row.manual).
  const baseDose = f.totalManual ? "kg" : doseUnit.split("/")[0];
  const expectedTotal =
    automaticTotal ?? (f.totalManual ? manualTotalNum : null);
  /**
   * true se l'unità del product può riconciliarsi con la quantità prevista:
   * stessa unità, oppure stessa famiglia dei solidi (kg ⇄ q ⇄ t, il flusso
   * quantity-first normalizza in kg). Senza questa tolleranza un concime in
   * quintali risulterebbe non selezionabile appena il totale (kg) è calcolato.
   */
  const compatibleUnit = (unit: string) =>
    expectedTotal == null ||
    unit === baseDose ||
    (baseDose === "kg" && unit in UNIT_TO_KG);

  /** Lotti utilizzabili del product (stock > 0, non scaduti) in ordine FEFO. */
  const usableLots = (productId: string): ProductLot[] =>
    (lottiMagazzino ?? []).filter(
      (l) =>
        l.product_id === productId &&
        Number(l.quantity_on_hand) > 0 &&
        expiryStatus(l.expires_at) !== "expired",
    );

  /** Riga compilata per intero e coerente: quantità > 0 e ≤ stock, lot non scaduto. */
  const validRow = (row: DischargeRow): boolean => {
    const qty = Number.parseFloat(row.quantity);
    const lot = lotById.get(row.lotId);
    return Boolean(
      row.productId &&
        lot &&
        Number.isFinite(qty) &&
        qty > 0 &&
        qty <= Number(lot.quantity_on_hand) &&
        expiryStatus(lot.expires_at) !== "expired",
    );
  };
  const validIssues: IssueRequest[] = dischargeRows
    .filter(validRow)
    .map((row) => ({
      product_lot_id: row.lotId,
      quantity: Number.parseFloat(row.quantity),
    }));
  // Una row toccata ma non valida blocca il submit (niente issues "a metà").
  const incompleteIssues = dischargeRows.some(
    (row) =>
      (row.productId || row.lotId || row.quantity.trim() !== "") &&
      !validRow(row),
  );

  // Auto-fill (v17): con UNA row di issue non modificata a mano, la quantità
  // segue il totale previsto (dose × area, o totale manuale in kg).
  useEffect(() => {
    if (expectedTotal == null || expectedTotal <= 0) return;
    setDischargeRows((rows) => {
      if (rows.length !== 1) return rows;
      const row = rows[0];
      if (row.manual || !row.productId) return rows;
      const p = categoryProducts.find((x) => x.id === row.productId);
      if (!p || p.unit !== baseDose) return rows;
      const q = String(expectedTotal);
      return row.quantity === q ? rows : [{ ...row, quantity: q }];
    });
  }, [expectedTotal, baseDose, categoryProducts]);

  // Auto-dose e auto-totale DALLO scarico (direzione inversa della
  // riconciliazione): quando l'utente compila a mano la quantità (row.manual,
  // anche su più lots dopo lo split FEFO), il form calcola in background:
  //   * dose/ha = Σ quantità (normalizzata kg o l) / area del field — per TUTTI
  //     i tipi con product (fito, semina E fertilizzazione, che la salva pur
  //     senza mostrare il campo);
  //   * totale kg (fertilizzazione) = Σ quantità × fattore unità (q→100, t→1000).
  // Nessun loop con l'auto-fill v17: quello scrive la quantità solo per le rows
  // NON manuali, questo legge le manuali.
  useEffect(() => {
    if (!f.dose && !f.totalManual) return;
    const valid = dischargeRows.filter((r) => {
      const q = Number.parseFloat(r.quantity);
      return r.productId && Number.isFinite(q) && q > 0;
    });
    if (valid.length === 0 || !valid.some((r) => r.manual)) return;
    // Somma normalizzata: tutte le rows devono essere della stessa famiglia di
    // unità (liquidi in l, solidi in kg/q/t) — altrimenti niente auto-calcolo.
    let total = 0;
    let liquid: boolean | null = null;
    for (const r of valid) {
      const p = categoryProducts.find((x) => x.id === r.productId);
      if (!p) return;
      const isLiquid = p.unit === "l";
      if (liquid == null) liquid = isLiquid;
      else if (liquid !== isLiquid) return;
      total +=
        Number.parseFloat(r.quantity) * (isLiquid ? 1 : UNIT_TO_KG[p.unit] ?? 1);
    }
    if (f.totalManual) {
      const kg = Math.round(total * 100) / 100;
      setManualTotal((current) =>
        current === String(kg) ? current : String(kg),
      );
    }
    if (area != null && area > 0) {
      const dose = Math.round((total / area) * 100) / 100;
      const unit: DoseUnit = liquid ? "l/ha" : "kg/ha";
      setDoseValue((current) =>
        current === String(dose) ? current : String(dose),
      );
      setDoseUnit((current) => (current === unit ? current : unit));
    }
  }, [f.dose, f.totalManual, area, dischargeRows, categoryProducts]);

  // -- automazione semina → crop di campagna (v17) -------------------------
  const activeCampaign = useAgroStore((s) => s.activeCampaign);
  const seedProduct =
    operationType === "sowing"
      ? categoryProducts.find((p) => p.id === dischargeRows[0]?.productId) ?? null
      : null;
  // Il field scelto non ha una campagna APERTA per l'annata: la semina può
  // assegnargli la crop (crops + plots_campaign) automaticamente.
  const plotWithoutCampaign = Boolean(
    plotId &&
      !(campaignFields ?? []).some((c) => c.plotId === plotId),
  );
  const [assignCrop, setAssignCrop] = useState(true);
  const proposeAssignment = Boolean(
    seedProduct && plotId && plotWithoutCampaign,
  );
  const metaSeed = (seedProduct?.metadata ?? {}) as Record<string, unknown>;
  const metaSeedStr = (key: string): string | null => {
    const v = metaSeed[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const speciesName = metaSeedStr("species") ?? seedProduct?.name ?? "";
  const assegnazione: CropAssignment | null =
    proposeAssignment && assignCrop && area != null
      ? {
          plotId: plotId,
          species: speciesName,
          scientificName: metaSeedStr("scientific_name"),
          varietyName: metaSeedStr("variety_name"),
          cropCategory: metaSeedStr("crop_category") ?? "seminativo",
          densitaSemina:
            doseUnit === "kg/ha" && doseValue
              ? Number.parseFloat(doseValue)
              : null,
          declaredAreaHa: area,
        }
      : null;

  const canSubmit = !saving && !missing && !soilWithoutField && !incompleteIssues;

  function selectCampaign(value: string) {
    setFieldCampaignId(value);
    setPlotId(
      campaignFields?.find((c) => c.fieldCampaignId === value)?.plotId ?? "",
    );
  }

  // Selettore unificato per-appezzamento (tipi che ammettono suolo nudo): il
  // valore è il plotId; se quel plot ha una campagna aperta si riaggancia anche
  // il campo di campagna (coltura), altrimenti resta vuoto (operazione su nudo).
  function selectPlotUnified(value: string) {
    setPlotId(value);
    setFieldCampaignId(
      campaignFields?.find((c) => c.plotId === value)?.fieldCampaignId ?? "",
    );
  }

  function selectProduct(codice: string) {
    setProductCode(codice);
    const item = catalog?.find((p) => p.code === codice);
    setProduct(item?.name ?? "");
    if (item?.active_substance) setSostanzaAttiva(item.active_substance);
    if (item?.registration_number) setRegistrationNumber(item.registration_number);
    const npk = item?.metadata?.["npk_ratio"];
    if (typeof npk === "string") setNpkRatio(npk);
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  // -- rows issue warehouse ------------------------------------------------

  function updateIssue(index: number, patch: Partial<DischargeRow>) {
    setDischargeRows((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        if (patch.productId !== undefined && patch.productId !== row.productId) {
          // Cambio product: lot ripreselezionato in FEFO (scadenza valida
          // più vicina); quantità riproposta dal totale previsto se l'utente
          // non l'ha ancora modificata a mano.
          const lot = patch.productId
            ? usableLots(patch.productId)[0] ?? null
            : null;
          const p = categoryProducts.find((x) => x.id === patch.productId);
          const auto =
            !row.manual && expectedTotal != null && p?.unit === baseDose
              ? String(expectedTotal)
              : row.quantity;
          return {
            productId: patch.productId,
            lotId: lot?.id ?? "",
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
    // Prima row: con un product di warehouse selezionato i suoi parametri
    // (name, registrazione, sostanza attiva, tipo/titolo concime, carenza e
    // rientro di default) sono la FONTE DI VERITÀ e sovrascrivono i campi del
    // form — che vengono nascosti (UX snellita): all'agronomo restano solo
    // product/lot/quantità, avversità e i dati dell'operatore. I valori restano
    // comunque salvati e visibili nella scheda dettaglio dell'operazione.
    if (index === 0 && patch.productId) {
      const p = categoryProducts.find((x) => x.id === patch.productId);
      if (p) {
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        setProduct(p.name);
        if (f.registrationNumber) setRegistrationNumber(p.registration_number ?? "");
        if (f.activeSubstance) setSostanzaAttiva(p.active_substance ?? "");
        if (f.fertilizerType) {
          const ft = meta["fertilizer_type"];
          if (typeof ft === "string" && ft.trim()) setFertilizerType(ft);
        }
        if (f.npkRatio) {
          const ratio = npkRatioFromProduct(p);
          if (ratio) setNpkRatio(ratio);
        }
        if (f.safety) {
          const d = meta["safety_period_days"];
          setSafetyPeriod(
            typeof d === "number" || typeof d === "string" ? String(d) : "",
          );
        }
        if (f.reentry) {
          const d = meta["reentry_interval_h"];
          setReentry(
            typeof d === "number" || typeof d === "string" ? String(d) : "",
          );
        }
      }
    }
  }

  function removeIssue(index: number) {
    setDischargeRows((rows) => rows.filter((_, i) => i !== index));
  }

  // -- "Altro" ⇄ magazzino ---------------------------------------------------

  /** Passa all'inserimento manuale: niente issue, campi anagrafica azzerati. */
  function switchToManual() {
    setManualProduct(true);
    setDischargeRows([]);
    setProduct("");
    setProductCode("");
    setRegistrationNumber("");
    setSostanzaAttiva("");
    setNpkRatio("");
    setFertilizerType("minerale");
    setSafetyPeriod("");
    setReentry("");
  }

  /** Torna al percorso magazzino con una row di scarico pronta. */
  function switchToWarehouse() {
    setManualProduct(false);
    setDischargeRows([{ productId: "", lotId: "", quantity: "" }]);
  }

  // Automazione: UN solo product della categoria in magazzino → preselezionato
  // (lot in FEFO via updateIssue); all'agronomo resta solo la quantità. Il ref
  // evita di re-imporre la scelta se l'utente la annulla di proposito.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || manualProduct) return;
    if (categoryProducts.length !== 1) return;
    if (dischargeRows.length !== 1 || dischargeRows[0].productId) return;
    autoSelectedRef.current = true;
    updateIssue(0, { productId: categoryProducts[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryProducts, dischargeRows, manualProduct]);

  /**
   * Divide la quantità della row su più lots in ordine FEFO (v17): la row
   * viene sostituita da una row per lot finché la quantità è coperta.
   * No-op se la stock complessiva del product non basta.
   */
  function splitFefo(index: number) {
    setDischargeRows((rows) => {
      const row = rows[index];
      const qty = Number.parseFloat(row?.quantity ?? "");
      if (!row || !Number.isFinite(qty) || qty <= 0) return rows;
      const nuove: DischargeRow[] = [];
      let resto = qty;
      for (const lot of usableLots(row.productId)) {
        if (resto <= 0) break;
        const presa = Math.min(resto, Number(lot.quantity_on_hand));
        nuove.push({
          productId: row.productId,
          lotId: lot.id,
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
      if (soilMode && plot) {
        const [lon, lat] = centroid(plot.geometry);
        const position: Point = { type: "Point", coordinates: [lon, lat] };
        await onSubmitSoil?.({
          plot_id: plot.id,
          sampled_at: new Date(`${data}T12:00:00`).toISOString(),
          sampling_position: position,
          depth_cm: depth ? Number.parseInt(depth, 10) : null,
          nitrogen: num(nitrogen),
          phosphorus: num(phosphorus),
          potassium: num(potassium),
          organic_matter: num(sostanzaOrganica),
          ph: num(ph),
          texture: texture.trim() || null,
          metadata: note.trim() ? { note: note.trim() } : {},
        });
        return;
      }

      await onSubmit({
        operation_type: operationType,
        plot_id: plotId || null,
        plot_campaign_id: fieldCampaignId || null,
        product_name: f.product
          ? product || null
          : f.tillageType
            ? tillageType.trim() || null
            : null,
        registration_number: f.registrationNumber ? registrationNumber || null : null,
        active_substance: f.activeSubstance ? sostanzaAttiva || null : null,
        target_disease: f.targetDisease ? target || null : null,
        // La dose si salva anche per la fertilizzazione (f.totalManual): è
        // calcolata in background dallo scarico e compare nella scheda.
        dose_value:
          (f.dose || f.totalManual) && doseValue
            ? Number.parseFloat(doseValue)
            : null,
        dose_unit: (f.dose || f.totalManual) && doseValue ? doseUnit : null,
        total_quantity: automaticTotal ?? (f.totalManual ? manualTotalNum : null),
        // water_volume_l = volume in litri: la botte (fitosanitari) o l'apporto
        // irriguo convertito da mm/hl (irrigazione). È la forma che il bilancio
        // idrico riconverte in lama d'acqua (mm) sulla area del field.
        water_volume_l: f.waterVolume
          ? waterVolume
            ? Number.parseInt(waterVolume, 10)
            : null
          : f.irrigationAmount
            ? irrLitres
            : null,
        fertilizer_type: f.fertilizerType ? fertilizerType : null,
        npk_ratio: f.npkRatio ? npkRatio || null : null,
        operator_name: operator.trim() || null,
        operator_tax_code: f.operatorTaxCode ? operatorTaxCode.trim().toUpperCase() || null : null,
        license_number: f.licenseNumber ? licenseNumber || null : null,
        machinery_equipment: f.machinery ? machinery.trim() || null : null,
        reentry_interval_h: f.reentry && reentry ? Number.parseInt(reentry, 10) : null,
        safety_period_days: f.safety && safetyPeriod ? Number.parseInt(safetyPeriod, 10) : null,
        executed_at: new Date(`${data}T12:00:00`).toISOString(),
        weather_conditions: null,
        note: note.trim() || null,
      }, validIssues, assegnazione);
      // Memoria operatore (v17): l'ultimo operatore usato precompila i form.
      if (operator.trim() || operatorTaxCode.trim() || licenseNumber.trim()) {
        persistOperatorMemory({
          name: operator.trim() || undefined,
          taxCode: operatorTaxCode.trim() || undefined,
          license: licenseNumber.trim() || undefined,
        });
      }
    } catch (e) {
      // Scarico atomico fallito (stock insufficiente, lot scaduto…): la
      // transazione è stata annullata per intero; il form resta aperto con il
      // messaggio, l'utente corregge e riprova.
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const productLabel =
    f.product === "phyto"
      ? t("operationForm.productPhyto")
      : f.product === "fertilizer"
        ? t("operationForm.productFertilizer")
        : t("operationForm.productSeed");

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

      {/* Data + plot/campagna (comuni a tutti i tipi) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-data">{t("operationForm.date")}</Label>
          <Input id="op-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-app">
            {usePlotSelector ? t("logbook.common.plot") : t("logbook.common.fieldCampaign")}
          </Label>
          {usePlotSelector ? (
            // Tutti gli appezzamenti (anche senza coltura): i campi con campagna
            // aperta portano il codice coltura come promemoria; la selezione
            // riaggancia il legame alla coltura quando esiste.
            <Select id="op-app" value={plotId} onChange={(e) => selectPlotUnified(e.target.value)}>
              <option value="">
                {soilMode ? t("logbook.common.select") : t("logbook.common.wholeFarm")}
              </option>
              {plots.map((a) => {
                const camp = campaignFields?.find((c) => c.plotId === a.id);
                return (
                  <option key={a.id} value={a.id}>
                    {a.user_plot_name}
                    {a.area_ha != null ? ` · ${a.area_ha.toFixed(2)} ha` : ""}
                    {camp?.codiceColturaSian ? ` · ${camp.codiceColturaSian}` : ""}
                  </option>
                );
              })}
            </Select>
          ) : (
            <Select id="op-app" value={fieldCampaignId} onChange={(e) => selectCampaign(e.target.value)}>
              <option value="">
                {soilMode ? t("logbook.common.select") : t("logbook.common.wholeFarm")}
              </option>
              {campaignFields?.map((c) => (
                <option key={c.fieldCampaignId} value={c.fieldCampaignId}>
                  {c.name}
                  {c.codiceColturaSian ? ` · ${c.codiceColturaSian}` : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {/* Campionamento: scelta della matrice */}
      {isSampling && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-matrix">{t("operationForm.sampledMatrix")}</Label>
          <Select
            id="op-matrix"
            value={matrix}
            onChange={(e) => setMatrix(e.target.value as "suolo" | "altro")}
          >
            <option value="suolo">{t("operationForm.soilAnalysisOption")}</option>
            <option value="altro">{t("operationForm.otherSampleOption")}</option>
          </Select>
        </div>
      )}

      {soilWithoutField && (
        <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          {t("operationForm.selectPlotForSoilSample")}
        </p>
      )}

      {/* Campi analisi soil → soil_samples */}
      {soilMode && (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("operationForm.soilAnalysis")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-prof">{t("operationForm.depthCm")}</Label>
              <Input id="soil-prof" type="number" inputMode="numeric" min="0" value={depth} onChange={(e) => setDepth(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-ph">{t("detailEditSheet.ph")}</Label>
              <Input id="soil-ph" type="number" inputMode="decimal" step="any" value={ph} onChange={(e) => setPh(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-so">{t("operationForm.organicMatterPercent")}</Label>
              <Input id="soil-so" type="number" inputMode="decimal" step="any" value={sostanzaOrganica} onChange={(e) => setSostanzaOrganica(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-n">{t("operationForm.nitrogenN")}</Label>
              <Input id="soil-n" type="number" inputMode="decimal" step="any" value={nitrogen} onChange={(e) => setNitrogen(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-p">{t("operationForm.phosphorusP")}</Label>
              <Input id="soil-p" type="number" inputMode="decimal" step="any" value={phosphorus} onChange={(e) => setPhosphorus(e.target.value)} className="agro-num" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="soil-k">{t("operationForm.potassiumK")}</Label>
              <Input id="soil-k" type="number" inputMode="decimal" step="any" value={potassium} onChange={(e) => setPotassium(e.target.value)} className="agro-num" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="soil-tex">{t("operationForm.texture")}</Label>
            <Input id="soil-tex" value={texture} onChange={(e) => setTexture(e.target.value)} placeholder={t("operationForm.texturePlaceholder")} />
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
              {t("operationForm.nitrogenMax")}{" "}
              <strong className="agro-num">{compliance.azotoMaxTotaleKg} kg</strong>
            </span>
          )}
        </div>
      )}

      {/* Tipo lavorazione (→ product_name) */}
      {f.tillageType && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-lav">{t("operationForm.tillageTypeLabel")}</Label>
          <Input id="op-lav" value={tillageType} onChange={(e) => setTillageType(e.target.value)} placeholder={t("operationForm.tillageTypePlaceholder")} />
        </div>
      )}

      {/* Product (fito/concime/seme) — solo in modalità "Altro"/senza
          magazzino: nel percorso magazzino il name arriva dal product scelto. */}
      {f.product && manualMode && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-prod">{productLabel}</Label>
          {usaCatalogo ? (
            <Select id="op-prod" value={productCode} onChange={(e) => selectProduct(e.target.value)}>
              <option value="">{t("operationForm.selectFromNationalRegister")}</option>
              {catalog?.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                  {p.registration_number ? ` · ${p.registration_number}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="op-prod" value={product} onChange={(e) => setProduct(e.target.value)} />
          )}
        </div>
      )}

      {/* Scarico da warehouse (0.2.0): product → lot → quantità. Lotti
          scaduti visibili ma NON selezionabili (uso bloccato §5.1). È il
          percorso DEFAULT quando la categoria ha products in magazzino; il
          link "Altro" in coda passa all'inserimento manuale. */}
      {usesWarehouse && !manualProduct && !isSampling && (
        <section className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
            {t("operationForm.warehouseSection")}
          </p>
          {dischargeRows.length === 0 && (
            <p className="text-[11px] text-[var(--ink-3)]">
              {t("operationForm.warehouseFreeText")}
            </p>
          )}
          {dischargeRows.map((row, index) => {
            const selectedProduct = categoryProducts.find(
              (p) => p.id === row.productId,
            );
            const productLots = (lottiMagazzino ?? []).filter(
              (l) => l.product_id === row.productId,
            );
            const selectedLot = lotById.get(row.lotId) ?? null;
            const available = selectedLot ? Number(selectedLot.quantity_on_hand) : null;
            return (
              <div
                key={`scarico-${index}`}
                className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`op-mag-prod-${index}`}>
                      {t("operationForm.warehouseProduct")}
                    </Label>
                    <Select
                      id={`op-mag-prod-${index}`}
                      value={row.productId}
                      onChange={(e) =>
                        updateIssue(index, { productId: e.target.value })
                      }
                    >
                      <option value="">{t("operationForm.selectEllipsis")}</option>
                      {categoryProducts.map((p) => {
                        // Product in unità non riconciliabile con la dose
                        // (kg vs l): non selezionabile finché c'è un totale
                        // previsto da far quadrare.
                        const incompatibile = !compatibleUnit(p.unit);
                        return (
                          <option key={p.id} value={p.id} disabled={incompatibile}>
                            {p.name} · {p.unit}
                            {incompatibile
                              ? ` · ${t("operationForm.warehouseIncompatibleUnit", { unit: baseDose })}`
                              : ""}
                          </option>
                        );
                      })}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`op-mag-lot-${index}`}>
                      {t("operationForm.warehouseLot")}
                    </Label>
                    <Select
                      id={`op-mag-lot-${index}`}
                      value={row.lotId}
                      onChange={(e) =>
                        updateIssue(index, { lotId: e.target.value })
                      }
                      disabled={!row.productId}
                    >
                      <option value="">{t("operationForm.selectEllipsis")}</option>
                      {productLots.map((l) => {
                        const status = expiryStatus(l.expires_at);
                        const scaduto = status === "expired";
                        // Solo il lot nell'opzione: scadenza (Timestamp) e
                        // disponibilità NON vanno accodate qui — restano nella
                        // riga informativa sotto la select una volta scelto il
                        // lot. Si mantiene solo la parola di stato (scaduto/in
                        // scadenza), utile a orientare la scelta FEFO.
                        return (
                          <option key={l.id} value={l.id} disabled={scaduto}>
                            {l.lot_number ?? l.id.slice(0, 8)}
                            {scaduto
                              ? ` · ${t("operationForm.warehouseExpiredOption")}`
                              : status === "expiring"
                                ? ` · ${t("operationForm.warehouseExpiringOption")}`
                                : ""}
                          </option>
                        );
                      })}
                    </Select>
                    {row.productId && productLots.length === 0 && (
                      <p className="text-[11px] text-[var(--warn)]">
                        {t("operationForm.warehouseNoLots")}
                      </p>
                    )}
                  </div>
                </div>
                {/* Riga quantità: input compatto, info del lot a fianco e
                    rimozione a icona — niente label lunghe che vanno a capo. */}
                <div className="flex items-end gap-2">
                  <div className="flex w-32 shrink-0 flex-col gap-1.5">
                    <Label htmlFor={`op-mag-qta-${index}`}>
                      {t("operationForm.warehouseQuantity", {
                        unit: selectedProduct?.unit ?? "—",
                      })}
                    </Label>
                    <Input
                      id={`op-mag-qta-${index}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      max={available ?? undefined}
                      value={row.quantity}
                      onChange={(e) =>
                        updateIssue(index, { quantity: e.target.value })
                      }
                      className="agro-num"
                    />
                  </div>
                  {/* Info del lot scelto: disponibilità + scadenza. */}
                  {selectedLot && (
                    <p className="min-w-0 flex-1 pb-2 text-[11px] leading-snug text-[var(--ink-3)]">
                      {available != null
                        ? t("operationForm.warehouseAvailable", {
                            qty: available,
                            unit: selectedProduct?.unit ?? "",
                          })
                        : ""}
                      {selectedLot.expires_at
                        ? `${available != null ? " · " : ""}${t(
                            "operationForm.warehouseExpiresAt",
                            {
                              date: new Date(
                                selectedLot.expires_at,
                              ).toLocaleDateString("it-IT"),
                            },
                          )}`
                        : ""}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => removeIssue(index)}
                    title={t("operationForm.warehouseRemoveRow")}
                    aria-label={t("operationForm.warehouseRemoveRow")}
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-2)] border border-[var(--line)] text-[var(--ink-3)] hover:bg-[var(--danger-l,#fee2e2)] hover:text-[var(--danger)]"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Riconciliazione dose ⇄ issue: dose effettiva, scostamento
                    dal totale previsto e split FEFO quando il lot non basta. */}
                {(() => {
                  const qty = Number.parseFloat(row.quantity);
                  if (!Number.isFinite(qty) || qty <= 0) return null;
                  const unit = selectedProduct?.unit ?? "";
                  // Dose normalizzata (kg o l per ettaro): i solidi in q/t sono
                  // convertiti in kg, coerente con la dose salvata sul record.
                  const isLiquid = unit === "l";
                  const normQty = qty * (isLiquid ? 1 : UNIT_TO_KG[unit] ?? 1);
                  const effectiveDose =
                    area && area > 0 ? normQty / area : null;
                  const effectiveDoseUnit = isLiquid ? "l/ha" : "kg/ha";
                  const scostamento =
                    expectedTotal != null &&
                    expectedTotal > 0 &&
                    selectedProduct?.unit === baseDose &&
                    Math.abs(qty - expectedTotal) / expectedTotal > 0.05;
                  const exceedsLot =
                    available != null && qty > available;
                  const copribile =
                    exceedsLot &&
                    usableLots(row.productId).reduce(
                      (s, l) => s + Number(l.quantity_on_hand),
                      0,
                    ) >= qty;
                  if (!effectiveDose && !scostamento && !exceedsLot) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {/* Dose /ha calcolata: feedback visivo anche per la
                          fertilizzazione (campo dose non mostrato nel form). */}
                      {effectiveDose != null && (f.dose || f.totalManual) && (
                        <span className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[var(--ink-3)]">
                          {t("operationForm.warehouseEffectiveDose", {
                            dose: (Math.round(effectiveDose * 100) / 100).toLocaleString("it-IT"),
                            unit: effectiveDoseUnit,
                          })}
                        </span>
                      )}
                      {scostamento && (
                        <span className="rounded-full bg-[var(--warn-l)] px-2 py-0.5 font-medium text-[var(--warn)]">
                          {t("operationForm.warehouseMismatch", {
                            total: expectedTotal,
                            unit,
                          })}
                        </span>
                      )}
                      {copribile && (
                        <button
                          type="button"
                          onClick={() => splitFefo(index)}
                          className="rounded-full border border-[var(--accent-bd)] bg-[var(--accent-l)] px-2 py-0.5 font-medium text-[var(--accent)]"
                        >
                          {t("operationForm.warehouseSplitFefo")}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                setDischargeRows((rows) => [
                  ...rows,
                  { productId: "", lotId: "", quantity: "" },
                ])
              }
              className="text-xs font-medium text-[var(--accent)]"
            >
              {t("operationForm.warehouseAddRow")}
            </button>
            {/* "Altro": materiale non censito in magazzino → form manuale. */}
            <button
              type="button"
              onClick={switchToManual}
              className="text-xs text-[var(--ink-3)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
            >
              {t("operationForm.otherProductToggle")}
            </button>
          </div>
        </section>
      )}

      {/* Rientro dal percorso manuale al magazzino. */}
      {usesWarehouse && manualProduct && !isSampling && (
        <button
          type="button"
          onClick={switchToWarehouse}
          className="self-start text-xs font-medium text-[var(--accent)]"
        >
          {t("operationForm.useWarehouseToggle")}
        </button>
      )}

      {/* Automazione v17: la semina di una semente su un field senza crop
          propone di creare scheda crop + campagna agraria in automatico. */}
      {proposeAssignment && (
        <label className="flex items-start gap-2 rounded-[var(--r-2)] border border-[var(--accent-bd)] bg-[var(--accent-l)] px-3 py-2">
          <input
            type="checkbox"
            checked={assignCrop}
            onChange={(e) => setAssignCrop(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--accent)]">
              {t("operationForm.assignCropLabel", {
                crop:
                  speciesName +
                  (metaSeedStr("variety_name")
                    ? ` (${metaSeedStr("variety_name")})`
                    : ""),
                plot: plot?.user_plot_name ?? "",
                year: activeCampaign,
              })}
            </span>
            <span className="block text-[11px] text-[var(--ink-3)]">
              {t("operationForm.assignCropHint")}
            </span>
          </span>
        </label>
      )}

      {/* Tipo concime: solo in modalità manuale (dal magazzino arriva dal
          product). Titolo NPK: anche in modalità magazzino se il product non
          lo fornisce (obbligo PAN, mai nascosto se mancante). */}
      {f.fertilizerType && (manualMode || showIfMissing(npkRatio)) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {manualMode && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-tipoconcime">{t("logbook.fertilization.type")}</Label>
              <Select id="op-tipoconcime" value={fertilizerType} onChange={(e) => setFertilizerType(e.target.value)}>
                <option value="minerale">{t("logbook.fertilization.mineral")}</option>
                <option value="organico">{t("logbook.fertilization.organic")}</option>
                <option value="organo-minerale">{t("operationForm.organoMineral")}</option>
              </Select>
            </div>
          )}
          {f.npkRatio && showIfMissing(npkRatio) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-npk">{t("logbook.fertilization.npk")}</Label>
              <Input id="op-npk" value={npkRatio} onChange={(e) => setNpkRatio(e.target.value)} placeholder={t("logbook.fertilization.npkPlaceholder")} className="agro-num" />
            </div>
          )}
        </div>
      )}

      {/* Registrazione e sostanza attiva: modalità manuale, oppure — nel
          percorso magazzino — solo quando il product scelto non le fornisce
          (obbligo PAN mancante, va completato a mano). */}
      {((f.registrationNumber && showIfMissing(registrationNumber)) ||
        (f.activeSubstance && showIfMissing(sostanzaAttiva))) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f.registrationNumber && showIfMissing(registrationNumber) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-reg">{t("logbook.treatment.regNumber")}</Label>
              <Input id="op-reg" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className="agro-num" />
            </div>
          )}
          {f.activeSubstance && showIfMissing(sostanzaAttiva) && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-sa">{t("logbook.treatment.activeSubstance")}</Label>
              <Input id="op-sa" value={sostanzaAttiva} onChange={(e) => setSostanzaAttiva(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {f.targetDisease && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-target">{t("operationForm.targetPest")}</Label>
          <Select id="op-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("operationForm.selectEllipsis")}</option>
            {PAN_PESTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Dose + unità: nel percorso magazzino sono calcolate dallo scarico e
          NON modificabili (campo nascosto; il valore appare nel riepilogo e
          nella scheda operazione). Visibili — e editabili — solo con "Altro" o
          quando la dose non è derivabile (area ignota, obbligo PAN). L'acqua
          della botte resta: dato per-intervento non ricavabile dal magazzino. */}
      {((f.dose && showDose) || f.waterVolume) && (
        <div className="grid grid-cols-3 gap-3">
          {f.dose && showDose && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="op-dose">{t("logbook.treatment.dose")}</Label>
                <Input id="op-dose" type="number" inputMode="decimal" min="0" step="any" value={doseValue} onChange={(e) => setDoseValue(e.target.value)} className="agro-num" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="op-unita">{t("logbook.treatment.unit")}</Label>
                <Select id="op-unita" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}>
                  {UNITS.map((u) => (
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
              <Input id="op-acqua" type="number" inputMode="numeric" min="0" step="1" value={waterVolume} onChange={(e) => setWaterVolume(e.target.value)} className="agro-num" />
            </div>
          )}
        </div>
      )}

      {/* Irrigazione: apporto in mm (lama d'acqua) o hl (volume), per preferenza. */}
      {f.irrigationAmount && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="op-irr">{t("operationForm.irrigationAmount", { unit: waterUnitLabel(irrUnit) })}</Label>
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
                <option value="mm">{t("operationForm.mmSheet")}</option>
                <option value="hl">{t("operationForm.hlVolume")}</option>
              </Select>
            </div>
          </div>
          {irrLitres != null && (
            <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--ink-3)]">
              ≈{" "}
              <strong className="agro-num">
                {(irrLitres / 1000).toFixed(1)} m³
              </strong>
              {area != null && area > 0 && (
                <>
                  {" · "}
                  <strong className="agro-num">
                    {litresToIrrigation(
                      irrLitres,
                      irrUnit === "mm" ? "hl" : "mm",
                      area,
                    ).toFixed(1)}{" "}
                    {irrUnit === "mm" ? "hl" : "mm"}
                  </strong>{" "}
                  {t("operationForm.onSurface", { area: area.toFixed(2) })}
                </>
              )}
            </p>
          )}
          {area == null && irrUnit === "mm" && (
            <p className="rounded-[var(--r-2)] bg-[var(--warn-l)] px-3 py-1.5 text-xs text-[var(--warn)]">
              {t("operationForm.selectPlotForMmConversion")}
            </p>
          )}
        </div>
      )}

      {automaticTotal != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
          {t("logbook.treatment.computedTotal")}{" "}
          <strong className="agro-num text-[var(--ink)]">
            {automaticTotal} {doseUnit.split("/")[0]}
          </strong>{" "}
          ({doseValue} {doseUnit} × {area?.toFixed(2)} ha)
        </p>
      )}

      {/* Totale (kg): nel percorso magazzino è calcolato dallo scarico
          (quantità × fattore unità, in background) — campo visibile solo con
          "Altro", dove va digitato a mano. */}
      {f.totalManual && manualMode && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-tot">{t("operationForm.totalQuantityKg")}</Label>
          <Input id="op-tot" type="number" inputMode="decimal" min="0" step="any" value={manualTotal} onChange={(e) => setManualTotal(e.target.value)} className="agro-num" />
        </div>
      )}

      {exceedsNitrogen && compliance?.azotoMaxTotaleKg != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {t("logbook.treatment.nitrogenExceeded", { max: compliance.azotoMaxTotaleKg })}
        </p>
      )}

      {/* Operatore + (CF/patentino/mezzo solo dove richiesti) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="op-operator">{t("operationForm.operator")}</Label>
          <Input id="op-operator" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder={t("operationForm.operatorPlaceholder")} />
        </div>
        {f.operatorTaxCode && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-cf">{t("logbook.treatment.operatorTaxCode")}</Label>
            <Input id="op-cf" value={operatorTaxCode} onChange={(e) => setOperatorTaxCode(e.target.value)} className="agro-num uppercase" maxLength={16} />
          </div>
        )}
        {f.licenseNumber && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-pat">{t("logbook.treatment.license")}</Label>
            <Input id="op-pat" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className="agro-num" />
          </div>
        )}
        {f.machinery && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="op-machinery">{t("operationForm.machinery")}</Label>
            <Input id="op-machinery" value={machinery} onChange={(e) => setMachinery(e.target.value)} placeholder={t("operationForm.machineryPlaceholder")} />
          </div>
        )}
      </div>

      {/* Carenza/rientro: solo in modalità manuale (dal magazzino arrivano dai
          default del product; restano salvati e visibili nella scheda). */}
      {(f.reentry || f.safety) && manualMode && (
        <div className="grid grid-cols-2 gap-3">
          {f.reentry && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-rientro">{t("operationForm.reentryHours")}</Label>
              <Input id="op-rientro" type="number" inputMode="numeric" min="0" value={reentry} onChange={(e) => setReentry(e.target.value)} className="agro-num" />
            </div>
          )}
          {f.safety && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op-safetyPeriod">{t("operationForm.safetyDays")}</Label>
              <Input id="op-safetyPeriod" type="number" inputMode="numeric" min="0" value={safetyPeriod} onChange={(e) => setSafetyPeriod(e.target.value)} className="agro-num" />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="op-note">{t("operationForm.notes")}</Label>
        <textarea
          id="op-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
      </div>

      {missing && (
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
          {t("operationForm.warehouseSubmitError", { message: submitError })}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={!canSubmit} className={cn("min-h-[var(--touch-min)] flex-1")}>
          {saving ? t("logbook.common.saving") : t("operationForm.submit")}
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
