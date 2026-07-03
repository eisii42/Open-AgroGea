import {
  type Appezzamento,
  type CatalogoVoce,
  type DoseUnita,
  type RegistroTrattamento,
  type TipoOperazione,
  type ValidationError,
  validateTreatmentLog,
} from "@agrogea/core";
import { Button, cn, Input, Label, Select } from "@geolibre/ui";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Mappa campo PAN → chiave i18n dell'etichetta (per i messaggi d'errore). */
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
 * agli obblighi PAN/SIAN per i trattamenti fitosanitari:
 *   * selettore del campo per Campagna Agraria (nome utente + codice coltura SIAN);
 *   * data trattamento, avversità (dropdown rigorosa), prodotto commerciale,
 *     n. registrazione ministeriale, sostanza attiva, dose+unità, volume acqua,
 *     CF operatore e numero di patentino.
 * Tutti i target touch sono ≥ 44px.
 */

const TIPI = [
  "phytosanitary",
  "fertilization",
  "irrigation",
  "tillage",
  "sampling",
] as const satisfies readonly TipoOperazione[];

const UNITA: DoseUnita[] = ["kg/ha", "l/ha", "kg/hl", "l/hl", "g/hl", "m3"];

/** Avversità target PAN (dropdown rigorosa: niente testo libero). */
export const AVVERSITA_PAN = [
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

export type TrattamentoFormValues = Omit<
  RegistroTrattamento,
  "id" | "tenant_id" | "company_id" | "created_at" | "updated_at" | "deleted_at"
>;

/** Opzione di campo per la Campagna Agraria selezionata (nome + codice SIAN). */
export interface CampoCampagnaOption {
  campoCampagnaId: string;
  appezzamentoId: string;
  nome: string;
  codiceColturaSian: string | null;
  superficieHa: number | null;
}

/** Esito della geo-compliance per l'appezzamento selezionato, iniettato dall'app. */
export interface ComplianceTrattamento {
  /** Note leggibili dei vincoli (ZVN, SIC/ZPS). */
  note: string[];
  /** Massimale assoluto di azoto (kg) per l'appezzamento; null = nessun vincolo. */
  azotoMaxTotaleKg: number | null;
}

export interface TrattamentoFormProps {
  appezzamenti: Appezzamento[];
  onSubmit: (values: TrattamentoFormValues) => Promise<void> | void;
  onCancel?: () => void;
  /** Appezzamento pre-selezionato (es. apertura dal popup del campo). */
  defaultAppezzamentoId?: string | null;
  /**
   * Campi validi per la Campagna Agraria attiva. Se forniti, il selettore mostra
   * questi (nome + codice coltura SIAN) e l'operazione aggancia `plot_campaign_id`.
   */
  campiCampagna?: CampoCampagnaOption[];
  /**
   * Valuta i vincoli geografici dell'appezzamento (iniettata dall'app, che
   * legge i layer ZVN/SIC-ZPS). Tiene @agrogea/ui disaccoppiato dal motore.
   */
  valutaCompliance?: (appezzamento: Appezzamento) => ComplianceTrattamento | null;
  /**
   * Catalogo fitosanitari filtrato per `country_code` (iniettato dall'app via
   * `useCountryCatalog`). Se fornito, il campo "Prodotto" diventa un dropdown del
   * registro nazionale che auto-compila sostanza attiva e n. registrazione.
   */
  prodottiCatalogo?: CatalogoVoce[];
}

export function TrattamentoForm({
  appezzamenti,
  onSubmit,
  onCancel,
  defaultAppezzamentoId,
  campiCampagna,
  valutaCompliance,
  prodottiCatalogo,
}: TrattamentoFormProps) {
  const { t } = useTranslation();
  // t() per chiavi DINAMICHE (etichette campo + messaggi del validatore PAN):
  // bypassa il tipaggio stretto delle chiavi statiche di i18next.
  const td = t as unknown as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;
  const usaCampagna = (campiCampagna?.length ?? 0) > 0;
  const usaCatalogo = (prodottiCatalogo?.length ?? 0) > 0;

  const [tipo, setTipo] = useState<TipoOperazione>("phytosanitary");
  const [appezzamentoId, setAppezzamentoId] = useState<string>(
    defaultAppezzamentoId ?? "",
  );
  const [campoCampagnaId, setCampoCampagnaId] = useState<string>(() => {
    if (!usaCampagna || !defaultAppezzamentoId) return "";
    return (
      campiCampagna?.find((c) => c.appezzamentoId === defaultAppezzamentoId)
        ?.campoCampagnaId ?? ""
    );
  });
  const [data, setData] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [prodotto, setProdotto] = useState("");
  const [prodottoCodice, setProdottoCodice] = useState("");
  const [numeroRegistrazione, setNumeroRegistrazione] = useState("");
  const [sostanzaAttiva, setSostanzaAttiva] = useState("");
  const [doseValore, setDoseValore] = useState("");
  const [doseUnita, setDoseUnita] = useState<DoseUnita>("kg/ha");
  const [acquaVolume, setAcquaVolume] = useState("");
  const [operatoreCf, setOperatoreCf] = useState("");
  const [numPatentino, setNumPatentino] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  const appezzamento = useMemo(
    () => appezzamenti.find((a) => a.id === appezzamentoId) ?? null,
    [appezzamenti, appezzamentoId],
  );

  const campoSel = useMemo(
    () => campiCampagna?.find((c) => c.campoCampagnaId === campoCampagnaId) ?? null,
    [campiCampagna, campoCampagnaId],
  );

  // Superficie autorevole per i calcoli: dichiarata di campagna o quella fisica.
  const superficie = campoSel?.superficieHa ?? appezzamento?.area_ha ?? null;

  // Totale automatico: dose × superficie (solo per unità riferite all'ettaro).
  const quantitaTotale = useMemo(() => {
    const dose = Number.parseFloat(doseValore);
    if (!Number.isFinite(dose) || !superficie || !doseUnita.endsWith("/ha")) {
      return null;
    }
    return Math.round(dose * superficie * 100) / 100;
  }, [doseValore, doseUnita, superficie]);

  // Geo-compliance dell'appezzamento selezionato (vincoli + massimale azoto).
  const compliance = useMemo(
    () => (appezzamento && valutaCompliance ? valutaCompliance(appezzamento) : null),
    [appezzamento, valutaCompliance],
  );
  const superaAzoto =
    tipo === "fertilization" &&
    compliance?.azotoMaxTotaleKg != null &&
    quantitaTotale != null &&
    quantitaTotale > compliance.azotoMaxTotaleKg;

  // Validazione PAN completa (Modulo 3) solo per i trattamenti fitosanitari;
  // per gli altri tipi (irrigazione, lavorazione…) restano i vincoli minimi.
  const fito = tipo === "phytosanitary";
  const panErrors = useMemo<ValidationError[]>(
    () =>
      fito
        ? validateTreatmentLog({
            operation_date: data,
            target_disease: target,
            product_name: prodotto,
            registration_number: numeroRegistrazione,
            active_substance: sostanzaAttiva,
            applied_dose: doseValore ? Number.parseFloat(doseValore) : null,
            unit_of_measure: doseUnita,
            operator_license_number: numPatentino,
          })
        : [],
    [
      fito,
      data,
      target,
      prodotto,
      numeroRegistrazione,
      sostanzaAttiva,
      doseValore,
      doseUnita,
      numPatentino,
    ],
  );
  const mancano = panErrors.length > 0;

  function selezionaCampagna(value: string) {
    setCampoCampagnaId(value);
    const opt = campiCampagna?.find((c) => c.campoCampagnaId === value);
    setAppezzamentoId(opt?.appezzamentoId ?? "");
  }

  // Selezione dal catalogo nazionale: auto-compila sostanza attiva e n. registrazione.
  function selezionaProdotto(codice: string) {
    setProdottoCodice(codice);
    const voce = prodottiCatalogo?.find((p) => p.code === codice);
    setProdotto(voce?.name ?? "");
    if (voce?.active_substance) setSostanzaAttiva(voce.active_substance);
    if (voce?.registration_number)
      setNumeroRegistrazione(voce.registration_number);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || mancano) return;
    setSaving(true);
    try {
      await onSubmit({
        operation_type: tipo,
        plot_id: appezzamentoId || null,
        plot_campaign_id: campoCampagnaId || null,
        product_name: prodotto || null,
        registration_number: numeroRegistrazione || null,
        dose_value: doseValore ? Number.parseFloat(doseValore) : null,
        dose_unit: doseValore ? doseUnita : null,
        total_quantity: quantitaTotale,
        target_disease: target || null,
        operator_name: null,
        machinery_equipment: null,
        active_substance: sostanzaAttiva || null,
        water_volume_l: acquaVolume ? Number.parseInt(acquaVolume, 10) : null,
        operator_tax_code: operatoreCf.trim().toUpperCase() || null,
        license_number: numPatentino || null,
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
            onClick={() => setTipo(op)}
            className={cn(
              "min-h-[var(--touch-min)] rounded-[var(--r-2)] border px-3 text-sm",
              tipo === op
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
            {usaCampagna
              ? t("logbook.common.fieldCampaign")
              : t("logbook.common.plot")}
          </Label>
          {usaCampagna ? (
            <Select
              id="qdc-appezzamento"
              value={campoCampagnaId}
              onChange={(e) => selezionaCampagna(e.target.value)}
            >
              <option value="">{t("logbook.common.wholeFarm")}</option>
              {campiCampagna?.map((c) => (
                <option key={c.campoCampagnaId} value={c.campoCampagnaId}>
                  {c.nome}
                  {c.codiceColturaSian ? ` · SIAN ${c.codiceColturaSian}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              id="qdc-appezzamento"
              value={appezzamentoId}
              onChange={(e) => setAppezzamentoId(e.target.value)}
            >
              <option value="">{t("logbook.common.wholeFarm")}</option>
              {appezzamenti.map((a) => (
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
              value={prodottoCodice}
              onChange={(e) => selezionaProdotto(e.target.value)}
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
              value={prodotto}
              onChange={(e) => setProdotto(e.target.value)}
              placeholder={t("logbook.treatment.productPlaceholder")}
              required={fito}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-reg">{t("logbook.treatment.regNumber")}</Label>
          <Input
            id="qdc-reg"
            value={numeroRegistrazione}
            onChange={(e) => setNumeroRegistrazione(e.target.value)}
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
          {AVVERSITA_PAN.map((a) => (
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
            value={doseValore}
            onChange={(e) => setDoseValore(e.target.value)}
            className="agro-num"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-unita">{t("logbook.treatment.unit")}</Label>
          <Select
            id="qdc-unita"
            value={doseUnita}
            onChange={(e) => setDoseUnita(e.target.value as DoseUnita)}
          >
            {UNITA.map((u) => (
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
            value={acquaVolume}
            onChange={(e) => setAcquaVolume(e.target.value)}
            placeholder={t("logbook.treatment.waterPlaceholder")}
            className="agro-num"
          />
        </div>
      </div>

      {quantitaTotale != null && (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
          {t("logbook.treatment.computedTotal")}{" "}
          <strong className="agro-num text-[var(--ink)]">
            {quantitaTotale} {doseUnita.split("/")[0]}
          </strong>{" "}
          ({doseValore} {doseUnita} × {superficie?.toFixed(2)} ha)
        </p>
      )}

      {superaAzoto && compliance?.azotoMaxTotaleKg != null && (
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
            value={operatoreCf}
            onChange={(e) => setOperatoreCf(e.target.value)}
            placeholder={t("logbook.treatment.operatorTaxCodePlaceholder")}
            className="agro-num uppercase"
            maxLength={16}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qdc-pat">{t("logbook.treatment.license")}</Label>
          <Input
            id="qdc-pat"
            value={numPatentino}
            onChange={(e) => setNumPatentino(e.target.value)}
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
          disabled={saving || mancano}
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
