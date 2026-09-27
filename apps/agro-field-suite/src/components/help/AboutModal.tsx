import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import { BookOpen, Sprout } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_VERSION,
  getAppVersion,
  manualUrl as buildManualUrl,
  openExternal,
} from "./helpActions";

/**
 * Modal "Informazioni": logo AgroGea, versione current del software, nota
 * legale sul treatment local-first dei dati (PGlite per tenant; nessun dato
 * lascia il dispositivo finché l'utente non sincronizza) e link al manuale.
 */
export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    void getAppVersion().then(setVersion);
  }, []);

  const manualUrl = buildManualUrl(i18n.language);

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
            v{version}
          </span>
          <p className="text-xs leading-relaxed text-[var(--ink-3)]">
            {t("help.aboutModal.legal")}
          </p>

          <button
            type="button"
            onClick={() => void openExternal(manualUrl)}
            className="mt-1 flex items-center gap-1.5 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
          >
            <BookOpen size={13} className="text-[var(--ink-3)]" />
            {t("help.aboutModal.manual")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
