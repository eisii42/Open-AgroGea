import { cn } from "@geolibre/ui";
import { Bug, Info, Keyboard, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutModal } from "./AboutModal";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { FeedbackModal } from "./FeedbackModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { useDiagnostics } from "./useDiagnostics";

/**
 * Voci dell'Aiuto: Scorciatoie (solo con tastiera), Diagnostica (con badge),
 * Invia feedback, Informazioni. Stanno nel menu account del desktop e nel menu
 * "⋯" del telefono: un solo elenco, due contenitori. Il Riquadro comandi non è
 * più qui: ha il suo campo "Cerca… Ctrl K" nell'header.
 *
 * Niente "Controlla aggiornamenti": gli aggiornamenti arrivano da soli (banner
 * `UpdateNotice` sul desktop, store su mobile).
 *
 * Le finestre (scorciatoie, feedback, informazioni, diagnostica) vivono qui: il
 * contenitore deve restare montato anche a menu chiuso, altrimenti si
 * chiuderebbero appena aperte.
 */
export function HelpMenu({
  onItemSelected,
  showShortcuts = false,
  dense = false,
}: {
  /** Chiamato dopo la scelta di una voce (il contenitore si chiude). */
  onItemSelected?: () => void;
  /** Scorciatoie da tastiera: sul telefono non servono. */
  showShortcuts?: boolean;
  /** Righe compatte da 36 px (menu desktop) invece di 48 px (telefono). */
  dense?: boolean;
}) {
  const { t } = useTranslation();
  const diagnostics = useDiagnostics();

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const pick = (openModal: () => void) => () => {
    onItemSelected?.();
    openModal();
  };

  return (
    <>
      <div role="menu" className="flex flex-col">
        {showShortcuts && (
          <HelpItem
            icon={Keyboard}
            label={t("help.shortcuts")}
            onClick={pick(() => setShortcutsOpen(true))}
            dense={dense}
          />
        )}
        <HelpItem
          icon={Bug}
          label={t("help.diagnostics")}
          badge={diagnostics.count > 0 ? diagnostics.count : undefined}
          onClick={pick(() => setDiagOpen(true))}
          dense={dense}
        />
        <HelpItem
          icon={MessageSquare}
          label={t("help.feedback")}
          onClick={pick(() => setFeedbackOpen(true))}
          dense={dense}
        />
        <HelpItem
          icon={Info}
          label={t("help.about")}
          onClick={pick(() => setAboutOpen(true))}
          dense={dense}
        />
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

/** Voce del menu: icona + etichetta + badge opzionale. */
function HelpItem({
  icon: Icon,
  label,
  badge,
  onClick,
  dense,
}: {
  icon: typeof Info;
  label: string;
  badge?: number;
  onClick: () => void;
  dense: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-[var(--r-2)] text-left text-[var(--ink-2)] hover:bg-[var(--panel-2)] active:bg-[var(--panel-2)]",
        dense ? "min-h-9 gap-2.5 px-2.5 text-sm" : "min-h-12 gap-3 px-3 text-[15px]",
      )}
    >
      <Icon size={dense ? 16 : 18} className="text-[var(--ink-3)]" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
