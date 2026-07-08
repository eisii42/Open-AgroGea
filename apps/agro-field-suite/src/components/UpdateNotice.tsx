import { Button } from "@geolibre/ui";
import { Download, Loader2, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppUpdater } from "../hooks/useAppUpdater";

/**
 * Banner discreto di aggiornamento (Tauri Updater). Compare in alto solo quando
 * c'è un aggiornamento available o in corso; mostra versione e changelog, con
 * azione esplicita "Aggiorna ora" (nessun download silenzioso) e avanzamento del
 * download. È un no-op fuori da Tauri desktop (l'hook non controlla nemmeno).
 */
export function UpdateNotice() {
  const { t } = useTranslation();
  const { state, downloadAndInstall, dismiss } = useAppUpdater();
  const [notesOpen, setNotesOpen] = useState(false);

  // Visibile solo quando c'è qualcosa da mostrare all'utente.
  if (
    state.phase === "idle" ||
    state.phase === "checking"
  ) {
    return null;
  }

  const downloading = state.phase === "downloading";
  const ready = state.phase === "ready";
  const error = state.phase === "error";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center p-2">
      <div className="pointer-events-auto w-full max-w-[640px] rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--sh-2)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] bg-[var(--accent-l)] text-[var(--accent)]">
            {downloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : ready ? (
              <RotateCw size={16} />
            ) : (
              <Download size={16} />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {error ? (
              <p className="text-sm font-medium text-[var(--danger)]">
                {t("updateNotice.failed", { error: state.error })}
              </p>
            ) : ready ? (
              <p className="text-sm font-medium">
                {t("updateNotice.installedRestarting")}
              </p>
            ) : downloading ? (
              <p className="text-sm font-medium">
                {t("updateNotice.downloading")}{" "}
                {state.version ? `v${state.version}` : ""}…
                {state.progress >= 0 ? ` ${state.progress}%` : ""}
              </p>
            ) : (
              <p className="text-sm font-medium">
                {t("updateNotice.available")}{" "}
                <strong>v{state.version}</strong>.
              </p>
            )}

            {/* Changelog espandibile (solo quando available, non in corso). */}
            {state.phase === "available" && state.notes && (
              <div className="mt-1 text-xs text-[var(--ink-3)]">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setNotesOpen((v) => !v)}
                >
                  {notesOpen ? t("updateNotice.hideReleaseNotes") : t("updateNotice.releaseNotes")}
                </button>
                {notesOpen && (
                  <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 font-sans">
                    {state.notes}
                  </pre>
                )}
              </div>
            )}

            {/* Barra di avanzamento durante il download. */}
            {downloading && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line-2,var(--panel-2))]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                  style={{
                    width: state.progress >= 0 ? `${state.progress}%` : "40%",
                  }}
                />
              </div>
            )}
          </div>

          {/* Azioni */}
          <div className="flex shrink-0 items-center gap-1.5">
            {state.phase === "available" && (
              <Button
                onClick={() => void downloadAndInstall()}
                className="min-h-[34px] gap-1.5 px-3 text-[13px]"
              >
                <Download size={14} />
                {t("updateNotice.updateNow")}
              </Button>
            )}
            {!downloading && !ready && (
              <button
                type="button"
                aria-label={t("updateNotice.close")}
                onClick={dismiss}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
