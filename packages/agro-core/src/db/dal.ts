import { AgroDalLocal } from "./dal-local";
import { getDeviceId } from "./write";
import { openTenantDb } from "./tenant-db";

/**
 * Data Access Layer del data plane locale. È l'unico punto del sistema che
 * scrive su PGlite: ogni mutazione di dominio e la sua voce di outbox sono
 * registrate nella STESSA transazione, quindi non può esistere un dato locale
 * non tracciato per il sync (né una voce di sync senza dato).
 *
 * La UI legge e scrive solo attraverso questa classe — mai il data plane
 * remoto, mai PGlite direttamente (regola architetturale n.1).
 *
 * L'implementazione è stratificata per dominio, dalla base verso l'alto:
 *   - {@link AgroDalBase}     — transazione dato+outbox, pull LWW, coda sync,
 *                               watermark del pull incrementale;
 *   - {@link AgroDalRegistry} — anagrafiche (companies, posti, crops,
 *                               plots, campagne);
 *   - {@link AgroDalLogbook}  — registrazioni di field (Quaderno, harvests,
 *                               soil, scouting, asset);
 *   - {@link AgroDalWarehouse} — Magazzino (products, lots, carichi CUMP,
 *                               issue atomico agganciato alle attività);
 *   - {@link AgroDalLocal}    — moduli local-only (meteo, DSS, bilancio
 *                               idrico, trasferimenti, cataloghi).
 */
export class AgroDal extends AgroDalLocal {
  static async open(tenantId: string): Promise<AgroDal> {
    const db = await openTenantDb(tenantId);
    return new AgroDal(db, tenantId, getDeviceId());
  }
}
