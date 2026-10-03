import { type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { DrawerSlotContext } from "./drawer-stack";
import { FieldSheet } from "./FieldSheet";

/**
 * Pila dei pannelli laterali sul desktop: più moduli aperti insieme nella
 * colonna di destra (FieldDashboard, `.agro-drawer-dock`).
 *
 * - Ogni FieldSheet che si apre riceve un numero d'ordine crescente e lo
 *   annuncia: gli altri si riducono all'intestazione e il nuovo sta in cima.
 * - "Porta in primo piano" (`requestDrawerFocus`): il pannello del modulo già
 *   aperto si espande e torna in cima, invece di chiudersi o restare ridotto.
 *   Per sapere a quale modulo appartiene, il FieldSheet legge l'id dal
 *   `DrawerSlot` che lo avvolge.
 * - Ogni modulo ha il suo Suspense: mentre il codice del pannello si carica
 *   compare un pannello "Caricamento…" al suo posto, e gli altri pannelli
 *   aperti restano dove sono (con un Suspense unico sparivano per un attimo).
 */

/** Avvolge il pannello di un modulo: l'id è quello del pannello nello store. */
export function DrawerSlot({ id, children }: { id: string; children: ReactNode }) {
  return (
    <DrawerSlotContext.Provider value={id}>
      <Suspense fallback={<DrawerLoading />}>{children}</Suspense>
    </DrawerSlotContext.Provider>
  );
}

/** Segnaposto del pannello mentre il suo codice si carica. */
function DrawerLoading() {
  const { t } = useTranslation();
  return (
    <FieldSheet title={t("fieldSheet.loading")} onClose={() => {}}>
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--ink-3)]">
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]"
        />
        {t("fieldSheet.loading")}
      </div>
    </FieldSheet>
  );
}

