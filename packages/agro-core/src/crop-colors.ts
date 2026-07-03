/**
 * Mappatura colore + icona per tipo di coltura.
 *
 * Modulo PURO (zero dipendenze React): l'app risolve la `CropIconKey` in un
 * componente icona concreto (lucide). Gli appezzamenti senza coltura associata
 * ricevono un colore neutro (grigio); ogni specie coltivata ha un colore ad hoc
 * stabile, così la mappa è leggibile a colpo d'occhio.
 *
 * La chiave di abbinamento è il `common_name` della coltura (la SPECIE, non la
 * varietà): tutti i "Vite (Sangiovese)" e "Vite (Merlot)" condividono lo stesso
 * colore/icona perché entrambi sono "Vite".
 */

/** Colore neutro per gli appezzamenti privi di coltura nell'annata attiva. */
export const NO_CROP_COLOR = "#9ca3af";

/** Chiave icona simbolica, risolta dall'app in un componente lucide concreto. */
export type CropIconKey =
  | "grape"
  | "olive"
  | "cereal"
  | "corn"
  | "sunflower"
  | "tomato"
  | "soy"
  | "rice"
  | "root"
  | "citrus"
  | "pome"
  | "stone-fruit"
  | "forage"
  | "tobacco"
  | "rapeseed"
  | "vegetable"
  | "nut"
  | "legume"
  | "aromatic"
  | "forest"
  | "generic"
  | "none";

export interface CropStyle {
  color: string;
  icon: CropIconKey;
}

interface CropGroup {
  /** Parole-chiave (già normalizzate) che identificano il gruppo coltura. */
  keywords: string[];
  color: string;
  icon: CropIconKey;
}

/**
 * Gruppi coltura in ordine di priorità (il primo che matcha vince). Le parole
 * sono normalizzate (minuscolo, senza accenti). I colori sono scelti distinti e
 * coerenti con la cultura visiva agronomica (vite=viola, oliveto=verde oliva,
 * cereali=oro, ecc.).
 */
const CROP_GROUPS: CropGroup[] = [
  { keywords: ["vite", "vigneto", "vigna", "uva"], color: "#7c3aed", icon: "grape" },
  { keywords: ["olivo", "oliveto", "oliva"], color: "#6b8e23", icon: "olive" },
  { keywords: ["mais", "granoturco", "granturco"], color: "#eab308", icon: "corn" },
  // Seminativo (categoria generica a copertura erbacea/cerealicola): giallo
  // paglierino, più tenue dell'oro dei cereali specifici qui sotto.
  { keywords: ["seminativo", "seminativi"], color: "#e4d96f", icon: "cereal" },
  {
    keywords: ["grano", "frumento", "cereale", "cereali", "orzo", "avena", "farro", "segale", "spelta"],
    color: "#d4a017",
    icon: "cereal",
  },
  { keywords: ["girasole"], color: "#facc15", icon: "sunflower" },
  { keywords: ["colza", "ravizzone"], color: "#fde047", icon: "rapeseed" },
  { keywords: ["pomodoro"], color: "#dc2626", icon: "tomato" },
  { keywords: ["soia", "soja"], color: "#65a30d", icon: "soy" },
  { keywords: ["riso", "risaia"], color: "#0891b2", icon: "rice" },
  { keywords: ["patata"], color: "#a16207", icon: "root" },
  { keywords: ["barbabietola", "bietola"], color: "#be185d", icon: "root" },
  {
    keywords: ["agrumi", "arancio", "arancia", "limone", "clementine", "mandarino", "pompelmo", "bergamotto"],
    color: "#f97316",
    icon: "citrus",
  },
  {
    keywords: ["melo", "mela", "pero", "pera", "pomacee", "frutteto", "frutta", "cotogno"],
    color: "#e11d48",
    icon: "pome",
  },
  {
    keywords: ["pesco", "pesca", "susino", "susina", "ciliegio", "ciliegia", "albicocco", "albicocca", "drupacee", "prugno", "prugna"],
    color: "#db2777",
    icon: "stone-fruit",
  },
  {
    keywords: ["erba medica", "medica", "foraggio", "foraggere", "prato", "erbaio", "trifoglio", "loietto", "sulla"],
    color: "#22c55e",
    icon: "forage",
  },
  { keywords: ["tabacco"], color: "#92400e", icon: "tobacco" },
  {
    keywords: ["fagiolo", "fagiolino", "cece", "ceci", "lenticchia", "pisello", "fava", "lupino", "legume", "leguminose"],
    color: "#84cc16",
    icon: "legume",
  },
  {
    keywords: ["nocciolo", "nocciola", "noce", "mandorlo", "mandorla", "castagno", "castagna", "pistacchio", "carrubo"],
    color: "#854d0e",
    icon: "nut",
  },
  {
    keywords: ["ortaggi", "ortaggio", "orticola", "insalata", "lattuga", "zucchino", "zucca", "peperone", "melanzana", "cavolo", "finocchio", "carota", "cipolla", "aglio"],
    color: "#16a34a",
    icon: "vegetable",
  },
  { keywords: ["lavanda", "aromatiche", "aromatica", "salvia", "rosmarino", "timo", "menta", "officinali"], color: "#8b5cf6", icon: "aromatic" },
  { keywords: ["bosco", "forestale", "ceduo", "pioppeto", "pioppo"], color: "#166534", icon: "forest" },
];

/**
 * Palette di fallback per colture non riconosciute: tinte distinte e separabili,
 * scelte deterministicamente dal nome (stessa coltura → sempre stesso colore).
 */
const FALLBACK_PALETTE = [
  "#2563eb", "#0d9488", "#c026d3", "#ea580c", "#4f46e5",
  "#0284c7", "#9333ea", "#ca8a04", "#059669", "#e11d48",
];

/** Normalizza un nome coltura: minuscolo, accenti rimossi, spazi compatti. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Hash stabile (FNV-1a a 32 bit) di una stringa, per la palette di fallback. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Colore + icona per una coltura dato il suo nome comune. `null`/vuoto →
 * grigio neutro (appezzamento senza coltura).
 */
export function cropStyle(commonName: string | null | undefined): CropStyle {
  if (!commonName || !commonName.trim()) {
    return { color: NO_CROP_COLOR, icon: "none" };
  }
  const norm = normalize(commonName);
  for (const group of CROP_GROUPS) {
    if (group.keywords.some((kw) => norm.includes(kw))) {
      return { color: group.color, icon: group.icon };
    }
  }
  // Coltura sconosciuta: colore deterministico dalla palette di fallback.
  const color = FALLBACK_PALETTE[hashString(norm) % FALLBACK_PALETTE.length];
  return { color, icon: "generic" };
}

/** Solo il colore (shortcut). */
export function cropColor(commonName: string | null | undefined): string {
  return cropStyle(commonName).color;
}
