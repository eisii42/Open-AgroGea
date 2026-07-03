/**
 * Risoluzione `CropIconKey` (agro-core, React-free) → componente icona lucide.
 * Sfrutta il set agronomico ampliato di lucide-react (allineato all'upstream
 * GeoLibre 1.8.0): vite, cereali, agrumi, legumi, foraggere, ecc.
 */
import type { CropIconKey } from "@agrogea/core";
import {
  Apple,
  Bean,
  Carrot,
  Cherry,
  Citrus,
  Flower2,
  Grape,
  Leaf,
  type LucideIcon,
  Sprout,
  Trees,
  TreePine,
  Wheat,
  Wind,
} from "lucide-react";

const ICON_BY_KEY: Record<CropIconKey, LucideIcon> = {
  grape: Grape,
  olive: Trees,
  cereal: Wheat,
  corn: Wheat,
  sunflower: Flower2,
  tomato: Cherry,
  soy: Bean,
  rice: Sprout,
  root: Carrot,
  citrus: Citrus,
  pome: Apple,
  "stone-fruit": Cherry,
  forage: Sprout,
  tobacco: Leaf,
  rapeseed: Flower2,
  vegetable: Carrot,
  nut: Trees,
  legume: Bean,
  aromatic: Wind,
  forest: TreePine,
  generic: Leaf,
  none: Sprout,
};

/** Componente icona lucide associato alla specie coltura. */
export function cropIcon(key: CropIconKey): LucideIcon {
  return ICON_BY_KEY[key] ?? Leaf;
}
