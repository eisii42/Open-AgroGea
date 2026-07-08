/**
 * Mappatura colore + icona per tipo di infrastruttura / punto di interesse.
 *
 * Modulo PURO (zero dipendenze React), speculare a {@link ./crop-colors}: l'app
 * risolve la `AssetIconKey` in un componente icona concreto (lucide). Serve a
 * dare una simbologia ADATTIVA agli asset (linee e POI) nel popup della mappa,
 * come già avviene per le crops nel popup dell'appezzamento.
 *
 * La chiave di abbinamento è l'`asset_type` (per gli asset infrastrutturali) o
 * il `kind` del POI (es. "campionamento"). I valori sono i discriminanti
 * italiani con cui il record è persistito (condotta, pozzo, …): restano com'è,
 * qui si aggiungono anche i sinonimi inglesi per robustezza.
 */

/** Colore neutro per un asset di tipo non riconosciuto. */
export const ASSET_NEUTRAL_COLOR = "#3b4654";

/** Chiave icona simbolica, risolta dall'app in un componente lucide concreto. */
export type AssetIconKey =
  | "pipe"
  | "fence"
  | "net"
  | "road"
  | "well"
  | "trap"
  | "sensor"
  | "gate"
  | "building"
  | "sample"
  | "generic";

export interface AssetStyle {
  color: string;
  icon: AssetIconKey;
}

interface AssetGroup {
  /** Parole-chiave (già normalizzate) che identificano il gruppo asset. */
  keywords: string[];
  color: string;
  icon: AssetIconKey;
}

/**
 * Gruppi asset in ordine di priorità (il primo che matcha vince). Le parole
 * sono normalizzate (minuscolo, senza accenti). Colori scelti distinti e
 * coerenti con la semantica (acqua = blu, sensori = teal, fabbricati = ardesia).
 */
const ASSET_GROUPS: AssetGroup[] = [
  { keywords: ["condotta", "irrigazione", "tubazione", "pipe", "conduit", "irrigation", "duct"], color: "#0ea5e9", icon: "pipe" },
  { keywords: ["recinzione", "recinto", "fence", "fencing"], color: "#78716c", icon: "fence" },
  { keywords: ["rete-antigrandine", "antigrandine", "rete", "hail", "net", "netting"], color: "#64748b", icon: "net" },
  { keywords: ["strada", "pista", "carraia", "road", "track", "path", "lane"], color: "#a8a29e", icon: "road" },
  { keywords: ["pozzo", "well", "borehole"], color: "#0284c7", icon: "well" },
  { keywords: ["trappola", "trap"], color: "#d97706", icon: "trap" },
  { keywords: ["sensore-iot", "sensore", "sensor", "iot", "stazione", "station"], color: "#0d9488", icon: "sensor" },
  { keywords: ["ingresso", "cancello", "gate", "entrance", "access"], color: "#6b7280", icon: "gate" },
  { keywords: ["fabbricato", "edificio", "capannone", "magazzino", "building", "warehouse", "shed"], color: "#57534e", icon: "building" },
  { keywords: ["campionamento", "campione", "sample", "sampling", "soil"], color: "#14b8a6", icon: "sample" },
];

/** Normalizza un name asset: minuscolo, accenti rimossi, spazi compatti. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Colore + icona per un asset dato il suo tipo (o il `kind` del POI).
 * `null`/vuoto o tipo sconosciuto → colore neutro + icona generica.
 */
export function assetStyle(assetType: string | null | undefined): AssetStyle {
  if (!assetType || !assetType.trim()) {
    return { color: ASSET_NEUTRAL_COLOR, icon: "generic" };
  }
  const norm = normalize(assetType);
  for (const group of ASSET_GROUPS) {
    if (group.keywords.some((kw) => norm.includes(kw))) {
      return { color: group.color, icon: group.icon };
    }
  }
  return { color: ASSET_NEUTRAL_COLOR, icon: "generic" };
}

/** Solo il colore (shortcut). */
export function assetColor(assetType: string | null | undefined): string {
  return assetStyle(assetType).color;
}
