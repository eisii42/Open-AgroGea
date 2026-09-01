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

/*
 * Qui viveva `LOCAL_COMPANY_DEFAULT`, l'azienda "Company locale" con paese `IT`
 * che il primo avvio creava da sola per saltare la schermata iniziale.
 *
 * È stata rimossa, non spostata. Finché l'unica cosa che si poteva fare era
 * disegnare poligoni a mano, quel paese non serviva a nulla e la scorciatoia
 * era innocua. Ora governa quali fonti pubbliche di particelle vengono
 * proposte: sceglierlo al posto dell'utente significa mostrargli il catalogo di
 * un altro paese senza che lo sappia. Il primo avvio lo chiede — vedi
 * `modules/onboarding` nella field suite.
 */
