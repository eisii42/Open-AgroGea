import { cn } from "@geolibre/ui";
import { type ReactNode, useState } from "react";

/**
 * Pannello della Modalità Campo: sotto i 768px è un bottom-sheet collassabile
 * (uso a una mano, maniglia di trascinamento ampia), da tablet/desktop in su
 * è un drawer docked a destra sopra la mappa. È la shell condivisa di tutti i
 * popup funzionali (Quaderno, GeoEditor, NDVI, VRA, DSS).
 */

export interface FieldSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Azione primaria fissa in basso (es. "Nuovo record"), sempre raggiungibile col pollice. */
  footer?: ReactNode;
  className?: string;
}

export function FieldSheet({
  title,
  onClose,
  children,
  footer,
  className,
}: FieldSheetProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={cn(
        // Mobile: bottom sheet a tutta larghezza. z-40 (non z-30) per stare
        // SOPRA la tab bar mobile fissa di FieldDashboard (anch'essa z-30,
        // renderizzata dopo in ordine DOM): altrimenti a parità di z-index la
        // tab bar vinceva lo stacking e copriva il footer/pulsante salva.
        "absolute inset-x-0 bottom-0 z-40 flex flex-col rounded-t-[var(--r-3)]",
        "border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]",
        collapsed ? "max-h-14" : "max-h-[70dvh]",
        // ≥ md: drawer docked a destra, altezza piena.
        "md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px]",
        "md:rounded-none md:rounded-l-[var(--r-3)] md:border-y-0 md:border-r-0",
        className,
      )}
    >
      <header className="flex items-center gap-1 border-b border-[var(--line)] px-3">
        {/* Maniglia/collasso: solo mobile, target 44px pieni. */}
        <button
          type="button"
          className="flex min-h-[var(--touch-min)] flex-1 items-center gap-2 text-left md:cursor-default"
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-[var(--line-2)] md:hidden" />
          <h2 className="flex-1 truncate text-[15px] font-semibold text-[var(--ink)]">
            {title}
          </h2>
        </button>
        <button
          type="button"
          aria-label="Chiudi pannello"
          onClick={onClose}
          className="flex min-h-[var(--touch-min)] min-w-[var(--touch-min)] items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] active:bg-[var(--panel-2)]"
        >
          ✕
        </button>
      </header>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto overscroll-contain p-3">
          {children}
        </div>
      )}

      {!collapsed && footer && (
        <footer className="border-t border-[var(--line)] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </section>
  );
}
