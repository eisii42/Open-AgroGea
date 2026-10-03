import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Fogli del telefono aperti dall'header (meteo, "Da risolvere"): si montano
 * nell'area sopra la barra in basso (`#agro-sheet-host`, App.tsx), come il
 * foglio Moduli. Dentro l'header resterebbero coperti dalla barra.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  const host =
    typeof document === "undefined"
      ? null
      : (document.getElementById("agro-sheet-host") ?? document.body);
  return host ? createPortal(children, host) : null;
}
