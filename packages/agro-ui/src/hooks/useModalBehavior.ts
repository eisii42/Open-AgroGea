import { type RefObject, useEffect } from "react";
import { useEscapeDismiss } from "./useEscapeDismiss";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Comportamento comune delle finestre fatte a mano (quelle che non usano il
 * Dialog di @geolibre/ui, che ha già tutto questo): lo stesso modello per
 * tutte.
 *
 * - Esc chiude la finestra, e solo lei (`useEscapeDismiss`).
 * - All'apertura il focus entra nella finestra e il Tab gira al suo interno
 *   invece di finire sulla mappa sotto.
 * - Alla chiusura il focus torna dove era (es. il pulsante che l'ha aperta).
 *
 * Il contenitore passato in `ref` dovrebbe avere `role="dialog"` e
 * `aria-modal="true"`.
 */
export function useModalBehavior(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
): void {
  useEscapeDismiss(onClose, enabled);

  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const previous = document.activeElement as HTMLElement | null;

    // Il focus va sulla finestra stessa, non sul primo campo: sul telefono
    // un campo a fuoco aprirebbe la tastiera appena si apre la finestra.
    if (!root.contains(document.activeElement)) {
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      root.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, enabled]);
}
