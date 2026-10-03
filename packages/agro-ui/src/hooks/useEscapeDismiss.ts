import { useEffect, useRef } from "react";

/**
 * Tasto Esc: chiude SOLO l'elemento aperto più in alto (popover, elenco a
 * comparsa, finestra, pannello laterale), non tutto quello che è a schermo.
 *
 * Ogni elemento aperto si registra in una pila, nell'ordine di apertura; un
 * solo ascoltatore globale serve l'ultimo. Prima ognuno aveva il suo e un Esc
 * con un menu aperto sopra il pannello laterale li chiudeva entrambi.
 *
 * Chi gestisce Esc da sé lo segnala con `preventDefault()` e qui viene
 * ignorato: così fanno i Dialog di @geolibre/ui (Radix, ascoltatore in cattura
 * sul documento, quindi servito prima), il Riquadro comandi e i campi che
 * annullano una modifica con Esc.
 */

interface Entry {
  close: () => void;
}

const stack: Entry[] = [];
let listening = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
  const top = stack.at(-1);
  if (!top) return;
  e.preventDefault();
  top.close();
}

function sync(): void {
  if (stack.length > 0 && !listening) {
    window.addEventListener("keydown", onKeyDown);
    listening = true;
  } else if (stack.length === 0 && listening) {
    window.removeEventListener("keydown", onKeyDown);
    listening = false;
  }
}

export function useEscapeDismiss(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const entry: Entry = { close: () => onCloseRef.current() };
    stack.push(entry);
    sync();
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      sync();
    };
  }, [enabled]);
}
