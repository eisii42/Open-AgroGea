import { cn } from "@geolibre/ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Altezza massima come stringa CSS (default: 80dvh). */
  maxHeight?: string;
  className?: string;
}

/**
 * Pannello mobile che scivola dal bordo inferiore dello schermo.
 * Sostituisce i drawer laterali sui viewport stretti (<768 px).
 *
 * Usato da FieldDashboard per avvolgere i pannelli agronomici quando
 * `usePlatform().isMobile` è true: la mappa rimane a tutto schermo e
 * il pannello si sovrappone come sheet scrollabile dal basso.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "80dvh",
  className,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop semitrasparente: tap fuori chiude lo sheet. */}
      <div
        className={cn(
          "absolute inset-0 z-30 bg-black/40 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />

      {/* Sheet: scorre fuori schermo via translateY quando closed. */}
      <div
        style={{ maxHeight }}
        className={cn(
          "absolute bottom-0 left-0 right-0 z-40 overflow-y-auto rounded-t-2xl border-t border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)] transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full",
          className,
        )}
      >
        {/* Handle visivo drag (decorativo) */}
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[var(--line)]" />

        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <span className="text-sm font-semibold">{title}</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 hover:bg-[var(--panel-2)]"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {children}
      </div>
    </>
  );
}
