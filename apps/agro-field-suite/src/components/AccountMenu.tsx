import { useAgroStore } from "@agrogea/core";
import { cn } from "@geolibre/ui";
import { Settings, User } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpMenu } from "./help/HelpMenu";
import { useDiagnostics } from "./help/useDiagnostics";
import { ThemePicker } from "./ThemePicker";

/**
 * Menu account dell'header desktop: tema, aiuto e impostazioni profilo in un
 * solo posto, come il menu "⋯" del telefono. Sostituisce i tre pulsanti del
 * tema, il menu Aiuto e il menu Profilo (che aveva una voce sola).
 *
 * Resta montato anche chiuso (nascosto via classe): le finestre dell'Aiuto
 * vivono dentro `HelpMenu` e si chiuderebbero appena aperte.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const togglePanel = useAgroStore((s) => s.togglePanel);
  const diagnostics = useDiagnostics();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const openProfile = () => {
    setOpen(false);
    if (!useAgroStore.getState().openPanels.includes("profile")) {
      togglePanel("profile");
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("accountMenu.label")}
        title={t("accountMenu.label")}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-2)] hover:bg-[var(--panel-3)]",
          open ? "bg-[var(--panel-3)]" : "bg-[var(--panel-2)]",
        )}
      >
        <User size={17} />
        {diagnostics.count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
            {diagnostics.count}
          </span>
        )}
      </button>

      <div
        role="menu"
        className={cn(
          "absolute right-0 top-11 z-50 flex w-72 flex-col gap-3 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-2 shadow-[var(--sh-pop)]",
          !open && "hidden",
        )}
      >
        <Section title={t("mobileMenu.theme")}>
          <ThemePicker compact />
        </Section>
        <Section title={t("help.menu")}>
          <HelpMenu dense showShortcuts onItemSelected={() => setOpen(false)} />
        </Section>
        <div className="border-t border-[var(--line)] pt-2">
          <button
            type="button"
            role="menuitem"
            onClick={openProfile}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-[var(--r-2)] px-2.5 text-left text-sm text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
          >
            <Settings size={16} className="text-[var(--ink-3)]" />
            {t("commandPalette.actions.profileSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <p className="px-2.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {title}
      </p>
      {children}
    </section>
  );
}
