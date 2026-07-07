import type { SyncTarget } from "./sync/targets";
import type { UserProfile, UserPreferences } from "./types";

/**
 * Punto di estensione per un eventuale control plane remoto (account, profili,
 * storage gestito). Il core e i componenti condivisi parlano SOLO con questa
 * interfaccia: di default nessun adapter è registrato e ogni hook è assente,
 * quindi l'app resta puramente locale (edizione standalone). Una shell di
 * edizione può registrare le proprie implementazioni all'avvio con
 * {@link registerControlPlane}, senza che il core conosca il backend.
 */
export interface ControlPlaneAdapter {
  /** Profilo/licenza dell'utente dal control plane; `null` se non risolvibile. */
  fetchUserProfile?: () => Promise<UserProfile | null>;
  /** Chiude la sessione remota (logout). La sessione locale è gestita dallo store. */
  signOut?: () => Promise<void>;
  /** Persiste le preferenze d'interfaccia cross-device. */
  updateUserPreferences?: (patch: {
    dashboard_layout_config?: Record<string, boolean>;
    preferences?: UserPreferences;
  }) => Promise<void>;
  /**
   * INSERT dell'azienda sul data plane remoto (percorso che attraversa i
   * vincoli server-side, es. quota di piano). Se assente, la creazione resta
   * solo locale e viaggia con l'outbox.
   */
  insertCompany?: (row: Record<string, unknown>) => Promise<void>;
  /** Target di sync verso il data plane gestito dell'edizione. */
  createSyncTarget?: (tenantId: string) => SyncTarget;
  /**
   * Carica una foto di scouting sullo storage remoto e ritorna l'URL pubblico,
   * o `null` se il caricamento non riesce. Se assente, le osservazioni si
   * salvano senza foto.
   */
  uploadScoutingPhoto?: (path: string, file: File) => Promise<string | null>;
  /** Rimuove una foto di scouting precedentemente caricata, dato il suo URL. */
  removeScoutingPhoto?: (photoUrl: string) => Promise<void>;
}

let adapter: ControlPlaneAdapter = {};

/** Registra l'adapter dell'edizione. Da chiamare una volta, all'avvio della shell. */
export function registerControlPlane(next: ControlPlaneAdapter): void {
  adapter = next;
}

/** Adapter corrente (vuoto se nessuna edizione ne ha registrato uno). */
export function controlPlane(): ControlPlaneAdapter {
  return adapter;
}
