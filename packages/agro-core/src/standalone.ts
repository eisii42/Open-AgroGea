/**
 * Edizione standalone / OSS (senza control plane remoto).
 *
 * Fornisce l'identità locale fissa con cui avviare una sessione del tutto
 * offline: nessun login, nessuna licenza remota, nessun tenant cloud. Il
 * `tenantId` è una costante statica (l'app gestisce un'unica company locale per
 * dispositivo) e lo storage è marcato `local`, così il Sync Engine adotta il
 * {@link LocalOnlySyncTarget} e non tocca mai la rete.
 *
 * Questo module NON dipende da alcun control plane: è consumabile sia dall'app
 * di field in modalità standalone sia, in futuro, dalla shell OSS.
 */

import type { NewCompanyInput } from "./store";
import type { TenantClaims } from "./types";

/**
 * Tenant locale fisso dell'edizione standalone. UUID v4 statico e riservato:
 * identifica l'unica istanza PGlite locale del dispositivo. Coincide con l'`id`
 * del profile sintetico ({@link localTenantClaims}).
 */
export const LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Claims sintetiche per la sessione standalone: licenza sempre attiva (nessun
 * gate remoto), storage `local` (Sync Engine no-op). `selfService` resta true
 * per coerenza con l'onboarding (il tenant deriva dall'identità, non da una
 * claim provisionata).
 */
export function localTenantClaims(): TenantClaims {
  return {
    tenantId: LOCAL_TENANT_ID,
    licenseActive: true,
    storageConfig: { kind: "local" },
    modules: [],
    selfService: true,
  };
}

/**
 * Company di default creata al primo avvio standalone, così la dashboard ha un
 * `activeCompanyId` valido (chiave di filtro PGlite dei moduli agronomici)
 * senza passare dalla schermata di selezione workspace.
 */
export const LOCAL_COMPANY_DEFAULT: NewCompanyInput = {
  business_name: "Company locale",
  country: "IT",
};
