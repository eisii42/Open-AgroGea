import type { TFunction } from "i18next";

/**
 * Schemi dichiarativi del form "Dati coltura" (una scheda per tipo di coltura).
 *
 * Ogni categoria (allineata a `CropModule.categorie` → `cropForPlot`)
 * definisce i campi di filiera SPECIFICI che finiscono in `crops.crop_metadata`
 * (JSONB dinamico), oltre ai campi comuni (nome comune/scientifico/varietà) e ai
 * campi annuali di `plots_campaign`. La `category` salvata in `crop_metadata`
 * è ciò che il DSS legge per risolvere il modulo verticale dell'appezzamento.
 *
 * Le etichette sono chiavi i18n risolte a runtime da `cropFormSchema()`/
 * `allCropFormSchemas()`: il nome scientifico (binomio latino) resta invariato
 * in tutte le lingue, il resto (etichette, placeholder, opzioni select) è
 * tradotto tramite il catalogo `cropFormSchema.*` in `locales/<lang>.json`.
 */

export type CropFieldType = "text" | "number" | "select";

interface CropMetaFieldDef {
  /** Chiave dentro `crop_metadata`. */
  key: string;
  labelKey: string;
  type?: CropFieldType;
  /** Chiave nel dizionario `OPTION_GROUPS` per `type: "select"`. */
  optionsKey?: string;
  placeholderKey?: string;
}

interface CropFormSchemaDef {
  /** Categoria DSS (es. "viticoltura"); salvata in crop_metadata.category. */
  category: string;
  labelKey: string;
  emoji: string;
  commonNameKey: string;
  /** Default per `crops.scientific_name`: binomio latino, non tradotto. */
  scientificName: string;
  varietyLabelKey: string;
  metaFields: CropMetaFieldDef[];
}

