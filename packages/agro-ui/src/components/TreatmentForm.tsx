import {
  type Plot,
  type CatalogEntry,
  type DoseUnit,
  type TreatmentLog,
  type OperationType,
  type ValidationError,
  validateTreatmentLog,
} from "@agrogea/core";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Mappa field PAN → chiave i18n dell'etichetta (per i messaggi d'errore). */
const TREATMENT_FIELD_KEY: Record<string, string> = {
  operation_date: "logbook.treatment.date",
  target_disease: "logbook.treatment.target",
  product_name: "logbook.treatment.product",
  registration_number: "logbook.treatment.regNumber",
  active_substance: "logbook.treatment.activeSubstance",
  applied_dose: "logbook.treatment.dose",
  unit_of_measure: "logbook.treatment.unit",
  operator_license_number: "logbook.treatment.license",
};

/**
 * Form di registrazione del Quaderno di Campagna (Design.md → QDCForm), allineato
 * agli obblighi PAN/SIAN per i treatments fitosanitari:
 *   * selettore del field per Campagna Agraria (name utente + codice crop SIAN);
 *   * data treatment, avversità (dropdown rigorosa), product commerciale,
 *     n. registrazione ministeriale, sostanza attiva, dose+unità, volume acqua,
 *     CF operatore e number di patentino.
 * Tutti i target touch sono ≥ 44px.
 */

const TIPI = [
  "phytosanitary",
  "fertilization",
  "irrigation",
  "tillage",
  "sampling",
] as const satisfies readonly OperationType[];

const UNITS: DoseUnit[] = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"];

/** Avversità target PAN (dropdown rigorosa: niente testo libero). */
export const PAN_PESTS = [
  "Peronospora",
  "Oidio",
  "Botrite",
  "Ticchiolatura",
  "Bolla",
  "Monilia",
  "Mosca",
  "Tignola",
  "Cocciniglia",
  "Afidi",
  "Ragnetto rosso",
  "Diserbo",
  "Altro",
] as const;

export type TreatmentFormValues = Omit<
  TreatmentLog,
  "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
>;

/** Opzione di field per la Campagna Agraria selezionata (name + codice SIAN). */
export interface FieldCampaignOption {
  fieldCampaignId: string;
  plotId: string;
  name: string;
  codiceColturaSian: string | null;
  superficieHa: number | null;
}

/** Esito della geo-compliance per l'appezzamento selezionato, iniettato dall'app. */
export interface ComplianceTreatment {
  /** Note leggibili dei vincoli (ZVN, SIC/ZPS). */
  note: string[];
  /** Massimale assoluto di azoto (kg) per l'appezzamento; null = nessun vincolo. */
  azotoMaxTotaleKg: number | null;
}

export interface TreatmentFormProps {
  plots: Plot[];
  onSubmit: (values: TreatmentFormValues) => Promise<void> | void;
  onCancel?: () => void;
  /** Plot pre-selezionato (es. apertura dal popup del field). */
  defaultAppezzamentoId?: string | null;
  /**
   * Campi validi per la Campagna Agraria attiva. Se forniti, il selettore mostra
   * questi (name + codice crop SIAN) e l'operazione aggancia `plot_campaign_id`.
   */
  campaignFields?: FieldCampaignOption[];
  /**
   * Valuta i vincoli geografici dell'appezzamento (iniettata dall'app, che
   * legge i layer ZVN/SIC-ZPS). Tiene @agrogea/ui disaccoppiato dal motore.
   */
  valutaCompliance?: (plot: Plot) => ComplianceTreatment | null;
  /**
   * Catalogo fitosanitari filtrato per `country_code` (iniettato dall'app via
   * `useCountryCatalog`). Se fornito, il field "Product" diventa un dropdown del
   * registro nazionale che auto-compila sostanza attiva e n. registrazione.
   */
  prodottiCatalogo?: CatalogEntry[];
}

