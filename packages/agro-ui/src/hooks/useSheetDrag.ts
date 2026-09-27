import { type PointerEvent, useRef, useState } from "react";

/** Oltre questa soglia (px) il gesto è un trascinamento, non un tocco. */
const DRAG_THRESHOLD = 6;

export interface SheetDragOptions {
  enabled: boolean;
  /** Altezza del foglio all'inizio del gesto. */
  getHeight: () => number;
  /** Altezza corrente mentre si trascina (il foglio la segue col dito). */
  onDrag: (height: number) => void;
  /** Fine del gesto: altezza raggiunta e velocità (px/ms, positiva verso il basso). */
  onRelease: (height: number, velocity: number) => void;
}

export interface SheetDrag {
  /** Da applicare alla maniglia/intestazione del foglio. */
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  };
  dragging: boolean;
  /**
   * true se l'ultimo gesto era un trascinamento: il click che il browser
   * genera subito dopo va ignorato (non è un tocco sulla maniglia).
   */
  consumeDrag: () => boolean;
}

/**
 * Trascinamento verticale di un bottom sheet dalla sua maniglia: il foglio
 * segue il dito e al rilascio il chiamante sceglie l'altezza a cui fermarlo (o
 * lo chiude). Solo pointer events, nessuna libreria: vale per dito e mouse.
 * Il contenuto scorrevole non è coinvolto, quindi scroll e trascinamento non
 * si contendono il gesto.
 */
export function useSheetDrag(options: SheetDragOptions): SheetDrag {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const gesture = useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);
  const draggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const heightFor = (
    g: { startY: number; startHeight: number },
    clientY: number,
  ) => Math.max(0, g.startHeight - (clientY - g.startY));

  const finish = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!g.active) return;
    setDragging(false);
    if (!cancelled) optionsRef.current.onRelease(heightFor(g, e.clientY), g.velocity);
    else optionsRef.current.onRelease(g.startHeight, 0);
  };

  return {
    dragging,
    consumeDrag: () => {
      const was = draggedRef.current;
      draggedRef.current = false;
      return was;
    },
    handlers: {
      onPointerDown: (e) => {
        if (!optionsRef.current.enabled || e.button !== 0) return;
        draggedRef.current = false;
        gesture.current = {
          startY: e.clientY,
          startHeight: optionsRef.current.getHeight(),
          lastY: e.clientY,
          lastTime: e.timeStamp,
          velocity: 0,
          active: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e) => {
        const g = gesture.current;
        if (!g) return;
        if (!g.active) {
          if (Math.abs(e.clientY - g.startY) < DRAG_THRESHOLD) return;
          g.active = true;
          draggedRef.current = true;
          setDragging(true);
        }
        const dt = e.timeStamp - g.lastTime;
        if (dt > 0) g.velocity = (e.clientY - g.lastY) / dt;
        g.lastY = e.clientY;
        g.lastTime = e.timeStamp;
        optionsRef.current.onDrag(heightFor(g, e.clientY));
      },
      onPointerUp: (e) => finish(e, false),
      onPointerCancel: (e) => finish(e, true),
    },
  };
}
