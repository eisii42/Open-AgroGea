import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import { Sprout } from "lucide-react";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "./helpActions";

/**
 * Modal "Informazioni": logo AgroGea Foundation, versione corrente del software
 * e nota legale sul trattamento local-first dei dati (PGlite per tenant; nessun
 * dato lascia il dispositivo finché l'utente non sincronizza).
 */
export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

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
          <div>
            <h2 className="text-lg font-semibold tracking-tight">AgroGea</h2>
            <p className="text-xs uppercase tracking-wide text-[var(--ink-4)]">
              {t("help.aboutModal.foundation")}
            </p>
          </div>
          <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 font-mono text-xs text-[var(--ink-3)]">
            v{APP_VERSION}-alpha
          </span>
          <p className="text-xs leading-relaxed text-[var(--ink-3)]">
            {t("help.aboutModal.legal")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
