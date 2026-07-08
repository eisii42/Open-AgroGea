import { isTauriRuntime } from "@agrogea/core";

/**
 * Azioni native del Menu di Aiuto (feedback via mailto, updater, notifiche).
 *
 * I plugin Tauri opzionali (`plugin-opener`, `plugin-updater`,
 * `plugin-notification`) NON sono dipendenze fisse della field-suite (priorità
 * peso bundle + nessun toolchain Rust su questa macchina): vengono caricati a
 * runtime *solo se presenti*, con degrado controllato su Web. Lo specifier
 * dell'import è una variabile (più `@vite-ignore`) così né `tsc` né Vite
 * tentano di risolvere staticamente moduli che potrebbero non esistere.
 */

/** Versione current del software (allineata a tauri.conf.json / package.json). */
export const APP_VERSION = "0.1.0";

/** Destinatario del module di feedback (vedi CLAUDE.md). */
export const FEEDBACK_EMAIL = "gea.watcher@gmail.com";

/** Metadati tecnici allegati al feedback per facilitare il debug. */
export interface FeedbackMetadata {
  /** Lingua UI attiva (es. "it"). */
  language: string;
  /** Tenant/company current, se in sessione. */
  tenantId: string | null;
}

/** Carica un plugin Tauri opzionale; ritorna null se assente o non risolvibile. */
async function loadOptional<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch {
    return null;
  }
}

/** Compone il corpo dell'email: messaggio utente + blocco metadati diagnostici. */
export function buildFeedbackBody(message: string, meta: FeedbackMetadata): string {
  return [
    message.trim(),
    "",
    "—",
    `App: AgroGea v${APP_VERSION}`,
    `Lingua: ${meta.language}`,
    `Workspace: ${meta.tenantId ?? "—"}`,
    `User-Agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "—"}`,
  ].join("\n");
}

/**
 * Apre il client di posta predefinito con un'email precompilata verso
 * {@link FEEDBACK_EMAIL}. Su Tauri usa il plugin opener se available,
 * altrimenti (e sul Web) ricade sulla navigazione `mailto:` del sistema.
 */
export async function sendFeedback(
  message: string,
  meta: FeedbackMetadata,
): Promise<void> {
  const subject = encodeURIComponent(`Feedback AgroGea v${APP_VERSION}`);
  const body = encodeURIComponent(buildFeedbackBody(message, meta));
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;

  if (isTauriRuntime()) {
    const opener = await loadOptional<{ openUrl?: (u: string) => Promise<void> }>(
      "@tauri-apps/plugin-opener",
    );
    if (opener?.openUrl) {
      await opener.openUrl(url);
      return;
    }
  }
  // Web e fallback desktop: il sistema operativo gestisce il protocollo mailto.
  if (typeof window !== "undefined") window.location.href = url;
}

/** Esito del controllo aggiornamenti, consumato dalla UI del menu. */
export type UpdateResult =
  | { status: "available"; version: string }
  | { status: "uptodate" }
  /** Impossibile controllare (Web o updater non installato). */
  | { status: "unavailable" }
  | { status: "error"; message: string };

/**
 * Interroga il sistema di update nativo di Tauri (`@tauri-apps/plugin-updater`).
 * Fuori da Tauri, o se il plugin non è incluso, ritorna `unavailable` senza
 * sollevare eccezioni.
 */
export async function checkForUpdates(): Promise<UpdateResult> {
  if (!isTauriRuntime()) return { status: "unavailable" };
  const updater = await loadOptional<{
    check?: () => Promise<{ available: boolean; version?: string } | null>;
  }>("@tauri-apps/plugin-updater");
  if (!updater?.check) return { status: "unavailable" };
  try {
    const update = await updater.check();
    if (update?.available) {
      return { status: "available", version: update.version ?? "?" };
    }
    return { status: "uptodate" };
  } catch (error) {
    return { status: "error", message: String(error) };
  }
}

/**
 * Notifica push di sistema. Su Tauri usa `plugin-notification` se presente,
 * altrimenti ricade sulla Web Notification API; in entrambi i casi richiede il
 * permesso al primo utilizzo e fallisce in silenzio se negato.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (isTauriRuntime()) {
    const plugin = await loadOptional<{
      isPermissionGranted?: () => Promise<boolean>;
      requestPermission?: () => Promise<string>;
      sendNotification?: (opts: { title: string; body: string }) => void;
    }>("@tauri-apps/plugin-notification");
    if (plugin?.sendNotification) {
      try {
        let granted = (await plugin.isPermissionGranted?.()) ?? false;
        if (!granted && plugin.requestPermission) {
          granted = (await plugin.requestPermission()) === "granted";
        }
        if (granted) {
          plugin.sendNotification({ title, body });
          return;
        }
      } catch {
        /* degrada al canale Web sottostante */
      }
    }
  }

  if (typeof Notification !== "undefined") {
    try {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else if (Notification.permission !== "denied") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") new Notification(title, { body });
      }
    } catch {
      /* notifica non available: la UI mostra comunque l'esito inline */
    }
  }
}
