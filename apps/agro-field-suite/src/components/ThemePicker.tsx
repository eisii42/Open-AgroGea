import { useAgroStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { useTranslation } from "react-i18next";
import { THEME_OPTIONS } from "./theme-options";

/**
 * Selettore del tema a tre pulsanti (Chiaro · Scuro · Agronomico), condiviso dal
 * menu "⋯" del telefono e dal menu account del desktop: stesso controllo,
 * stesso posto logico, su entrambi.
 */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const theme = useAgroStore((s) => s.theme);
  const setTheme = useAgroStore((s) => s.setTheme);
  return (
    <div className="grid grid-cols-3 gap-1 rounded-[var(--r-2)] bg-[var(--panel-2)] p-1">
      {THEME_OPTIONS.map(({ id, labelKey, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          aria-pressed={theme === id}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 rounded-[var(--r-1)] text-[12px] font-medium",
            compact ? "min-h-10" : "min-h-11",
            theme === id
              ? "bg-[var(--panel)] text-[var(--accent)] shadow-[var(--sh-1)]"
              : "text-[var(--ink-3)] hover:text-[var(--ink-2)]",
          )}
        >
          <Icon size={16} />
          {t(labelKey as never)}
        </button>
      ))}
    </div>
  );
}
