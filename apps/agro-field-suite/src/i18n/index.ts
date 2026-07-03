import { type AppLocale, loadLocale, persistLocale } from "@agrogea/core";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Infrastruttura i18n della field-suite, allineata al framework nativo di
 * GeoLibre (`apps/geolibre-desktop/src/i18n`): stesso motore `i18next` +
 * `react-i18next`, namespace unico `translation`, cataloghi auto-scoperti.
 *
 * Differenze rispetto al desktop:
 *   * lingue ristrette ai mercati target (en/it/es/fr), governate dal tipo
 *     {@link AppLocale} di `@agrogea/core`;
 *   * la preferenza è persistita dal core (`loadLocale`/`persistLocale`), così
 *     resta coerente con `loadTheme`/`persistTheme` e leggibile dai test.
 *
 * Aggiungere una lingua = lasciare un `locales/<code>.json` accanto a `en.json`
 * (auto-scoperto) ed estendere `AppLocale` nel core.
 */
const catalogModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*.json",
  { eager: true },
);

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, mod] of Object.entries(catalogModules)) {
  const code = path.replace(/^\.\/locales\//, "").replace(/\.json$/, "");
  resources[code] = { translation: mod.default };
}

/** Codici catalogo effettivamente spediti (es. `["en", "es", "fr", "it"]`). */
export const AVAILABLE_LOCALES: string[] = Object.keys(resources).sort();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: loadLocale(),
    fallbackLng: "en",
    defaultNS: "translation",
    // React già escapa i valori renderizzati: il doppio-escape di i18next
    // romperebbe testo che contiene legittimamente `<`, `&`, ecc.
    interpolation: { escapeValue: false },
    // Cataloghi bundlati eagerly (init sincrono): niente Suspense da gestire.
    react: { useSuspense: false },
    returnNull: false,
  })
  .catch((error: unknown) => {
    console.error("[AgroGea] i18n initialization failed", error);
  });

/**
 * Cambia la lingua della UI e ne persiste la preferenza (device/tenant).
 * Centralizza i due passi così i componenti non duplicano la logica.
 */
export function setLocale(locale: AppLocale): void {
  persistLocale(locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
