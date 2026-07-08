import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@geolibre/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Modal di cancellazione protetta (Modulo 5). Procedura blindata: il pulsante
 * di conferma resta disabilitato finché il testo digitato non corrisponde al
 * 100% al name esatto dell'elemento. Solo allora esegue il DELETE (via il
 * callback `onConfirm`, che chiama il DAL) e chiude.
 */
export function SafetyDeleteModal({
  open,
  elementName,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** Nome esatto da digitare per sbloccare l'eliminazione. */
  elementName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Azzera il field a ogni apertura: nessun residuo dalla sessione precedente.
  useEffect(() => {
    if (open) {
      setText("");
      setDeleting(false);
    }
  }, [open]);

  const match = text.trim() === elementName.trim() && elementName.length > 0;

  const handleConfirm = async () => {
    if (!match) return;
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[var(--danger,#dc2626)]">
            {t("safetyDeleteModal.title")}
          </DialogTitle>
          <DialogDescription>
            {t("safetyDeleteModal.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-center text-sm font-semibold">
            {elementName}
          </div>
          <div>
            <Label htmlFor="safety-delete-input">{t("safetyDeleteModal.confirmName")}</Label>
            <Input
              id="safety-delete-input"
              value={text}
              autoComplete="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleConfirm();
              }}
              placeholder={elementName}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              {t("logbook.common.cancel")}
            </Button>
            <button
              type="button"
              disabled={!match || deleting}
              onClick={() => void handleConfirm()}
              className="flex-1 rounded-[var(--r-2)] bg-[#dc2626] px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting
                ? t("confirmDeleteOperazione.deleting")
                : t("safetyDeleteModal.confirmDelete")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
