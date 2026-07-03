import { isTauriRuntime, useAgroStore } from "@agrogea/core";
import { lazy, Suspense, useEffect } from "react";
import { UpdateNotice } from "./components/UpdateNotice";
import { FieldDashboard } from "./screens/FieldDashboard";
import { bootstrapStandalone } from "./standalone";

// Data Command Center: caricato on-demand (code-splitting).
const CommandCenter = lazy(() =>
  import("./screens/CommandCenter").then((m) => ({ default: m.CommandCenter })),
);

/**
 * Router dell'edizione **Open Source** (standalone, offline).
 *
 * Nessun login né onboarding: si avvia una sessione locale (claims sintetiche
 * + azienda di default) e si entra dritti nella dashboard. Un'eventuale
 * edizione con servizi remoti fornirebbe il proprio router al posto di questo
 * file (e il proprio `edition.ts`); il layer funzionale (mappa, moduli
 * agronomici, Quaderno, DSS, import/export, auto-update) resta lo stesso.
 */
export function App() {
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const activeView = useAgroStore((s) => s.activeView);

  // Bootstrap locale al primo render (idempotente).
  useEffect(() => {
    void bootstrapStandalone();
  }, []);

  // Finché il bootstrap non ha impostato l'azienda locale: schermata vuota
  // (frazioni di secondo, tutto in locale).
  if (!aziendaAttivaId) return null;

  const mainView =
    activeView === "command-center" ? (
      <Suspense fallback={null}>
        <CommandCenter key={aziendaAttivaId} />
      </Suspense>
    ) : (
      <FieldDashboard key={aziendaAttivaId} />
    );

  // Banner di auto-update (solo desktop Tauri; no-op su web/PWA).
  return (
    <>
      {isTauriRuntime() && <UpdateNotice />}
      {mainView}
    </>
  );
}
