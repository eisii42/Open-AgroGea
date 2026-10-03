import { isTauriRuntime } from "@agrogea/core";
import { useEffect, useRef } from "react";

/**
 * Tasto "indietro" di Android: chiude il foglio aperto più in alto, invece di
 * uscire dall'app o di non fare nulla.
 *
 * Si usa l'evento nativo di Tauri (`onBackButtonPress`) e NON la cronologia del
 * browser: con `pushState`/`history.back()` la pila dei fogli e quella della
 * cronologia si disallineano appena un foglio si chiude da interfaccia (e in
 * sviluppo StrictMode monta/smonta due volte). Il listener si registra SOLO
 * finché c'è almeno un foglio aperto: registrato, Tauri sopprime il
 * comportamento di sistema, quindi a fogli chiusi va tolto perché "indietro"
 * torni a chiudere l'app come ci si aspetta.
 *
 * Fuori da Tauri Android non fa nulla.
 */

interface Entry {
  close: () => void;
}

const stack: Entry[] = [];
let unlisten: (() => void) | null = null;
let registering = false;

function isAndroidTauri(): boolean {
  return (
    isTauriRuntime() &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android")
  );
}

async function syncListener(): Promise<void> {
  if (stack.length > 0 && !unlisten && !registering) {
    registering = true;
    try {
      const { onBackButtonPress } = await import("@tauri-apps/api/app");
      const listener = await onBackButtonPress(() => {
        stack.at(-1)?.close();
      });
      unlisten = () => void listener.unregister();
    } catch (error) {
      console.error("Tasto indietro: registrazione fallita.", error);
    } finally {
      registering = false;
    }
    // Nel frattempo i fogli potrebbero essersi chiusi tutti.
    if (stack.length === 0) void syncListener();
  } else if (stack.length === 0 && unlisten) {
    unlisten();
    unlisten = null;
  }
}

export function useBackDismiss(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled || !isAndroidTauri()) return;
    const entry: Entry = { close: () => onCloseRef.current() };
    stack.push(entry);
    void syncListener();
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      void syncListener();
    };
  }, [enabled]);
}
