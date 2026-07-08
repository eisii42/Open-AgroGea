import { isTauriRuntime, useAgroStore } from "@agrogea/core";
import { lazy, Suspense, useEffect, useRef } from "react";
import { UpdateNotice } from "./components/UpdateNotice";
import { FieldDashboard } from "./screens/FieldDashboard";
import { bootstrapStandalone } from "./standalone";

// Data Command Center: caricato on-demand (code-splitting).
const CommandCenter = lazy(() =>
  import("./screens/CommandCenter").then((m) => ({ default: m.CommandCenter })),
);

/** true se il tasto premuto "appartiene" a un campo editabile o alla mappa. */
function isArrowTargetReserved(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable ||
    // Canvas MapLibre focalizzato: le frecce servono al pan della mappa.
    !!el.closest?.(".maplibregl-canvas-container") ||
    el.classList?.contains("maplibregl-canvas")
  );
}

/**
 * Router dell'edizione **Open Source** (standalone, offline).
 *
 * Nessun login né onboarding: si avvia una sessione locale (claims sintetiche
 * + company di default) e si entra dritti nella dashboard. Un'eventuale
 * edizione con servizi remoti fornirebbe il proprio router al posto di questo
 * file (e il proprio `edition.ts`); il layer funzionale (mappa, moduli
 * agronomici, Quaderno, DSS, import/export, auto-update) resta lo stesso.
 *
 * Le due viste (Mappa ↔ Command Center) sono in **keep-alive**: restano
 * entrambe montate e quella inattiva è solo nascosta via CSS
 * (`visibility:hidden`, fuori flusso). Così il canvas MapLibre non viene mai
 * distrutto/ricreato e il rientro sulla mappa è istantaneo, senza ricaricare
 * stile e tile da zero. `visibility` (e non `display:none`) mantiene le
 * dimensioni del canvas → nessun resize/flash al rientro.
 */
export function App() {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const activeView = useAgroStore((s) => s.activeView);
  // Il Command Center si monta alla prima visita e poi resta vivo (lazy +
  // keep-alive): anche i suoi filtri/stato sopravvivono al cambio vista.
  const ccVisited = useRef(false);
  if (activeView === "command-center") ccVisited.current = true;

  // Bootstrap locale al primo render (idempotente).
  useEffect(() => {
    void bootstrapStandalone();
  }, []);

  // Frecce ←/→ (senza modificatori): switch rapido Mappa ↔ Command Center.
  // Inattive nei campi di testo e con il focus sul canvas mappa (dove le
  // frecce fanno il pan). Stesse azioni disponibili nella Command Palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isArrowTargetReserved(e.target)) return;
      const s = useAgroStore.getState();
      const next = e.key === "ArrowRight" ? "command-center" : "map";
      if (s.activeView !== next) s.setActiveView(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Finché il bootstrap non ha impostato l'azienda locale: schermata vuota
  // (frazioni di secondo, tutto in locale).
  if (!activeCompanyId) return null;

  const mapActive = activeView !== "command-center";

  // Banner di auto-update (solo desktop Tauri; no-op su web/PWA).
  return (
    <>
      {isTauriRuntime() && <UpdateNotice />}
      <div className="relative h-full">
        <div
          className={
            mapActive
              ? "h-full"
              : "invisible pointer-events-none absolute inset-0"
          }
          aria-hidden={!mapActive}
        >
          <FieldDashboard key={activeCompanyId} />
        </div>
        {ccVisited.current && (
          <div
            className={
              mapActive
                ? "invisible pointer-events-none absolute inset-0"
                : "h-full"
            }
            aria-hidden={mapActive}
          >
            <Suspense fallback={null}>
              <CommandCenter key={activeCompanyId} />
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}
