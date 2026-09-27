import type { AgroTheme } from "@agrogea/core";
import { Moon, Sprout, Sun } from "lucide-react";

/** Temi selezionabili, condivisi fra header desktop e menu "⋯" mobile. */
export const THEME_OPTIONS: {
  id: AgroTheme;
  labelKey: string;
  Icon: typeof Sun;
}[] = [
  { id: "light", labelKey: "nav.themeLight", Icon: Sun },
  { id: "dark", labelKey: "nav.themeDark", Icon: Moon },
  { id: "green", labelKey: "nav.themeGreen", Icon: Sprout },
];