export interface CropMetaField {
  key: string;
  label: string;
  type?: CropFieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface CropFormSchema {
  category: string;
  label: string;
  emoji: string;
  commonName: string;
  scientificName: string;
  varietyLabel: string;
  metaFields: CropMetaField[];
}

const OPTION_GROUPS: Record<string, string[]> = {
  formaAllevamento: [
    "spalliera",
    "cordoneSperonato",
    "guyot",
    "alberello",
    "vaso",
    "globo",
    "palmetta",
  ],
  tipoRaccolta: ["manuale", "agevolata", "meccanica"],
  cicloSeminativo: ["autunnoVernino", "primaverile", "estivo", "secondoRaccolto"],
  cicloOrticoltura: ["primaverile", "estivo", "autunnale", "invernale"],
  ambiente: ["pienoCampo", "tunnel", "serra"],
};

const CROP_FORM_SCHEMA_DEFS: CropFormSchemaDef[] = [
  {
    category: "viticoltura",
    labelKey: "cropFormSchema.category.viticoltura.label",
    emoji: "🍇",
    commonNameKey: "cropFormSchema.category.viticoltura.commonName",
    scientificName: "Vitis vinifera",
    varietyLabelKey: "cropFormSchema.category.viticoltura.varietyLabel",
    metaFields: [
      { key: "clone", labelKey: "cropFormSchema.field.clone", placeholderKey: "cropFormSchema.placeholder.viticoltura.clone" },
      { key: "portainnesto", labelKey: "cropFormSchema.field.portainnesto", placeholderKey: "cropFormSchema.placeholder.viticoltura.portainnesto" },
      { key: "sesto_impianto", labelKey: "cropFormSchema.field.sestoImpianto", placeholderKey: "cropFormSchema.placeholder.viticoltura.sestoImpianto" },
      { key: "forma_allevamento", labelKey: "cropFormSchema.field.formaAllevamento", type: "select", optionsKey: "formaAllevamento" },
      { key: "anno_impianto", labelKey: "cropFormSchema.field.annoImpianto", type: "number" },
      { key: "profondita_radici", labelKey: "cropFormSchema.field.profonditaRadici", type: "number", placeholderKey: "cropFormSchema.placeholder.viticoltura.profonditaRadici" },
    ],
  },
  {
    category: "olivicoltura",
    labelKey: "cropFormSchema.category.olivicoltura.label",
    emoji: "🫒",
    commonNameKey: "cropFormSchema.category.olivicoltura.commonName",
    scientificName: "Olea europaea",
    varietyLabelKey: "cropFormSchema.category.olivicoltura.varietyLabel",
    metaFields: [
      { key: "sesto_impianto", labelKey: "cropFormSchema.field.sestoImpianto", placeholderKey: "cropFormSchema.placeholder.olivicoltura.sestoImpianto" },
      { key: "forma_allevamento", labelKey: "cropFormSchema.field.formaAllevamento", type: "select", optionsKey: "formaAllevamento" },
      { key: "anno_impianto", labelKey: "cropFormSchema.field.annoImpianto", type: "number" },
      { key: "profondita_radici", labelKey: "cropFormSchema.field.profonditaRadici", type: "number", placeholderKey: "cropFormSchema.placeholder.olivicoltura.profonditaRadici" },
      { key: "tipo_raccolta", labelKey: "cropFormSchema.field.tipoRaccolta", type: "select", optionsKey: "tipoRaccolta" },
    ],
  },
  {
    category: "frutticoltura",
    labelKey: "cropFormSchema.category.frutticoltura.label",
    emoji: "🍎",
    commonNameKey: "cropFormSchema.category.frutticoltura.commonName",
    scientificName: "",
    varietyLabelKey: "cropFormSchema.category.frutticoltura.varietyLabel",
    metaFields: [
      { key: "specie", labelKey: "cropFormSchema.field.specie", placeholderKey: "cropFormSchema.placeholder.frutticoltura.specie" },
      { key: "portainnesto", labelKey: "cropFormSchema.field.portainnesto", placeholderKey: "cropFormSchema.placeholder.frutticoltura.portainnesto" },
      { key: "sesto_impianto", labelKey: "cropFormSchema.field.sestoImpianto", placeholderKey: "cropFormSchema.placeholder.frutticoltura.sestoImpianto" },
      { key: "forma_allevamento", labelKey: "cropFormSchema.field.formaAllevamento", type: "select", optionsKey: "formaAllevamento" },
      { key: "anno_impianto", labelKey: "cropFormSchema.field.annoImpianto", type: "number" },
      { key: "profondita_radici", labelKey: "cropFormSchema.field.profonditaRadici", type: "number", placeholderKey: "cropFormSchema.placeholder.frutticoltura.profonditaRadici" },
    ],
  },
  {
    category: "seminativo",
    labelKey: "cropFormSchema.category.seminativo.label",
    emoji: "🌾",
    commonNameKey: "cropFormSchema.category.seminativo.commonName",
    scientificName: "",
    varietyLabelKey: "cropFormSchema.category.seminativo.varietyLabel",
    metaFields: [
      { key: "specie", labelKey: "cropFormSchema.field.specie", placeholderKey: "cropFormSchema.placeholder.seminativo.specie" },
      { key: "ciclo", labelKey: "cropFormSchema.field.ciclo", type: "select", optionsKey: "cicloSeminativo" },
      { key: "densita_semina", labelKey: "cropFormSchema.field.densitaSemina", type: "number" },
      { key: "interfila_cm", labelKey: "cropFormSchema.field.interfilaCm", type: "number" },
      { key: "profondita_radici", labelKey: "cropFormSchema.field.profonditaRadici", type: "number", placeholderKey: "cropFormSchema.placeholder.seminativo.profonditaRadici" },
    ],
  },
  {
    category: "orticoltura",
    labelKey: "cropFormSchema.category.orticoltura.label",
    emoji: "🥬",
    commonNameKey: "cropFormSchema.category.orticoltura.commonName",
    scientificName: "",
    varietyLabelKey: "cropFormSchema.category.orticoltura.varietyLabel",
    metaFields: [
      { key: "specie", labelKey: "cropFormSchema.field.specie", placeholderKey: "cropFormSchema.placeholder.orticoltura.specie" },
      { key: "ambiente", labelKey: "cropFormSchema.field.ambiente", type: "select", optionsKey: "ambiente" },
      { key: "ciclo", labelKey: "cropFormSchema.field.ciclo", type: "select", optionsKey: "cicloOrticoltura" },
      { key: "sesto_impianto", labelKey: "cropFormSchema.field.sestoImpianto", placeholderKey: "cropFormSchema.placeholder.orticoltura.sestoImpianto" },
      { key: "profondita_radici", labelKey: "cropFormSchema.field.profonditaRadici", type: "number", placeholderKey: "cropFormSchema.placeholder.orticoltura.profonditaRadici" },
    ],
  },
];

function resolveMetaField(t: TFunction, f: CropMetaFieldDef): CropMetaField {
  return {
    key: f.key,
    label: t(f.labelKey as never),
    type: f.type,
    options: f.optionsKey
      ? OPTION_GROUPS[f.optionsKey].map((optionId) => ({
          value: optionId,
          label: t(`cropFormSchema.option.${f.optionsKey}.${optionId}` as never),
        }))
      : undefined,
    placeholder: f.placeholderKey ? t(f.placeholderKey as never) : undefined,
  };
}

function resolveSchema(t: TFunction, def: CropFormSchemaDef): CropFormSchema {
  return {
    category: def.category,
    label: t(def.labelKey as never),
    emoji: def.emoji,
    commonName: t(def.commonNameKey as never),
    scientificName: def.scientificName,
    varietyLabel: t(def.varietyLabelKey as never),
    metaFields: def.metaFields.map((f) => resolveMetaField(t, f)),
  };
}

/** Tutte le schede coltura, tradotte, per il selettore di categoria. */
export function allCropFormSchemas(t: TFunction): CropFormSchema[] {
  return CROP_FORM_SCHEMA_DEFS.map((def) => resolveSchema(t, def));
}

/** Scheda coltura per una categoria, tradotta a runtime. */
export function cropFormSchema(
  t: TFunction,
  category: string | null | undefined,
): CropFormSchema | undefined {
  if (!category) return undefined;
  const def = CROP_FORM_SCHEMA_DEFS.find((s) => s.category === category);
  return def ? resolveSchema(t, def) : undefined;
}
