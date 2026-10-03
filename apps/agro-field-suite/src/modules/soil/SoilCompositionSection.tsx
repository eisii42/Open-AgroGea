import { Input, Label, Select } from "@geolibre/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/**
 * Composizione del suolo di un appezzamento (inserimento manuale →
 * `metadata.suolo`, Tier 3 del SoilDataResolver). La tessitura (classe o
 * percentuali) alimenta Saxton-Rawls.
 *
 * Condivisa fra la creazione dell'appezzamento (disegno o adozione di una
 * particella), dove i dati si inseriscono fin da subito, e la scheda di
 * modifica, dove restano correggibili.
 */

export interface SoilForm {
  tessitura: string;
  sabbia: string;
  limo: string;
  argilla: string;
  sostanza_organica: string;
  ph: string;
  azoto: string;
  fosforo: string;
  potassio: string;
  frazione_deplezione: string;
}

export const SOIL_FORM_EMPTY: SoilForm = {
  tessitura: "",
  sabbia: "",
  limo: "",
  argilla: "",
  sostanza_organica: "",
  ph: "",
  azoto: "",
  fosforo: "",
  potassio: "",
  frazione_deplezione: "",
};

/**
 * Classi tessiturali USDA riconosciute dal resolver. Gli id sono le stringhe
 * originali italiane persistite in `metadata.soil.tessitura` (invariate per
 * compatibilità dati); l'etichetta mostrata viene tradotta a runtime tramite
 * `detailEditSheet.textureClass.<id>` (vedi `textureClassLabel`).
 */
const TEXTURE_CLASSES = [
  "sabbioso",
  "sabbioso franco",
  "franco sabbioso",
  "franco",
  "franco limoso",
  "limoso",
  "franco sabbioso argilloso",
  "franco argilloso",
  "franco limoso argilloso",
  "sabbioso argilloso",
  "limoso argilloso",
  "argilloso",
];

const TEXTURE_CLASS_KEYS: Record<string, string> = {
  sabbioso: "sandy",
  "sabbioso franco": "sandyLoam",
  "franco sabbioso": "loamySand",
  franco: "loam",
  "franco limoso": "siltLoam",
  limoso: "silt",
  "franco sabbioso argilloso": "sandyClayLoam",
  "franco argilloso": "clayLoam",
  "franco limoso argilloso": "siltyClayLoam",
  "sabbioso argilloso": "sandyClay",
  "limoso argilloso": "siltyClay",
  argilloso: "clay",
};

/** Etichetta tradotta della classe tessiturale a partire dall'id persistito. */
function textureClassLabel(t: TFunction, id: string): string {
  const key = TEXTURE_CLASS_KEYS[id];
  return key ? t(`detailEditSheet.textureClass.${key}` as never) : id;
}

const NUMERIC_FIELDS: (keyof SoilForm)[] = [
  "sabbia",
  "limo",
  "argilla",
  "sostanza_organica",
  "ph",
  "azoto",
  "fosforo",
  "potassio",
  "frazione_deplezione",
];

/** Idrata il form dai metadata salvati (`metadata.suolo`). */
export function readSoilForm(metadata: Record<string, unknown>): SoilForm {
  const raw = metadata?.suolo;
  if (!raw || typeof raw !== "object") return { ...SOIL_FORM_EMPTY };
  const s = raw as Record<string, unknown>;
  const str = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : typeof v === "string"
        ? v
        : "";
  return {
    tessitura: str(s.tessitura),
    sabbia: str(s.sabbia),
    limo: str(s.limo),
    argilla: str(s.argilla),
    sostanza_organica: str(s.sostanza_organica),
    ph: str(s.ph),
    azoto: str(s.azoto),
    fosforo: str(s.fosforo),
    potassio: str(s.potassio),
    frazione_deplezione: str(s.frazione_deplezione),
  };
}

/** Fonde il form nei metadata: rimuove `suolo` se l'utente ha svuotato tutto. */
export function mergeSoilMetadata(
  metadata: Record<string, unknown>,
  form: SoilForm,
): Record<string, unknown> {
  const soil: Record<string, unknown> = {};
  if (form.tessitura.trim()) soil.tessitura = form.tessitura.trim();
  for (const field of NUMERIC_FIELDS) {
    const grezzo = form[field].trim().replace(",", ".");
    if (grezzo === "") continue;
    const n = Number(grezzo);
    if (Number.isFinite(n)) soil[field] = n;
  }
  const next = { ...metadata };
  if (Object.keys(soil).length > 0) next.suolo = soil;
  else delete next.suolo;
  return next;
}

function SoilNumber({
  id,
  label,
  value,
  onChange,
  step,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SoilCompositionSection({
  soil,
  onChange,
  idPrefix = "ed",
}: {
  soil: SoilForm;
  onChange: (field: keyof SoilForm, value: string) => void;
  /** Prefisso degli id dei campi, per non duplicarli fra schede diverse. */
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--line)] pt-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("detailEditSheet.soilComposition")}
        </p>
        <p className="text-[11px] text-[var(--ink-4)]">
          {t("detailEditSheet.soilCompositionHint")}
        </p>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-soil-tess`}>{t("detailEditSheet.textureClassLabel")}</Label>
        <Select
          id={`${idPrefix}-soil-tess`}
          value={soil.tessitura}
          onChange={(e) => onChange("tessitura", e.target.value)}
        >
          <option value="">{t("detailEditSheet.notSpecified")}</option>
          {TEXTURE_CLASSES.map((c) => (
            <option key={c} value={c}>
              {textureClassLabel(t, c)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SoilNumber
          id={`${idPrefix}-soil-sabbia`}
          label={t("detailEditSheet.sandPercent")}
          value={soil.sabbia}
          onChange={(v) => onChange("sabbia", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-limo`}
          label={t("detailEditSheet.siltPercent")}
          value={soil.limo}
          onChange={(v) => onChange("limo", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-argilla`}
          label={t("detailEditSheet.clayPercent")}
          value={soil.argilla}
          onChange={(v) => onChange("argilla", v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SoilNumber
          id={`${idPrefix}-soil-so`}
          label={t("detailEditSheet.organicMatterPercent")}
          step="0.1"
          value={soil.sostanza_organica}
          onChange={(v) => onChange("sostanza_organica", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-ph`}
          label={t("detailEditSheet.ph")}
          step="0.1"
          value={soil.ph}
          onChange={(v) => onChange("ph", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-n`}
          label={t("detailEditSheet.nitrogenMgKg")}
          value={soil.azoto}
          onChange={(v) => onChange("azoto", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-p`}
          label={t("detailEditSheet.phosphorusMgKg")}
          value={soil.fosforo}
          onChange={(v) => onChange("fosforo", v)}
        />
        <SoilNumber
          id={`${idPrefix}-soil-k`}
          label={t("detailEditSheet.potassiumMgKg")}
          value={soil.potassio}
          onChange={(v) => onChange("potassio", v)}
        />
      </div>
    </section>
  );
}
