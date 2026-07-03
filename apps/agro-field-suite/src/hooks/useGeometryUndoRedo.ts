import { useAgroStore } from "@agrogea/core";
import { useCallback, useEffect } from "react";

/**
 * Undo/Redo delle modifiche geometriche, DAL-aware.
 *
 * GeoLibre core ha un undo/redo nativo (zundo `useAppStore.temporal`), ma traccia
 * i LAYER: nel modello agro la verità è in PGlite (i layer sono solo proiezione),
 * quindi annullarlo a livello layer desincronizzerebbe layer↔DB. Qui l'undo/redo
 * opera sullo store agronomico: riapplica al DAL la geometria PRIMA/DOPO ogni
 * salvataggio (vedi `undoGeometria`/`redoGeometria` + le pile in `@agrogea/core`),
 * e il layer si riproietta da sé. Scorciatoie Ctrl/Cmd+Z (annulla),
 * Ctrl/Cmd+Shift+Z o Ctrl+Y (ripristina), inattive nei campi di testo.
 */
export interface UndoRedoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function useGeometryUndoRedo(): UndoRedoApi {
  const canUndo = useAgroStore((s) => s.geometryUndo.length > 0);
  const canRedo = useAgroStore((s) => s.geometryRedo.length > 0);
  const undoGeometria = useAgroStore((s) => s.undoGeometria);
  const redoGeometria = useAgroStore((s) => s.redoGeometria);

  const undo = useCallback(() => {
    void undoGeometria();
  }, [undoGeometria]);
  const redo = useCallback(() => {
    void redoGeometria();
  }, [redoGeometria]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo =
        (key === "z" && e.shiftKey) ||
        (key === "y" && e.ctrlKey && !e.shiftKey);
      if (!isUndo && !isRedo) return;
      if (isEditableTarget(e.target)) return;
      const s = useAgroStore.getState();
      if (isUndo && s.geometryUndo.length > 0) {
        e.preventDefault();
        void s.undoGeometria();
      } else if (isRedo && s.geometryRedo.length > 0) {
        e.preventDefault();
        void s.redoGeometria();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { canUndo, canRedo, undo, redo };
}
