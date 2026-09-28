import { useCallback, useSyncExternalStore } from "react";

/**
 * true finché la media query è soddisfatta (es. "(min-width: 1280px)"), e si
 * aggiorna al ridimensionamento della finestra. Fuori dal browser: false.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
