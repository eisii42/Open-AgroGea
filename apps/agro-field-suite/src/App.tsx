import { type AppView, isTauriRuntime, useAgroStore } from "@agrogea/core";
import { lazy, Suspense, useEffect, useRef } from "react";
import { UpdateNotice } from "./components/UpdateNotice";
import { InFieldDashboard } from "./modules/field-mode/InFieldDashboard";
import { PostOperationSummary } from "./modules/field-mode/PostOperationSummary";
import { FieldDashboard } from "./screens/FieldDashboard";
import { bootstrapStandalone } from "./standalone";

// Data Command Center e Calendario: caricati on-demand (code-splitting).
const CommandCenter = lazy(() =>
  import("./screens/CommandCenter").then((m) => ({ default: m.CommandCenter })),
);
const CalendarScreen = lazy(() =>
  import("./modules/calendar/CalendarScreen").then((m) => ({
    default: m.CalendarScreen,
  })),
);

/** true se il tasto premuto "appartiene" a un field editabile o alla mappa. */
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
 * Le tre viste (Mappa ↔ Calendario ↔ Command Center) sono in **keep-alive**:
 * restano montate e quelle inattive sono solo nascoste via CSS
 * (`visibility:hidden`, fuori flusso). Così il canvas MapLibre non viene mai
 * distrutto/ricreato e il rientro sulla mappa è istantaneo, senza ricaricare
 * stile e tile da zero. `visibility` (e non `display:none`) mantiene le
 * dimensioni del canvas → nessun resize/flash al rientro.
 */
export function App() {
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const activeView = useAgroStore((s) => s.activeView);
  // Command Center e Calendario si montano alla prima visita e poi restano vivi
  // (lazy + keep-alive): anche i loro filters/stato sopravvivono al cambio vista.
  const ccVisited = useRef(false);
  if (activeView === "command-center") ccVisited.current = true;
  const calendarVisited = useRef(false);
  if (activeView === "calendar") calendarVisited.current = true;

  // Bootstrap locale al primo render (idempotente).
  useEffect(() => {
    void bootstrapStandalone();
  }, []);

  // Frecce ←/→ (senza modificatori): scorrono le tre viste nell'ordine
  // Mappa → Calendario → Command Center. Inattive nei campi di testo e con il
  // focus sul canvas mappa (dove le frecce fanno il pan). Stesse azioni
  // disponibili nella Command Palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isArrowTargetReserved(e.target)) return;
      const s = useAgroStore.getState();
      const order: AppView[] = ["map", "calendar", "command-center"];
      const current = order.indexOf(s.activeView);
      const next =
        order[
          Math.min(
            order.length - 1,
            Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1)),
          )
        ];
      if (s.activeView !== next) s.setActiveView(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Finché il bootstrap non ha impostato l'azienda locale: schermata vuota
  // (frazioni di secondo, tutto in locale).
  if (!activeCompanyId) return null;

  const mapActive = activeView === "map";

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
        {calendarVisited.current && (
          <div
            className={
              activeView === "calendar"
                ? "h-full"
                : "invisible pointer-events-none absolute inset-0"
            }
            aria-hidden={activeView !== "calendar"}
          >
            <Suspense fallback={null}>
              <CalendarScreen key={activeCompanyId} />
            </Suspense>
          </div>
        )}
        {ccVisited.current && (
          <div
            className={
              activeView === "command-center"
                ? "h-full"
                : "invisible pointer-events-none absolute inset-0"
            }
            aria-hidden={activeView !== "command-center"}
          >
            <Suspense fallback={null}>
              <CommandCenter key={activeCompanyId} />
            </Suspense>
          </div>
        )}
        {/* Modalità Campo: schermo low-touch a bordo campo, sopra Mappa E
            Command Center (z-index massimo). Si monta da sé quando lo store
            ha una sessione active (IN_PROGRESS/PAUSED): nessun costo quando
            non c'è nulla in corso. */}
        <InFieldDashboard />
        {/* Riepilogo post-operazione: NOTIFICA di ciò che è stato registrato
            nel Quaderno (la scrittura è già avvenuta, a zero tocchi). Montato
            qui accanto alla dashboard perché la sessione, appena COMPLETED,
            non è più "attiva" e l'InFieldDashboard si smonta. */}
        <PostOperationSummary />
      </div>
    </>
  );
}
