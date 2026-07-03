/**
 * Rilevamento del runtime nativo (Tauri) e ponte verso i suoi comandi.
 * Modulo neutro senza dipendenze: consumabile da qualsiasi edizione.
 */

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object)
  );
}

/**
 * Invoca un comando Rust di Tauri. Import dinamico: il pacchetto deve
 * funzionare anche nel build web puro, dove @tauri-apps/api non è risolvibile
 * a runtime.
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
