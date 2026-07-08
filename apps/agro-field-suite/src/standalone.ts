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

import {
  LOCAL_COMPANY_DEFAULT,
  localTenantClaims,
  useAgroStore,
} from "@agrogea/core";

/** true nelle build standalone/OSS (`VITE_STANDALONE_MODE=true`). */
export const STANDALONE = import.meta.env.VITE_STANDALONE_MODE === "true";

let bootstrapPromise: Promise<void> | null = null;

/**
 * Avvia la sessione locale standalone: claims sintetiche (licenza attiva,
 * storage `local`), poi garantisce un'azienda di default come tenant attivo.
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

    // Apre l'azienda esistente o crea quella di default. `createCompany` e
    // `switchTenant` impostano da sé `activeCompanyId`, sbloccando la dashboard.
    const companies = useAgroStore.getState().companies;
    const prima = companies.find((a) => a.deleted_at == null) ?? companies[0];
    if (prima) {
      await useAgroStore.getState().switchTenant(prima.id);
    } else {
      await useAgroStore.getState().createCompany(LOCAL_COMPANY_DEFAULT);
    }
  })();
  return bootstrapPromise;
}
