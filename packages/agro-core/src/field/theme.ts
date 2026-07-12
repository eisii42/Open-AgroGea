/**
 * Temi dell'interfaccia AgroGea: Light, Dark, Agronomic Green.
 *
 * Il tema è applicato come classe sul documentElement (`dark` / `agro-green`)
 * e persistito in localStorage. La classe `dark` è la stessa che GeoLibre
 * osserva per i propri control, quindi i due restano in sincronia. Le funzioni
 * sono guardate per `document`/`localStorage` così il core resta usabile nei
 * test (Node) e nel build web puro.
 */

export type AgroTheme = "light" | "dark" | "green";

const STORAGE_KEY = "agrogea.theme";
const THEMES: readonly AgroTheme[] = ["light", "dark", "green"];

export function loadTheme(): AgroTheme {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw && (THEMES as readonly string[]).includes(raw)) {
      return raw as AgroTheme;
    }
  } catch {
    /* localStorage non available: default */
  }
  return "light";
}

export function persistTheme(theme: AgroTheme): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    /* no-op */
  }
}

/** Applica il tema al documentElement: `dark` per il buio, `agro-green` per il verde. */
export function applyTheme(theme: AgroTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("agro-green", theme === "green");
}
