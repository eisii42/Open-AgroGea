import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Diagnostics } from "./useDiagnostics";

/**
 * Pannello di Diagnostica: elenca gli avvisi attivi (sync, coda outbox, meteo)
 * derivati da {@link useDiagnostics}. Senza problemi mostra lo stato "tutto ok".
 */
export function DiagnosticsModal({
  open,
  diagnostics,
  onClose,
}: {
  open: boolean;
  diagnostics: Diagnostics;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("help.diagnosticsModal.title")}</DialogTitle>
          <DialogDescription>
            {t("help.diagnosticsModal.description")}
          </DialogDescription>
        </DialogHeader>

        {diagnostics.count === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--ok)]" />
            <p className="text-sm text-[var(--ink-3)]">
              {t("help.diagnosticsModal.allClear")}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {diagnostics.issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5"
              >
                <ShieldAlert
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{
                    color:
                      issue.severity === "error"
                        ? "var(--danger)"
                        : "var(--warn)",
                  }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ink-2)]">
                    {t(issue.titleKey, { count: issue.count ?? 0 })}
                  </p>
                  {issue.detail && (
                    <p className="mt-0.5 truncate font-mono text-xs text-[var(--ink-4)]">
                      {issue.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
