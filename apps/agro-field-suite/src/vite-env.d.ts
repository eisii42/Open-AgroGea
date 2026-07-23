/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build standalone/OSS: `"true"` avvia una sessione locale su un'azienda
   * fissa, senza onboarding. Vedi `src/standalone.ts`.
   */
  readonly VITE_STANDALONE_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versione dell'app, iniettata a build-time da `vite.config.ts` (define). */
declare const __APP_VERSION__: string;
