import { type RefObject, useEffect } from "react";

/**
 * Frecce nei menu: con il focus dentro il contenitore, ↑/↓ passano alla voce
 * precedente/successiva (in giro), Home/End alla prima/ultima. Le voci sono
 * gli elementi che corrispondono a `selector` (di default le `menuitem`),
 * saltando quelle disattivate o nascoste.
 */
export function useMenuKeyboard(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  selector = '[role="menuitem"]',
): void {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = [...root.querySelectorAll<HTMLElement>(selector)].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (items.length === 0) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = 0;
      if (e.key === "End") next = items.length - 1;
      else if (e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
      else if (e.key === "ArrowUp")
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      items[next].focus();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [ref, enabled, selector]);
}
