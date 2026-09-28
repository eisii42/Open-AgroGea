import { useEffect, useState } from "react";

/**
 * Gruppo `maplibregl-ctrl-group` AgroGea in TESTA alla colonna dei controlli
 * MapLibre (in alto a destra): restituisce l'elemento host su cui fare il
 * portal dei bottoni (Livelli, Misura, Wayback), che così ereditano la veste
 * dei controlli nativi (vedi index.css).
 *
 * MapLibre appende in fondo ciò che rimonta (es. il gestore livelli a ogni
 * cambio dei layer): un osservatore rimette il gruppo sempre al primo posto.
 * Usato sia dal telefono (`MobileMapTools`) sia dal desktop (`DesktopMapTools`).
 */
export function useTopRightControlGroup(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(
      ".agro-field-map .maplibregl-ctrl-top-right",
    );
    if (!container) return;
    const group = document.createElement("div");
    group.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const place = () => {
      if (container.firstElementChild !== group) container.prepend(group);
    };
    place();
    setHost(group);
    const keepFirst = new MutationObserver(place);
    keepFirst.observe(container, { childList: true });
    return () => {
      keepFirst.disconnect();
      group.remove();
      setHost(null);
    };
  }, []);

  return host;
}
