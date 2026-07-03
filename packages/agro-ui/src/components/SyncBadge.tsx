import type { SyncSnapshot } from "@agrogea/core";
import { cn } from "@geolibre/ui";

/**
 * Indicatore compatto dello stato di sincronizzazione, pensato per la top bar
 * della Modalità Campo: pallino di stato + contatore "in coda" tabulare.
 */

const STATE_LABEL: Record<SyncSnapshot["state"], string> = {
  offline: "Offline",
  online: "Sincronizzato",
  syncing: "Sincronizzazione…",
  error: "Errore sync",
};

const STATE_DOT: Record<SyncSnapshot["state"], string> = {
  offline: "bg-[var(--ink-4)]",
  online: "bg-[var(--ok)]",
  syncing: "bg-[var(--accent)] animate-pulse",
  error: "bg-[var(--danger)]",
};

export interface SyncBadgeProps {
  sync: SyncSnapshot;
  onClick?: () => void;
  className?: string;
}

export function SyncBadge({ sync, onClick, className }: SyncBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={sync.lastError ?? STATE_LABEL[sync.state]}
      className={cn(
        "flex min-h-[var(--touch-min)] items-center gap-2 rounded-[var(--r-2)]",
        "border border-[var(--line)] bg-[var(--panel)] px-3 text-sm text-[var(--ink-2)]",
        "active:bg-[var(--panel-2)]",
        className,
      )}
    >
      <span
        className={cn("h-2.5 w-2.5 rounded-full", STATE_DOT[sync.state])}
      />
      <span className="hidden sm:inline">{STATE_LABEL[sync.state]}</span>
      {sync.pendingCount > 0 && (
        <span className="agro-num rounded-full bg-[var(--warn-l)] px-2 py-0.5 text-xs text-[var(--warn)]">
          {sync.pendingCount} in coda
        </span>
      )}
    </button>
  );
}
