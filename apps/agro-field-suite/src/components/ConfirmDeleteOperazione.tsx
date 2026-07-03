import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Banner/modal di sicurezza per la cancellazione di una singola operazione del
 * Quaderno di Campagna (FIX 1). A differenza del SafetyDeleteModal (che chiede di
 * digitare il nome esatto di un elemento geografico), qui l'operazione non ha un
 * nome stabile: lo sblocco passa da un TOGGLE di consenso esplicito che abilita
 * il pulsante distruttivo. Espone il messaggio legale obbligatorio prima di
 * eseguire il DELETE su PGlite.
 */
export function ConfirmDeleteOperazione({
  open,
  /** Etichetta dell'operazione da eliminare, per ricordare cosa si cancella. */
  etichetta,
  onConfirm,
  onClose,
  /** Titolo del modal (default: operazione colturale del QDC). */
  titolo,
  /** Messaggio del banner legale (default: invalidazione storico QDC). */
  messaggio,
  /** Testo del consenso nel toggle. */
  consensoLabel,
}: {
  open: boolean;
  etichetta: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  titolo?: string;
  messaggio?: string;
  consensoLabel?: string;
}) {
  const { t } = useTranslation();
  const [consenso, setConsenso] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titoloEffettivo = titolo ?? t("confirmDeleteOperazione.defaultTitle");
  const messaggioEffettivo =
    messaggio ?? t("confirmDeleteOperazione.defaultMessage");
  const consensoLabelEffettivo =
    consensoLabel ?? t("confirmDeleteOperazione.defaultConsentLabel");

  // Azzera lo sblocco a ogni apertura: nessun residuo dalla sessione precedente.
  useEffect(() => {
    if (open) {
      setConsenso(false);
      setDeleting(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!consenso || deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-2 border-[#dc2626]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#dc2626]">
            <AlertTriangle size={18} />
            {titoloEffettivo}
          </DialogTitle>
          <DialogDescription>{etichetta}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Banner di sicurezza invasivo: messaggio legale obbligatorio. */}
          <div
            role="alert"
            className="rounded-[var(--r-2)] border border-[#dc2626] bg-[var(--danger-l,#fee2e2)] px-3 py-2.5 text-sm text-[#991b1b]"
          >
            <strong>{t("confirmDeleteOperazione.warning")}</strong>{" "}
            {messaggioEffettivo}
          </div>

          {/* Sblocco condizionale: toggle di consenso esplicito. */}
          <button
            type="button"
            role="switch"
            aria-checked={consenso}
            onClick={() => setConsenso((v) => !v)}
            className="flex items-center gap-2.5 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-left text-sm"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                consenso ? "bg-[#dc2626]" : "bg-[var(--ink-4)]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  consenso ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
            <span>{consensoLabelEffettivo}</span>
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[var(--r-2)] border border-[var(--line)] px-3 py-2 text-sm font-medium hover:bg-[var(--panel-2)]"
            >
              {t("logbook.common.cancel")}
            </button>
            <button
              type="button"
              disabled={!consenso || deleting}
              onClick={() => void handleConfirm()}
              className="flex-1 rounded-[var(--r-2)] bg-[#dc2626] px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting
                ? t("confirmDeleteOperazione.deleting")
                : t("confirmDeleteOperazione.confirmDelete")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
