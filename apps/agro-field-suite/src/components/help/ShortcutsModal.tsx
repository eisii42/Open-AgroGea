import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";

/**
 * Elenca le scorciatoie da tastiera attive nella suite (Command Palette, undo/
 * redo geometrico delle celle VRA e dei poligoni, chiusura overlay). Le combo
 * riflettono i binding reali registrati in {@link useGeometryUndoRedo} e nella
 * FieldDashboard, così l'agronomo trova un riferimento sempre coerente.
 */

interface Shortcut {
  /** Tasti della combinazione, resi come <kbd> separati. */
  keys: string[];
  labelKey: ParseKeys;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl/Cmd", "K"], labelKey: "help.shortcut.commandPalette" },
  { keys: ["→"], labelKey: "help.shortcut.viewCommandCenter" },
  { keys: ["←"], labelKey: "help.shortcut.viewMap" },
  { keys: ["Ctrl/Cmd", "Z"], labelKey: "help.shortcut.undo" },
  { keys: ["Ctrl/Cmd", "Y"], labelKey: "help.shortcut.redo" },
  { keys: ["Ctrl/Cmd", "Shift", "Z"], labelKey: "help.shortcut.redoAlt" },
  { keys: ["Esc"], labelKey: "help.shortcut.close" },
];

export function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("help.shortcutsModal.title")}</DialogTitle>
          <DialogDescription>
            {t("help.shortcutsModal.description")}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {SHORTCUTS.map((s) => (
            <li
              key={s.labelKey}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <span className="text-sm text-[var(--ink-2)]">{t(s.labelKey)}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-xs text-[var(--ink-4)]">+</span>
                    )}
                    <kbd className="rounded-[var(--r-1)] border border-[var(--line)] bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-3)]">
                      {k}
                    </kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
