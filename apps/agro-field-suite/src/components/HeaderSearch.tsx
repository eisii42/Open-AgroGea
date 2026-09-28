import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestCommandPalette } from "../modules/command-palette/open-command-palette";

const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

/**
 * Campo "Cerca… Ctrl K" dell'header desktop: la porta visibile del Riquadro
 * comandi (appezzamenti, moduli, azioni), che prima esisteva ma stava nascosto
 * nel menu Aiuto. Sotto i 1024 px si riduce all'icona per lasciare spazio.
 */
export function HeaderSearch() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={requestCommandPalette}
      aria-label={t("headerSearch.label")}
      title={t("headerSearch.label")}
      className="flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-2.5 text-sm text-[var(--ink-4)] hover:bg-[var(--panel)] hover:text-[var(--ink-3)] lg:w-56 lg:justify-start xl:w-72"
    >
      <Search size={15} className="shrink-0" />
      <span className="hidden flex-1 truncate text-left lg:inline">
        {t("headerSearch.placeholder")}
      </span>
      <kbd className="hidden shrink-0 rounded-[var(--r-1)] border border-[var(--line)] bg-[var(--panel)] px-1.5 font-mono text-[11px] text-[var(--ink-3)] lg:inline">
        {IS_MAC ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
