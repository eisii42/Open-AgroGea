import { useEffect, useState } from "react";

/** Stesso confine del breakpoint `md` di Tailwind: sotto è telefono. */
const NARROW_QUERY = "(max-width: 767px)";

function matches(): boolean {
  return typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches;
}

/**
 * true sotto i 768 px (telefono). Serve ai comportamenti dei fogli che non si
 * esprimono con le sole classi `md:` — trascinamento, altezze a scatti — così
 * sul desktop il drawer resta esattamente com'è.
 */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
