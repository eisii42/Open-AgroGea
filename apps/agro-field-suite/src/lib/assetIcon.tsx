/**
 * Risoluzione `AssetIconKey` (agro-core, React-free) → componente icona lucide.
 * Speculare a {@link ./cropIcon}: dà una simbologia adattiva agli asset
 * infrastrutturali (linee) e ai POI (punti) nel popup della mappa.
 */
import type { AssetIconKey } from "@agrogea/core";
import {
  Building2,
  Bug,
  DoorOpen,
  Droplet,
  Fence,
  FlaskConical,
  Grid3x3,
  type LucideIcon,
  MapPin,
  RadioTower,
  Route,
  Waves,
} from "lucide-react";

const ICON_BY_KEY: Record<AssetIconKey, LucideIcon> = {
  pipe: Waves,
  fence: Fence,
  net: Grid3x3,
  road: Route,
  well: Droplet,
  trap: Bug,
  sensor: RadioTower,
  gate: DoorOpen,
  building: Building2,
  sample: FlaskConical,
  generic: MapPin,
};

/** Componente icona lucide associato al tipo di asset / POI. */
export function assetIcon(key: AssetIconKey): LucideIcon {
  return ICON_BY_KEY[key] ?? MapPin;
}
