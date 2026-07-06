import {
  type Appezzamento,
  type CampionamentoSuolo,
  type CatalogoVoce,
  categoriaPerOperazione,
  centroide,
  type DoseUnita,
  irrigationToLitres,
  litresToIrrigation,
  type LottoProdotto,
  type Prodotto,
  type ScaricoRichiesta,
  statoScadenza,
  type TipoOperazione,
  type ValidationError,
  validateFertilizationLog,
  validateTreatmentLog,
  type WaterUnit,
  waterUnitLabel,
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
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

/**
 * Form UNICO e ADATTIVO del Quaderno di Campagna: a partire dal tipo operazione
 * scelto, mostra SOLO i campi pertinenti (es. la lavorazione non chiede il
 * patentino; il rilievo solo data/operatore/note). I tipi "di registro" scrivono
 * nella stessa tabella `treatment_logs` (colonne nullable): nessuna modifica di
 * schema. Il campionamento di SUOLO è un caso speciale: scrive sulla tabella
 * dedicata `soil_samples` (via `onSubmitSoil`), con posizione = centroide del
 * campo.
 */

const UNITA: DoseUnita[] = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"];

type ProductMode = "phyto" | "fertilizer" | "seed";

interface OpFieldSpec {
  product?: ProductMode;
  registrationNumber?: boolean;
  activeSubstance?: boolean;
  targetDisease?: boolean;
  dose?: boolean;
  /** Volume d'acqua della botte/atomizzatore (litri) — trattamenti fitosanitari. */
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
  type: TipoOperazione;
  label: string;
  descr: string;
  fields: OpFieldSpec;
}

/**
 * Registro dei tipi operazione e dei campi pertinenti a ciascuno. `label` e
 * `descr` sono getter che risolvono la traduzione al momento della lettura
 * (tramite l'istanza `i18n` condivisa, non un hook React): così i consumer
 * esterni che leggono `OPERAZIONI` come semplice array di dati (es.
 * `QuadernoPanel`) vedono comunque il testo nella lingua attiva a ogni
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

export function operazioneSpec(type: TipoOperazione): OperazioneSpec {
  return OPERAZIONI.find((o) => o.type === type) ?? OPERAZIONI[0];
}

/** Input del campionamento suolo emesso dal form (verso `soil_samples`). */
export type CampionamentoSuoloInput = Omit<
  CampionamentoSuolo,
  "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
>;

/** Riga di scarico magazzino in compilazione nel form. */
interface ScaricoRow {
  productId: string;
  lotId: string;
  quantity: string;
}

export interface OperazioneFormProps {
  operationType: TipoOperazione;
  appezzamenti: Appezzamento[];
  campiCampagna?: CampoCampagnaOption[];
  prodottiCatalogo?: CatalogoVoce[];
  concimiCatalogo?: CatalogoVoce[];
  /**
   * Anagrafica e lotti del Magazzino (0.2.0). Se ci sono prodotti della
   * categoria pertinente al tipo operazione, il form mostra la sezione
   * "Scarico da magazzino": prodotto → lotto → quantità. I lotti SCADUTI sono
   * mostrati ma NON selezionabili (uso bloccato, §5.1).
   */
  prodottiMagazzino?: Prodotto[];
  lottiMagazzino?: LottoProdotto[];
  valutaCompliance?: (appezzamento: Appezzamento) => ComplianceTrattamento | null;
  defaultAppezzamentoId?: string | null;
  /**
   * Salvataggio dell'operazione; `scarichi` non vuoto attiva lo scarico
   * ATOMICO dei lotti (§5.2): un errore (giacenza/lotto scaduto) annulla tutto
   * e risale qui, dove il form lo mostra senza chiudersi.
   */
  onSubmit: (
    values: TrattamentoFormValues,
    scarichi?: ScaricoRichiesta[],
  ) => Promise<void> | void;
  /** Salvataggio del campionamento di suolo (tabella dedicata). */
  onSubmitSoil?: (input: CampionamentoSuoloInput) => Promise<void> | void;
  onCancel?: () => void;
}

export function OperazioneForm({
  operationType,
  appezzamenti,
  campiCampagna,
  prodottiCatalogo,
  concimiCatalogo,
  prodottiMagazzino,
  lottiMagazzino,
  valutaCompliance,
  defaultAppezzamentoId,
  onSubmit,
  onSubmitSoil,
  onCancel,
}: OperazioneFormProps) {
  const { t } = useTranslation();
  const spec = operazioneSpec(operationType);
  const f = spec.fields;
  const usaCampagna = (campiCampagna?.length ?? 0) > 0;
  const catalogo =
    f.product === "phyto"
      ? prodottiCatalogo
      : f.product === "fertilizer"
        ? concimiCatalogo
        : undefined;
  const usaCatalogo = (catalogo?.length ?? 0) > 0;

  const [appezzamentoId, setAppezzamentoId] = useState(defaultAppezzamentoId ?? "");
  const [campoCampagnaId, setCampoCampagnaId] = useState(() => {
    if (!usaCampagna || !defaultAppezzamentoId) return "";
    return (
      campiCampagna?.find((c) => c.appezzamentoId === defaultAppezzamentoId)
        ?.campoCampagnaId ?? ""
    );
  });
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [prodotto, setProdotto] = useState("");
  const [prodottoCodice, setProdottoCodice] = useState("");
  const [numeroRegistrazione, setNumeroRegistrazione] = useState("");
  const [sostanzaAttiva, setSostanzaAttiva] = useState("");
  const [target, setTarget] = useState("");
  const [doseValore, setDoseValore] = useState("");
  const [doseUnita, setDoseUnita] = useState<DoseUnita>("kg/ha");
  const [acquaVolume, setAcquaVolume] = useState("");
  // Irrigazione: quantità + unità (mm/hl). L'unità di default segue la preferenza
  // utente; è sovrascrivibile per singolo intervento.
  const waterPref = useSettingsStore((s) => s.units.water);
  const [irrAmount, setIrrAmount] = useState("");
  const [irrUnit, setIrrUnit] = useState<WaterUnit>(waterPref);
  const [totaleManuale, setTotaleManuale] = useState("");
  const [tipoConcime, setTipoConcime] = useState("minerale");
  const [titoloNpk, setTitoloNpk] = useState("");
  const [tipoLavorazione, setTipoLavorazione] = useState("");
  const [operatore, setOperatore] = useState("");
  const [operatoreCf, setOperatoreCf] = useState("");
  const [numPatentino, setNumPatentino] = useState("");
  const [mezzo, setMezzo] = useState("");
  const [rientro, setRientro] = useState("");
  const [carenza, setCarenza] = useState("");
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
    () => appezzamenti.find((a) => a.id === appezzamentoId) ?? null,
    [appezzamenti, appezzamentoId],
  );
  const campoSel = useMemo(
    () => campiCampagna?.find((c) => c.campoCampagnaId === campoCampagnaId) ?? null,
    [campiCampagna, campoCampagnaId],
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
  // Per il campione di suolo serve un campo georeferenziato (centroide = posizione).
  const soilSenzaCampo = soilMode && !appezzamento;

  // -- Magazzino (0.2.0): categoria pertinente e validazione righe scarico ----
  const categoriaMagazzino = categoriaPerOperazione(operationType);
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
    const map = new Map<string, LottoProdotto>();
    for (const l of lottiMagazzino ?? []) map.set(l.id, l);
    return map;
  }, [lottiMagazzino]);

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
        statoScadenza(lotto.expires_at) !== "expired",
    );
  };
  const scarichiValidi: ScaricoRichiesta[] = scarichiRows
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

  const canSubmit = !saving && !mancano && !soilSenzaCampo && !scarichiIncompleti;

  function selezionaCampagna(value: string) {
    setCampoCampagnaId(value);
    setAppezzamentoId(
      campiCampagna?.find((c) => c.campoCampagnaId === value)?.appezzamentoId ?? "",
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
        // Cambiare prodotto azzera il lotto (i lotti sono per-prodotto).
        return patch.productId !== undefined && patch.productId !== row.productId
          ? { productId: patch.productId, lotId: "", quantity: row.quantity }
          : { ...row, ...patch };
      }),
    );
    // Prima riga: auto-compila il nome prodotto (fallback testuale del registro)
    // se il campo è ancora vuoto, così il Quaderno resta leggibile anche senza
    // consultare il magazzino.
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
      }
    }
  }

  function rimuoviScarico(index: number) {
    setScarichiRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSaving(true);
    try {
      if (soilMode && appezzamento) {
        const [lon, lat] = centroide(appezzamento.geometry);
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
        plot_id: appezzamentoId || null,
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
      }, scarichiValidi);
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
              {campiCampagna?.map((c) => (
                <option key={c.campoCampagnaId} value={c.campoCampagnaId}>
                  {c.nome}
                  {c.codiceColturaSian ? ` · ${c.codiceColturaSian}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Select id="op-app" value={appezzamentoId} onChange={(e) => setAppezzamentoId(e.target.value)}>
              <option value="">
                {soilMode ? t("logbook.common.select") : t("logbook.common.wholeFarm")}
              </option>
              {appezzamenti.map((a) => (
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

      {/* Prodotto (fito/concime/seme) */}
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
                      {prodottiCategoria.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
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
                        const stato = statoScadenza(l.expires_at);
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
                <Select id="op-unita" value={doseUnita} onChange={(e) => setDoseUnita(e.target.value as DoseUnita)}>
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
