import type { AgroDal } from "../db/dal";
import type { StorageConfig, SyncSnapshot } from "../types";
import { createSyncTarget, type SyncTarget } from "./targets";

/**
 * Router di sincronizzazione ibrido (Sync Engine).
 *
 * Osserva la connettività; quando torna la rete drena `outbox_mutazioni` a
 * batch verso il target deciso da `config_storage.kind` della licenza:
 * il data plane gestito dall'edizione oppure PostgreSQL on-premise (comando Rust +
 * tokio-postgres). I conflitti si risolvono Last-Write-Wins lato server sul
 * timestamp certificato dal client.
 *
 * È deliberatamente isolato dalla UI: comunica solo via `onSnapshot`, quindi
 * un cambio di SDK o di schema remoto può rompere il router ma mai
 * l'operatività offline in field.
 */

const BATCH_SIZE = 200;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface SyncRouterOptions {
  dal: AgroDal;
  storageConfig: StorageConfig;
  onSnapshot?: (snapshot: SyncSnapshot) => void;
  /** Override per i test; di default usa navigator.onLine + eventi window. */
  isOnline?: () => boolean;
}

export class SyncRouter {
  private readonly dal: AgroDal;
  private readonly target: SyncTarget;
  private readonly onSnapshot: (snapshot: SyncSnapshot) => void;
  private readonly isOnline: () => boolean;

  private snapshot: SyncSnapshot;
  private draining = false;
  private stopped = false;
  private retryDelayMs = RETRY_BASE_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private detachListeners: (() => void) | null = null;

  constructor(options: SyncRouterOptions) {
    this.dal = options.dal;
    this.target = createSyncTarget(options.storageConfig, options.dal.tenantId);
    this.onSnapshot = options.onSnapshot ?? (() => {});
    this.isOnline =
      options.isOnline ??
      (() => (typeof navigator === "undefined" ? true : navigator.onLine));
    this.snapshot = {
      state: this.isOnline() ? "online" : "offline",
      pendingCount: 0,
      lastSyncedAt: null,
      lastPulledAt: null,
      lastError: null,
      target: this.target.kind,
    };
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  start(): void {
    const onOnline = () => {
      this.publish({ state: "online" });
      void this.drain();
    };
    const onOffline = () => this.publish({ state: "offline" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    this.detachListeners = () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    void this.refreshPendingCount();
    if (this.isOnline()) void this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.detachListeners?.();
    this.detachListeners = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  /** Da chiamare dopo ogni scrittura del DAL (o per "Forza sincronizzazione"). */
  notifyLocalWrite(): void {
    void this.refreshPendingCount();
    if (this.isOnline()) void this.drain();
  }

  private publish(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onSnapshot(this.snapshot);
  }

  private async refreshPendingCount(): Promise<void> {
    const pendingCount = await this.dal.countPendingMutations();
    this.publish({ pendingCount });
  }

  /**
   * Drena l'outbox a batch finché è vuoto. Rientranza-sicuro: una sola drain
   * alla volta; le scritture arrivate nel frattempo sono prese dal giro dopo.
   */
  async drain(): Promise<void> {
    if (this.draining || this.stopped || !this.isOnline()) return;
    this.draining = true;
    this.publish({ state: "syncing", lastError: null });
    try {
      for (;;) {
        const batch = await this.dal.listPendingMutations(BATCH_SIZE);
        if (batch.length === 0) break;
        const ids = batch.map((m) => m.mutation_id);
        await this.dal.markMutations(ids, "in_flight");
        try {
          await this.target.push(batch);
          await this.dal.markMutations(ids, "synced");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.dal.markMutationsFailed(ids, message);
          throw error;
        }
        await this.refreshPendingCount();
      }
      // Pull DOPO il push: le modifiche locali sono già arrivate al server
      // (LWW), quindi quello che scarichiamo è lo stato consolidato. È anche
      // l'idratazione del primo avvio su un dispositivo nuovo: senza questo
      // passaggio il PGlite locale resterebbe vuoto pur con il cloud popolato.
      if (this.target.pull) {
        await this.target.pull(this.dal);
        this.publish({ lastPulledAt: new Date().toISOString() });
      }
      this.retryDelayMs = RETRY_BASE_MS;
      this.publish({
        state: this.isOnline() ? "online" : "offline",
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ state: "error", lastError: message });
      this.scheduleRetry();
    } finally {
      this.draining = false;
      await this.refreshPendingCount();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, this.retryDelayMs);
    // Backoff esponenziale con tetto: un on-premise irraggiungibile per ore
    // non deve mai bloccare il dispositivo né scaldare la rete.
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
  }
}
