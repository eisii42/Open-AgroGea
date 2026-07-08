import { useAgroStore } from "@agrogea/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@geolibre/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FEEDBACK_EMAIL, sendFeedback } from "./helpActions";

/**
 * Modulo di invio feedback verso {@link FEEDBACK_EMAIL}. Compone un'email con il
 * messaggio dell'utente e un blocco di metadati tecnici (versione app, lingua
 * attiva e `tenant_id` corrente) per facilitare il debug, poi la apre nel client
 * di posta predefinito.
 */
export function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tenantId = useAgroStore((s) => s.claims?.tenantId ?? null);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Azzera il field a ogni apertura: nessun residuo dalla sessione precedente.
  useEffect(() => {
    if (open) {
      setMessage("");
      setSending(false);
    }
  }, [open]);

  const canSend = message.trim().length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await sendFeedback(message, { language: i18n.language, tenantId });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("help.feedbackModal.title")}</DialogTitle>
          <DialogDescription>
            {t("help.feedbackModal.description", { email: FEEDBACK_EMAIL })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Textarea
            value={message}
            autoFocus
            rows={6}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("help.feedbackModal.placeholder")}
            className="resize-none"
          />
          <p className="text-xs text-[var(--ink-4)]">
            {t("help.feedbackModal.metaNotice")}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              {t("help.feedbackModal.cancel")}
            </Button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void handleSend()}
              className="flex-1 rounded-[var(--r-2)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-[var(--accent-d)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending
                ? t("help.feedbackModal.sending")
                : t("help.feedbackModal.send")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
