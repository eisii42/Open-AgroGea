import { cn } from "@geolibre/ui";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { useBackDismiss } from "../hooks/useBackDismiss";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { useSheetDrag } from "../hooks/useSheetDrag";

/**
 * Pannello della Modalità Campo: sotto i 768px è un bottom-sheet (uso a una
 * mano), da tablet/desktop in su è un drawer docked a destra sopra la mappa. È
 * la shell condivisa di tutti i popup funzionali (Quaderno, GeoEditor, NDVI,
 * VRA, DSS).
 *
 * Sul telefono il foglio ha tre altezze — solo intestazione, metà, tutto
 * schermo — e si trascina dalla maniglia: segue il dito e al rilascio si
 * aggancia all'altezza più vicina (un colpo veloce passa alla successiva);
 * trascinato sotto l'intestazione si chiude. Il tasto indietro di Android lo
 * chiude (vedi `useBackDismiss`). Sul desktop nulla di tutto questo: il drawer
 * resta com'era.
 */

export interface FieldSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Azione primaria fissa in basso (es. "Nuovo record"), sempre raggiungibile col pollice. */
  footer?: ReactNode;
  className?: string;
  /**
   * true → scheda a TUTTO SCHERMO (overlay), invece del drawer laterale: i form
   * ampi (es. nuovo product del Magazzino) hanno così più spazio e chiarezza. In
   * questa modalità il collasso a maniglia del bottom-sheet è disattivato.
   */
  wide?: boolean;
}

/** Altezze del foglio sul telefono. */
type Snap = "collapsed" | "half" | "full";
const SNAP_ORDER: readonly Snap[] = ["collapsed", "half", "full"];
/** "Metà": frazione dell'area mappa. */
const HALF_RATIO = 0.6;
/** Sopra questa frazione il rilascio aggancia "tutto schermo". */
const FULL_THRESHOLD = 0.8;
/** Colpo veloce (px/ms): passa all'altezza successiva nella direzione del gesto. */
const FLICK_VELOCITY = 0.5;

