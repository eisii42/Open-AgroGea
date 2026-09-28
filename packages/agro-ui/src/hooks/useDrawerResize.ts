import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";

/** Larghezza di default del drawer laterale (desktop), in px. */
export const DRAWER_DEFAULT_WIDTH = 380;
export const DRAWER_MIN_WIDTH = 360;
export const DRAWER_MAX_WIDTH = 560;
/** Mappa che resta comunque visibile a sinistra del drawer. */
const MIN_MAP_WIDTH = 320;
const KEY_STEP = 20;
const STORAGE_KEY = "agrogea.drawerWidth";
const CSS_VAR = "--agro-drawer-w";

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // storage non disponibile (finestra privata, anteprime)
  }
  return DRAWER_DEFAULT_WIDTH;
}

function store(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignora: la larghezza vale comunque per la sessione
  }
}

/** Applica la larghezza a tutta l'app: la usano il drawer e il CSS della mappa. */
function applyWidth(width: number): void {
  document.documentElement.style.setProperty(CSS_VAR, `${width}px`);
}

function clamp(width: number, containerWidth: number): number {
  const max = Math.max(
    DRAWER_MIN_WIDTH,
    Math.min(DRAWER_MAX_WIDTH, containerWidth - MIN_MAP_WIDTH),
  );
  return Math.round(Math.min(max, Math.max(DRAWER_MIN_WIDTH, width)));
}

export interface DrawerResize {
  width: number;
  dragging: boolean;
  /** Da spalmare sulla maniglia (bordo sinistro del drawer). */
  handleProps: {
    role: "separator";
    "aria-orientation": "vertical";
    "aria-valuemin": number;
    "aria-valuemax": number;
    "aria-valuenow": number;
    tabIndex: 0;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * Larghezza del drawer laterale desktop, ridimensionabile trascinandone il
 * bordo sinistro (360–560 px, e mai tanto da lasciare meno di 320 px di mappa).
 * Il valore vive nella variabile CSS `--agro-drawer-w` su <html>: la legge il
 * drawer stesso e la leggono le regole della mappa che spostano controlli e
 * overlay alla sua sinistra (index.css). Si ricorda fra le sessioni; doppio
 * clic sulla maniglia torna alla larghezza di default, le frecce la cambiano
 * da tastiera.
 */
export function useDrawerResize(enabled: boolean): DrawerResize {
  const [width, setWidth] = useState(readStored);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (enabled) applyWidth(width);
  }, [enabled, width]);

  const containerWidth = (el: HTMLElement) =>
    el.closest("section")?.parentElement?.clientWidth ?? window.innerWidth;

  const commit = (next: number) => {
    setWidth(next);
    store(next);
  };

  const fromPointer = (e: ReactPointerEvent<HTMLElement>) => {
    const parent = e.currentTarget.closest("section")?.parentElement;
    const right = parent?.getBoundingClientRect().right ?? window.innerWidth;
    return clamp(right - e.clientX, containerWidth(e.currentTarget));
  };

  return {
    width,
    dragging,
    handleProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuemin": DRAWER_MIN_WIDTH,
      "aria-valuemax": DRAWER_MAX_WIDTH,
      "aria-valuenow": width,
      tabIndex: 0,
      onPointerDown: (e) => {
        if (!enabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      },
      onPointerMove: (e) => {
        if (!dragging) return;
        setWidth(fromPointer(e));
      },
      onPointerUp: (e) => {
        if (!dragging) return;
        setDragging(false);
        commit(fromPointer(e));
      },
      onPointerCancel: () => setDragging(false),
      onDoubleClick: () => commit(DRAWER_DEFAULT_WIDTH),
      onKeyDown: (e) => {
        const step =
          e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
        if (step === 0) return;
        e.preventDefault();
        commit(clamp(width + step, containerWidth(e.currentTarget)));
      },
    },
  };
}
