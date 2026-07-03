/**
 * Lingua dell'interfaccia AgroGea: en, it, es, fr.
 *
 * La lingua è persistita in localStorage (preferenza di device/tenant) e letta
 * all'avvio dal layer i18n della UI. Le funzioni sono guardate per
 * `localStorage`/`navigator` così il core resta usabile nei test (Node) e nel
 * build web puro. Stesso pattern di {@link ./theme}.
 */

export type AppLocale = "en" | "it" | "es" | "fr";

export const APP_LOCALES: readonly AppLocale[] = ["en", "it", "es", "fr"];

export const DEFAULT_LOCALE: AppLocale = "en";

const STORAGE_KEY = "agrogea.locale";

function isLocale(v: string): v is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(v);
}

/** Lingua del browser ridotta al codice base (es. "it-IT" -> "it"), se supportata. */
function browserLocale(): AppLocale | null {
  try {
    const nav = globalThis.navigator?.language?.slice(0, 2).toLowerCase();
    return nav && isLocale(nav) ? nav : null;
  } catch {
    return null;
  }
}

/**
 * Lingua persistita; se assente, ricade sulla lingua del browser (se supportata)
 * e infine su {@link DEFAULT_LOCALE}.
 */
export function loadLocale(): AppLocale {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw && isLocale(raw)) return raw;
  } catch {
    /* localStorage non disponibile */
  }
  return browserLocale() ?? DEFAULT_LOCALE;
}

export function persistLocale(locale: AppLocale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    /* no-op */
  }
}
