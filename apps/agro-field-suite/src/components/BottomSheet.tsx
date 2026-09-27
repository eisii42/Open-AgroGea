import { useBackDismiss, useSheetDrag } from "@agrogea/ui";
import { cn } from "@geolibre/ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Altezza massima come stringa CSS (default: 80dvh). */
  maxHeight?: string;
  className?: string;
}

/** Trascinato oltre questa distanza (px) verso il basso, il foglio si chiude. */
const CLOSE_DISTANCE = 80;
/** Oppure con un colpo veloce verso il basso (px/ms). */
const CLOSE_VELOCITY = 0.5;

/**
 * Pannello mobile che scivola dal bordo inferiore dello schermo (fogli
 * "Moduli" e "Livelli" del telefono).
 *
 * Si chiude toccando fuori, con la X, trascinando giù la maniglia o
 * l'intestazione, e col tasto indietro di Android (`useBackDismiss`), come i
 * pannelli `FieldSheet`.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "80dvh",
  className,
}: BottomSheetProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const startHeight = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  useBackDismiss(onClose, open);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const drag = useSheetDrag({
    enabled: open,
    getHeight: () => {
      startHeight.current = sheetRef.current?.getBoundingClientRect().height ?? 0;
      return startHeight.current;
    },
    // Il foglio segue il dito solo verso il basso: sopra la sua altezza non va.
    onDrag: (height) => setDragOffset(Math.max(0, startHeight.current - height)),
    onRelease: (height, velocity) => {
      setDragOffset(0);
      const offset = startHeight.current - height;
      if (offset > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) onClose();
    },
  });

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
        ref={sheetRef}
        style={{
          maxHeight,
          ...(dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : {}),
        }}
        className={cn(
          "absolute bottom-0 left-0 right-0 z-40 overflow-y-auto rounded-t-2xl border-t border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]",
          !drag.dragging && "transition-transform duration-300 ease-out",
          open ? "translate-y-0" : "translate-y-full",
          className,
        )}
      >
        {/* Maniglia e intestazione: trascinandole giù il foglio si chiude. */}
        <div
          {...drag.handlers}
          onClickCapture={(e) => {
            if (drag.consumeDrag()) e.stopPropagation();
          }}
          className="sticky top-0 z-10 touch-none bg-[var(--panel)]"
        >
          <div className="flex h-5 items-end justify-center">
            <span className="block h-1.5 w-10 rounded-full bg-[var(--line)]" />
          </div>

          {title && (
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2">
              <span className="text-sm font-semibold">{title}</span>
              <button
                type="button"
                onClick={onClose}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex h-11 w-11 items-center justify-center rounded-[var(--r-2)] hover:bg-[var(--panel-2)]"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        {children}
        {/* Spazio per la barra di navigazione di sistema (Android edge-to-edge,
            iPhone con home indicator): l'ultima voce non deve finirci sotto. */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    </>
  );
}
