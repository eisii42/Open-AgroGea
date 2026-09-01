/**
 * Edizione standalone dell'app di field (build OSS, solo dati locali).
 *
 * Attivata a build-time dalla flag `VITE_STANDALONE_MODE`. Quando è attiva:
 *   - il router a stadi (App.tsx) salta i gate cloud (login / licenza / tenant)
 *     e avvia direttamente una sessione locale su un'azienda fissa;
 *   - le voci di navigazione proprietarie (SIAN, GeoCompliance, Team, account
 *     & licenza) sono nascoste;
 *   - il Sync Engine usa il target `local` (nessuna push verso il cloud).
 *
 * I moduli agronomici (dss/soil/analytics/vra/crops) NON cambiano: leggono già
 * solo lo store locale filtrato per `activeCompanyId`, che il bootstrap qui
 * sotto popola senza alcuna dipendenza dal control plane.
 */

import { localTenantClaims, useAgroStore } from "@agrogea/core";

/** true nelle build standalone/OSS (`VITE_STANDALONE_MODE=true`). */
export const STANDALONE = import.meta.env.VITE_STANDALONE_MODE === "true";

let bootstrapPromise: Promise<void> | null = null;

/**
 * Avvia la sessione locale standalone: claims sintetiche (licenza attiva,
 * storage `local`) e apertura dell'azienda esistente.
 *
 * **Non crea più un'azienda di default.** Finché l'unica cosa che si poteva
 * fare era disegnare poligoni a mano, inventare una "Company locale" con paese
 * `IT` era un'innocua scorciatoia per saltare una schermata. Ora il paese
 * decide quali fonti di particelle vengono proposte, e sceglierlo al posto
 * dell'utente significa mostrargli il catalogo sbagliato senza che lo sappia.
 * Se non c'è alcuna azienda, `activeCompanyId` resta `null` e il router mostra
 * l'onboarding.
 *
 * Chi ha già un'installazione non se ne accorge: la sua azienda esiste, viene
 * aperta come sempre.
 *
 * Idempotente: una sessione già aperta non viene reinizializzata, e chiamate
 * concorrenti condividono la stessa promise (evita doppi bootstrap in StrictMode).
 */
export function bootstrapStandalone(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const store = useAgroStore.getState();
    // Sessione già attiva (es. re-render): nulla da fare.
    if (store.claims) return;

    await store.startTenantSession(localTenantClaims(), {
      offlineUnlocked: true,
    });

    // `switchTenant` imposta da sé `activeCompanyId`, sbloccando la dashboard.
    const companies = useAgroStore.getState().companies;
    const existing = companies.find((a) => a.deleted_at == null) ?? companies[0];
    if (existing) {
      await useAgroStore.getState().switchTenant(existing.id);
    }
  })();
  return bootstrapPromise;
}
