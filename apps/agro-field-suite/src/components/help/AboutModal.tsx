import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import { Loader2, RefreshCw, Sprout } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_VERSION, checkForUpdates, type UpdateResult } from "./helpActions";

/**
 * Modal "Informazioni": logo AgroGea, versione current del software e nota
 * legale sul treatment local-first dei dati (PGlite per tenant; nessun dato
 * lascia il dispositivo finché l'utente non sincronizza). Include un controllo
 * aggiornamenti inline così la scheda non resta un testo statico ma riflette
 * lo stato reale del software installato.
 */
export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);

  const handleCheckUpdates = async () => {
    if (checking) return;
    setChecking(true);
    setUpdateResult(null);
    setUpdateResult(await checkForUpdates());
    setChecking(false);
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="sr-only">{t("help.aboutModal.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("help.aboutModal.legal")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[var(--r-3)] bg-[var(--accent)] text-white shadow-[var(--sh-2)]">
            <Sprout size={30} />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">AgroGea</h2>
          <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 font-mono text-xs text-[var(--ink-3)]">
            v{APP_VERSION}-alpha
          </span>
          <p className="text-xs leading-relaxed text-[var(--ink-3)]">
            {t("help.aboutModal.legal")}
          </p>

          <button
            type="button"
            disabled={checking}
            onClick={() => void handleCheckUpdates()}
            className="mt-1 flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)] disabled:cursor-default"
          >
            {checking ? (
              <Loader2 size={13} className="animate-spin text-[var(--ink-3)]" />
            ) : (
              <RefreshCw size={13} className="text-[var(--ink-3)]" />
            )}
            {t("help.checkUpdates")}
          </button>
          {updateMessage && (
            <p className="text-xs text-[var(--ink-4)]">{updateMessage}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