export function FieldSheet({
  title,
  onClose,
  children,
  footer,
  className,
  wide = false,
}: FieldSheetProps) {
  const narrow = useNarrowViewport();
  // Desktop: il tocco sul titolo alterna il collasso (comportamento storico).
  const [collapsed, setCollapsed] = useState(false);
  // Telefono: altezza a scatti e, durante il gesto, altezza libera.
  const [snap, setSnap] = useState<Snap>("half");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const sheetMode = narrow && !wide;
  const showCollapsed = sheetMode ? snap === "collapsed" : collapsed && !wide;

  useBackDismiss(onClose, narrow);

  const parentHeight = () =>
    sectionRef.current?.parentElement?.clientHeight ?? window.innerHeight;
  const headerHeight = () => headerRef.current?.offsetHeight ?? 56;

  const drag = useSheetDrag({
    enabled: sheetMode,
    getHeight: () => sectionRef.current?.getBoundingClientRect().height ?? 0,
    onDrag: (height) => setDragHeight(Math.min(height, parentHeight())),
    onRelease: (height, velocity) => {
      setDragHeight(null);
      const header = headerHeight();
      const full = parentHeight();
      // Trascinato sotto l'intestazione, o un colpo verso il basso da chiuso.
      if (
        height < header * 0.6 ||
        (snap === "collapsed" && velocity > FLICK_VELOCITY)
      ) {
        onClose();
        return;
      }
      const index = SNAP_ORDER.indexOf(snap);
      if (velocity > FLICK_VELOCITY) {
        setSnap(SNAP_ORDER[Math.max(0, index - 1)]);
      } else if (velocity < -FLICK_VELOCITY) {
        setSnap(SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, index + 1)]);
      } else if (height > full * FULL_THRESHOLD) {
        setSnap("full");
      } else if (height < header + 48) {
        setSnap("collapsed");
      } else {
        setSnap("half");
      }
    },
  });

  // Tocco sulla maniglia: sale di un'altezza (da tutto schermo torna a metà).
  const onHandleTap = () => {
    if (drag.consumeDrag()) return;
    setSnap((s) => (s === "collapsed" ? "half" : s === "half" ? "full" : "half"));
  };

  const sheetStyle: CSSProperties | undefined = !sheetMode
    ? undefined
    : dragHeight != null
      ? { height: dragHeight, maxHeight: "none" }
      : snap === "full"
        ? { height: "calc(100% - 8px)", maxHeight: "none" }
        : snap === "half"
          ? { maxHeight: `${HALF_RATIO * 100}%` }
          : { maxHeight: "none" };

  return (
    <section
      ref={sectionRef}
      style={sheetStyle}
      className={cn(
        "z-40 flex flex-col border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]",
        wide
          ? // Tutto schermo: overlay pieno su mobile, quasi-pieno (con margine)
            // da tablet in su. Niente collasso a maniglia.
            "fixed inset-0 rounded-none md:inset-6 md:rounded-[var(--r-3)]"
          : cn(
              // Mobile: bottom sheet a tutta larghezza. z-40 (non z-30) per stare
              // SOPRA la tab bar mobile fissa di FieldDashboard (anch'essa z-30,
              // renderizzata dopo in ordine DOM): altrimenti a parità di z-index
              // la tab bar vinceva lo stacking e copriva il footer/pulsante save.
              "absolute inset-x-0 bottom-0 rounded-t-[var(--r-3)]",
              showCollapsed ? "max-h-14" : "max-h-[70dvh]",
              // Telefono: le altezze arrivano dallo style; si anima il cambio di
              // scatto, non il trascinamento (il foglio deve seguire il dito).
              sheetMode && !drag.dragging && "transition-[height,max-height] duration-200 ease-out",
              // Telefono: all'apertura il foglio sale dal basso (tokens.css).
              sheetMode && "agro-sheet-enter",
              // ≥ md: drawer docked a destra, altezza piena.
              "md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px]",
              "md:rounded-none md:rounded-l-[var(--r-3)] md:border-y-0 md:border-r-0",
            ),
        className,
      )}
    >
      <header ref={headerRef} className="shrink-0 border-b border-[var(--line)]">
        {/* Maniglia centrata (telefono): trascina per cambiare altezza o
            chiudere, tocca per salire di un'altezza. */}
        {sheetMode && (
          <div
            role="button"
            tabIndex={0}
            aria-label={title}
            onClick={onHandleTap}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onHandleTap();
            }}
            {...drag.handlers}
            className="flex h-5 cursor-grab touch-none items-end justify-center"
          >
            <span className="block h-1.5 w-10 rounded-full bg-[var(--line-2)]" />
          </div>
        )}
        <div className="flex items-center gap-1 px-3">
          <button
            type="button"
            className={cn(
              "flex min-h-[var(--touch-min)] flex-1 items-center gap-2 text-left md:cursor-default",
              sheetMode && "touch-none",
            )}
            {...(sheetMode ? drag.handlers : {})}
            onClick={() => {
              if (sheetMode) {
                if (drag.consumeDrag()) return;
                // Tocco sul titolo: riduce all'intestazione o riapre a metà.
                setSnap((s) => (s === "collapsed" ? "half" : "collapsed"));
                return;
              }
              if (!wide) setCollapsed((c) => !c);
            }}
          >
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
        </div>
      </header>

      {!showCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {/* In modalità wide il contenuto è centrato e limitato in larghezza
              per restare leggibile anche su schermi molto ampi. */}
          <div className={wide ? "mx-auto w-full max-w-3xl" : undefined}>
            {children}
          </div>
        </div>
      )}

      {!showCollapsed && footer && (
        <footer className="border-t border-[var(--line)] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </section>
  );
}
