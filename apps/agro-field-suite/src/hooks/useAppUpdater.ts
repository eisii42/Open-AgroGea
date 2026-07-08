import { isTauriRuntime } from "@agrogea/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gestione dell'auto-update nativo (Tauri Updater) sull'app desktop OSS.
 *
 * Controlla GitHub Releases all'avvio (endpoint `latest.json` configurato in
 * tauri.conf.json, generato automaticamente da tauri-action), espone lo stato
 * per una UI non silente (banner con changelog + "Aggiorna ora") e, su
 * richiesta, download con avanzamento, installa e riavvia. Tutto è no-op fuori
 * da Tauri desktop: su web/PWA e su mobile la
 * funzione `check` non viene nemmeno invocata, così l'app non crasha dove
 * l'updater non esiste.
 */

export type UpdaterPhase =
  | "idle" // nessun aggiornamento noto (o non in Tauri)
  | "checking"
  | "available" // trovato: in attesa dell'azione utente
  | "downloading"
  | "ready" // scaricato/installato: si sta per riavviare
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  /** Versione available (es. "1.0.1"). */
  version?: string;
  /** Note di rilascio / changelog. */
  notes?: string;
  /** Data di pubblicazione ISO. */
  date?: string;
  /** Avanzamento del download 0..100 (-1 se sconosciuto). */
  progress: number;
  error?: string;
}

const INITIAL: UpdaterState = { phase: "idle", progress: 0 };

export interface UseAppUpdater {
  state: UpdaterState;
  /** Controlla la presenza di aggiornamenti (manuale o al boot). */
  check: () => Promise<void>;
  /** Scarica, installa e riavvia. */
  downloadAndInstall: () => Promise<void>;
  /** Nasconde il banner senza applicare (rinvio). */
  dismiss: () => void;
}

export function useAppUpdater(options?: { autoCheck?: boolean }): UseAppUpdater {
  const [state, setState] = useState<UpdaterState>(INITIAL);
  const updateRef = useRef<Update | null>(null);

  const check = useCallback(async (silent = false) => {
    if (!isTauriRuntime()) return;
    setState((s) => ({ ...s, phase: "checking", error: undefined }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found) {
        updateRef.current = found;
        setState({
          phase: "available",
          version: found.version,
          notes: found.body,
          date: found.date,
          progress: 0,
        });
      } else {
        // Già aggiornato: nessun banner.
        setState(INITIAL);
      }
    } catch (err) {
      // In autoCheck (boot) un errore resta silenzioso (es. updater non
      // configurato/offline/mobile): non si disturba l'utente con un banner.
      const message = err instanceof Error ? err.message : String(err);
      if (silent) {
        console.warn("[updater] check fallito:", message);
        setState(INITIAL);
      } else {
        setState({ phase: "error", progress: 0, error: message });
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setState((s) => ({
              ...s,
              progress:
                total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : -1,
            }));
            break;
          case "Finished":
            setState((s) => ({ ...s, phase: "ready", progress: 100 }));
            break;
        }
      });
      // Riavvio per applicare la nuova versione.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setState({
        phase: "error",
        progress: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const dismiss = useCallback(() => setState(INITIAL), []);

  // Controllo automatico al boot (una sola volta).
  useEffect(() => {
    if (options?.autoCheck === false) return;
    void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, check: () => check(false), downloadAndInstall, dismiss };
}
