import { cn } from "@geolibre/ui";
import {
  Bug,
  CircleHelp,
  Info,
  Keyboard,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutModal } from "./AboutModal";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { FeedbackModal } from "./FeedbackModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { checkForUpdates, notify, type UpdateResult } from "./helpActions";
import { useDiagnostics } from "./useDiagnostics";

/**
 * Menu di Aiuto della Topbar (accanto al menu Profilo). Replica il menu "Aiuto"
 * di GeoLibre nello stile biopunk/dark della suite: Riquadro Comandi, Scorciatoie,
 * Diagnostica (con badge dinamico), Invia Feedback, Controlla Aggiornamenti e
 * Informazioni.
 *
 * Lo stato di apertura è gestito localmente con dropdown hand-rolled (come il
 * menu profile): nessun portale Radix sopra il canvas MapLibre, così la mappa
 * sottostante non viene mai disturbata. La chiusura avviene su click esterno,
 * Esc o selezione di una voce.
 */
export function HelpMenu({
  onOpenCommandPalette,
}: {
  /** Apre la Command Palette globale (equivalente a Ctrl/Cmd+K). */
  onOpenCommandPalette: () => void;
}) {
  const { t } = useTranslation();
  const diagnostics = useDiagnostics();

  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Chiusura su click esterno / Esc (allineato al menu profile dell'header).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleCommandPalette = () => {
    setOpen(false);
    onOpenCommandPalette();
  };

  // Controllo aggiornamenti: spinner inline nel menu + notifica di sistema con
  // l'esito (aggiornato / nuova versione disponibile). Il dropdown resta aperto.
  const handleCheckUpdates = async () => {
    if (checking) return;
    setChecking(true);
    setUpdateResult(null);
    const result = await checkForUpdates();
    setUpdateResult(result);
    setChecking(false);

    if (result.status === "available") {
      void notify(
        t("help.update.notifyTitle"),
        t("help.update.available", { version: result.version }),
      );
    } else if (result.status === "uptodate") {
      void notify(t("help.update.notifyTitle"), t("help.update.upToDate"));
    }
  };

  const updateMessage = (() => {
    if (checking) return t("help.update.checking");
    if (!updateResult) return null;
    switch (updateResult.status) {
      case "available":
        return t("help.update.available", { version: updateResult.version });
      case "uptodate":
        return t("help.update.upToDate");
      case "unavailable":
        return t("help.update.unavailable");
      case "error":
        return t("help.update.error");
    }
  })();

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("help.menu")}
          className="flex h-9 items-center gap-1.5 rounded-[var(--r-2)] px-2 text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
          title={t("help.menu")}
        >
          <CircleHelp size={17} />
          <span className="hidden text-sm font-medium md:inline">
            {t("help.menu")}
          </span>
          {diagnostics.count > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
              {diagnostics.count}
            </span>
          )}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--sh-pop)]"
          >
            <HelpItem icon={Search} label={t("help.commandPalette")} onClick={handleCommandPalette} />
            <HelpItem
              icon={Keyboard}
              label={t("help.shortcuts")}
              onClick={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            />

            <div className="my-1 border-t border-[var(--line)]" />

            <HelpItem
              icon={Bug}
              label={t("help.diagnostics")}
              badge={diagnostics.count > 0 ? diagnostics.count : undefined}
              onClick={() => {
                setOpen(false);
                setDiagOpen(true);
              }}
            />
            <HelpItem
              icon={MessageSquare}
              label={t("help.feedback")}
              onClick={() => {
                setOpen(false);
                setFeedbackOpen(true);
              }}
            />

            {/* Controlla aggiornamenti: non chiude il menu, mostra spinner + esito. */}
            <button
              type="button"
              role="menuitem"
              disabled={checking}
              onClick={() => void handleCheckUpdates()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:cursor-default"
            >
              {checking ? (
                <Loader2 size={15} className="animate-spin text-[var(--ink-3)]" />
              ) : (
                <RefreshCw size={15} className="text-[var(--ink-3)]" />
              )}
              <span className="flex-1">{t("help.checkUpdates")}</span>
            </button>
            {updateMessage && (
              <p className="px-3 pb-1.5 pt-0.5 text-xs text-[var(--ink-4)]">
                {updateMessage}
              </p>
            )}

            <div className="my-1 border-t border-[var(--line)]" />

            <HelpItem
              icon={Info}
              label={t("help.about")}
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
            />
          </div>
        )}
      </div>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <DiagnosticsModal
        open={diagOpen}
        diagnostics={diagnostics}
        onClose={() => setDiagOpen(false)}
      />
    </>
  );
}

/** Voce di menu standard: icona + etichetta + badge opzionale. */
function HelpItem({
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  icon: typeof Search;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ink-2)] hover:bg-[var(--panel-2)]",
      )}
    >
      <Icon size={15} className="text-[var(--ink-3)]" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