export function TreatmentForm({
  plots,
  onSubmit,
  onCancel,
  defaultAppezzamentoId,
  campaignFields,
  valutaCompliance,
  prodottiCatalogo,
}: TreatmentFormProps) {
  const { t } = useTranslation();
  // t() per chiavi DINAMICHE (etichette field + messaggi del validatore PAN):
  // bypassa il tipaggio stretto delle chiavi statiche di i18next.
  const td = t as unknown as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;
  const usesCampaign = (campaignFields?.length ?? 0) > 0;
  const usaCatalogo = (prodottiCatalogo?.length ?? 0) > 0;

  const [type, setType] = useState<OperationType>("phytosanitary");
  const [plotId, setPlotId] = useState<string>(
    defaultAppezzamentoId ?? "",
  );
  const [fieldCampaignId, setFieldCampaignId] = useState<string>(() => {
    if (!usesCampaign || !defaultAppezzamentoId) return "";
    return (
      campaignFields?.find((c) => c.plotId === defaultAppezzamentoId)
        ?.fieldCampaignId ?? ""
    );
  });
  const [data, setData] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [product, setProduct] = useState("");
  const [productCode, setProductCode] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [sostanzaAttiva, setSostanzaAttiva] = useState("");
  const [doseValue, setDoseValue] = useState("");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>("kg/ha");
  const [waterVolume, setWaterVolume] = useState("");
  const [operatorTaxCode, setOperatorTaxCode] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  const plot = useMemo(
    () => plots.find((a) => a.id === plotId) ?? null,
    [plots, plotId],
  );

  const selectedField = useMemo(
    () => campaignFields?.find((c) => c.fieldCampaignId === fieldCampaignId) ?? null,
    [campaignFields, fieldCampaignId],
  );

  // Superficie autorevole per i calcoli: dichiarata di campagna o quella fisica.
  const area = selectedField?.superficieHa ?? plot?.area_ha ?? null;

  // Totale automatico: dose × area (solo per unità riferite all'ettaro).
  const totalQuantity = useMemo(() => {
    const dose = Number.parseFloat(doseValue);
    if (!Number.isFinite(dose) || !area || !doseUnit.endsWith("/ha")) {
      return null;
    }
    return Math.round(dose * area * 100) / 100;
  }, [doseValue, doseUnit, area]);

  // Geo-compliance dell'appezzamento selezionato (vincoli + massimale azoto).
  const compliance = useMemo(
    () => (plot && valutaCompliance ? valutaCompliance(plot) : null),
    [plot, valutaCompliance],
  );
  const exceedsNitrogen =
    type === "fertilization" &&
    compliance?.azotoMaxTotaleKg != null &&
    totalQuantity != null &&
    totalQuantity > compliance.azotoMaxTotaleKg;

  // Validazione PAN completa (Modulo 3) solo per i treatments fitosanitari;
  // per gli altri tipi (irrigazione, lavorazione…) restano i vincoli minimi.
  const fito = type === "phytosanitary";
  const panErrors = useMemo<ValidationError[]>(
    () =>
      fito
        ? validateTreatmentLog({
            operation_date: data,
            target_disease: target,
            product_name: product,
            registration_number: registrationNumber,
            active_substance: sostanzaAttiva,
            applied_dose: doseValue ? Number.parseFloat(doseValue) : null,
            unit_of_measure: doseUnit,
            operator_license_number: licenseNumber,
          })
        : [],
    [
      fito,
      data,
      target,
      product,
      registrationNumber,
      sostanzaAttiva,
      doseValue,
      doseUnit,
      licenseNumber,
    ],
  );
  const missing = panErrors.length > 0;

  function selectCampaign(value: string) {
    setFieldCampaignId(value);
    const opt = campaignFields?.find((c) => c.fieldCampaignId === value);
    setPlotId(opt?.plotId ?? "");
  }

  // Selezione dal catalog nazionale: auto-compila sostanza attiva e n. registrazione.
  function selectProduct(codice: string) {
    setProductCode(codice);
    const item = prodottiCatalogo?.find((p) => p.code === codice);
    setProduct(item?.name ?? "");
    if (item?.active_substance) setSostanzaAttiva(item.active_substance);
    if (item?.registration_number)
      setRegistrationNumber(item.registration_number);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || missing) return;
    setSaving(true);
    try {
      await onSubmit({
        operation_type: type,
        plot_id: plotId || null,
        plot_campaign_id: fieldCampaignId || null,
        product_name: product || null,
        registration_number: registrationNumber || null,
        dose_value: doseValue ? Number.parseFloat(doseValue) : null,
        dose_unit: doseValue ? doseUnit : null,
        total_quantity: totalQuantity,
        target_disease: target || null,
        operator_name: null,
        machinery_equipment: null,
        active_substance: sostanzaAttiva || null,
        water_volume_l: waterVolume ? Number.parseInt(waterVolume, 10) : null,
        operator_tax_code: operatorTaxCode.trim().toUpperCase() || null,
        license_number: licenseNumber || null,
        fertilizer_type: null,
        npk_ratio: null,
        executed_at: new Date(`${data}T12:00:00`).toISOString(),
        reentry_interval_h: null,
        safety_period_days: null,
        weather_conditions: null,
        note: null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TIPI.map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => setType(op)}
            className={cn(
              "min-h-[var(--touch-min)] rounded-[var(--r-2)] border px-3 text-sm",
              type === op
                ? "border-[var(--accent-bd)] bg-[var(--accent-l)] font-semibold text-[var(--accent)]"
                : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink-2)]",
            )}
          >
            {t(`logbook.treatment.type.${op}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-data">{t("logbook.treatment.date")}</Label>
          <Input
            id="qdc-data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-appezzamento">
            {usesCampaign
              ? t("logbook.common.fieldCampaign")
              : t("logbook.common.plot")}
          </Label>
          {usesCampaign ? (
            <Select
              id="qdc-appezzamento"
              value={fieldCampaignId}
              onChange={(e) => selectCampaign(e.target.value)}
            >
              <option value="">{t("logbook.common.wholeFarm")}</option>
              {campaignFields?.map((c) => (
                <option key={c.fieldCampaignId} value={c.fieldCampaignId}>
                  {c.name}
                  {c.codiceColturaSian ? ` · SIAN ${c.codiceColturaSian}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              id="qdc-appezzamento"
              value={plotId}
              onChange={(e) => setPlotId(e.target.value)}
            >
              <option value="">{t("logbook.common.wholeFarm")}</option>
              {plots.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user_plot_name}
                  {a.area_ha != null
                    ? ` · ${a.area_ha.toFixed(2)} ha`
                    : ""}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {compliance && compliance.note.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--warn)] bg-[var(--warn-l)] px-3 py-2 text-xs text-[var(--warn)]">
          <span className="font-semibold uppercase tracking-wide">
            {t("logbook.treatment.geoConstraints")}
          </span>
          {compliance.note.map((nota) => (
            <span key={nota}>• {nota}</span>
          ))}
          {compliance.azotoMaxTotaleKg != null && (
            <span className="text-[var(--ink-3)]">
              {t("logbook.treatment.nitrogenLimit")}{" "}
              <strong className="agro-num">
                {compliance.azotoMaxTotaleKg} kg
              </strong>
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-prodotto">
            {t("logbook.treatment.product")}
          </Label>
          {usaCatalogo ? (
            <Select
              id="qdc-prodotto"
              value={productCode}
              onChange={(e) => selectProduct(e.target.value)}
              required={fito}
            >
              <option value="">{t("logbook.common.selectFromRegister")}</option>
              {prodottiCatalogo?.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                  {p.registration_number ? ` · ${p.registration_number}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="qdc-prodotto"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder={t("logbook.treatment.productPlaceholder")}
              required={fito}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-reg">{t("logbook.treatment.regNumber")}</Label>
          <Input
            id="qdc-reg"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={t("logbook.treatment.regNumberPlaceholder")}
            className="agro-num"
            required={fito}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qdc-sa">{t("logbook.treatment.activeSubstance")}</Label>
        <Input
          id="qdc-sa"
          value={sostanzaAttiva}
          onChange={(e) => setSostanzaAttiva(e.target.value)}
          placeholder={t("logbook.treatment.activeSubstancePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qdc-target">{t("logbook.treatment.target")}</Label>
        <Select
          id="qdc-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required={fito}
        >
          <option value="">{t("logbook.common.select")}</option>
          {PAN_PESTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-dose">{t("logbook.treatment.dose")}</Label>
          <Input
            id="qdc-dose"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={doseValue}
            onChange={(e) => setDoseValue(e.target.value)}
            className="agro-num"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-unita">{t("logbook.treatment.unit")}</Label>
          <Select
            id="qdc-unita"
            value={doseUnit}
            onChange={(e) => setDoseUnit(e.target.value as DoseUnit)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u === "m3" ? "m³" : u}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-acqua">{t("logbook.treatment.water")}</Label>
          <Input
            id="qdc-acqua"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={waterVolume}
            onChange={(e) => setWaterVolume(e.target.value)}
            placeholder={t("logbook.treatment.waterPlaceholder")}
            className="agro-num"
          />
        </div>
      </div>

      {totalQuantity != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
          {t("logbook.treatment.computedTotal")}{" "}
          <strong className="agro-num text-[var(--ink)]">
            {totalQuantity} {doseUnit.split("/")[0]}
          </strong>{" "}
          ({doseValue} {doseUnit} × {area?.toFixed(2)} ha)
        </p>
      )}

      {exceedsNitrogen && compliance?.azotoMaxTotaleKg != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--danger-l)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {t("logbook.treatment.nitrogenExceeded", {
            max: compliance.azotoMaxTotaleKg,
          })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-cf">{t("logbook.treatment.operatorTaxCode")}</Label>
          <Input
            id="qdc-cf"
            value={operatorTaxCode}
            onChange={(e) => setOperatorTaxCode(e.target.value)}
            placeholder={t("logbook.treatment.operatorTaxCodePlaceholder")}
            className="agro-num uppercase"
            maxLength={16}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-pat">{t("logbook.treatment.license")}</Label>
          <Input
            id="qdc-pat"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder={t("logbook.treatment.licensePlaceholder")}
            className="agro-num"
          />
        </div>
      </div>

      {fito && panErrors.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          <span className="font-semibold uppercase tracking-wide">
            {t("logbook.common.panRequired")}
          </span>
          {panErrors.map((e) => (
            <span key={`${e.field}-${e.messageKey}`}>
              • {td(TREATMENT_FIELD_KEY[e.field] ?? e.field)}:{" "}
              {td(e.messageKey, e.params)}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={saving || missing}
          className="min-h-[var(--touch-min)] flex-1"
        >
          {saving ? t("logbook.common.saving") : t("logbook.treatment.submit")}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="min-h-[var(--touch-min)]"
          >
            {t("logbook.common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
