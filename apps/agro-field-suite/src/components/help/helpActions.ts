import { isTauriRuntime } from "@agrogea/core";

/**
 * Azioni native del Menu di Aiuto: versione, link al manuale, feedback via
 * mailto.
 *
 * I link esterni sul desktop passano da `@tauri-apps/plugin-opener` (registrato
 * in `src-tauri/src/lib.rs`, permesso `opener:default`): la WebView di Tauri
 * NON apre nuove finestre, quindi `window.open` lì non fa nulla. Prima il
 * plugin era caricato con uno specifier dinamico `@vite-ignore`, che Vite non
 * include nel bundle: il caricamento falliva sempre e i link del manuale non
 * si aprivano.
 */

/** Versione current del software, iniettata a build-time da `package.json` (vedi vite.config.ts). */
export const APP_VERSION = __APP_VERSION__;

/**
 * Versione reale del software: su Tauri interroga il binario installato
 * (più accurata di `APP_VERSION`, che riflette solo il `package.json` usato
 * in fase di build); fuori da Tauri, o in caso di errore, ricade su
 * {@link APP_VERSION}.
 */
export async function getAppVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      /* fallback sotto */
    }
  }
  return APP_VERSION;
}

const MANUAL_BASE_URL =
  "https://github.com/eisii42/Open-AgroGea/blob/main/docs/user-guide/";

/**
 * Ancore GitHub delle sezioni del manuale richiamate dall'app, per lingua del
 * file (`manuale.md` in italiano, `manual.en.md` per le altre). Vanno
 * aggiornate se cambia il titolo della sezione in docs/user-guide.
 */
const MANUAL_SECTIONS = {
  satelliteIndices: {
    it: "43-modulo-suolo--indici-satellitari-ndvi-e-altri",
    en: "43-soil-module--satellite-indices-ndvi-and-others",
  },
  vra: {
    it: "44-mappe-a-rateo-variabile-vra",
    en: "44-variable-rate-application-maps-vra",
  },
} as const;

export type ManualSection = keyof typeof MANUAL_SECTIONS;

/** URL del manuale utente nella lingua dell'interfaccia, opzionalmente a una sezione. */
export function manualUrl(language: string, section?: ManualSection): string {
  const italian = language.startsWith("it");
  const file = italian ? "manuale.md" : "manual.en.md";
  const anchor = section ? MANUAL_SECTIONS[section][italian ? "it" : "en"] : null;
  return `${MANUAL_BASE_URL}${file}${anchor ? `#${anchor}` : ""}`;
}

/** Destinatario del module di feedback (vedi CLAUDE.md). */
export const FEEDBACK_EMAIL = "gea.watcher@gmail.com";

/** Metadati tecnici allegati al feedback per facilitare il debug. */
export interface FeedbackMetadata {
  /** Lingua UI attiva (es. "it"). */
  language: string;
  /** Tenant/company current, se in sessione. */
  tenantId: string | null;
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
 * Su Tauri affida l'URL al sistema operativo (browser o client di posta
 * predefinito). Ritorna false fuori da Tauri o se l'apertura fallisce, così il
 * chiamante ricade sul meccanismo web.
 */
async function openWithSystem(url: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch (error) {
    console.error("Apertura del link esterno fallita.", error);
    return false;
  }
}

/**
 * Apre un URL esterno (link web, `mailto:`, ecc.). Su Tauri usa il plugin
 * opener; sul Web (o se il plugin fallisce) una nuova scheda.
 */
export async function openExternal(url: string): Promise<void> {
  if (await openWithSystem(url)) return;
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
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

  if (await openWithSystem(url)) return;
  // Web e fallback desktop: il sistema operativo gestisce il protocollo mailto.
  if (typeof window !== "undefined") window.location.href = url;
}
