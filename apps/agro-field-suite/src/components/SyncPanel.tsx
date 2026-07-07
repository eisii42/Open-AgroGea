import { type OutboxMutation, useAgroStore } from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button } from "@geolibre/ui";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Coda di sincronizzazione (outbox). Mostra lo stato del sync, l'eventuale
 * errore e la lista delle mutazioni non ancora confermate dal data plane, con
 * possibilità di rimuoverle (singolarmente o in blocco) o di ritentare il push.
 */

const TABELLA_KEY: Record<string, string> = {
  companies: "syncPanel.table.companies",
  crops: "syncPanel.table.crops",
  plots_registry: "syncPanel.table.plotsRegistry",
  plots_campaign: "syncPanel.table.plotsCampaign",
  treatment_logs: "syncPanel.table.treatmentLogs",
  weather_readings: "syncPanel.table.weatherReadings",
  soil_samples: "syncPanel.table.soilSamples",
  infrastructure_assets: "syncPanel.table.infrastructureAssets",
  harvest_logs: "syncPanel.table.harvestLogs",
};

const OP_KEY: Record<string, string> = {
  insert: "syncPanel.operation.insert",
  update: "syncPanel.operation.update",
  delete: "syncPanel.operation.delete",
};

const STATUS_KEY: Record<string, { key: string; color: string }> = {
  pending: { key: "syncPanel.status.pending", color: "var(--warn)" },
  in_flight: { key: "syncPanel.status.inFlight", color: "var(--accent)" },
  error: { key: "syncPanel.status.error", color: "var(--danger)" },
};

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sync = useAgroStore((s) => s.sync);
  const syncRouter = useAgroStore((s) => s.syncRouter);
  const caricaCodaSync = useAgroStore((s) => s.caricaCodaSync);
  const eliminaMutazioneCoda = useAgroStore((s) => s.eliminaMutazioneCoda);
  const svuotaCodaSync = useAgroStore((s) => s.svuotaCodaSync);

  const [coda, setCoda] = useState<OutboxMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const ricarica = useCallback(async () => {
    setLoading(true);
    try {
      setCoda(await caricaCodaSync());
    } finally {
      setLoading(false);
    }
  }, [caricaCodaSync]);

  // Ricarica all'apertura e a ogni cambio del conteggio in coda.
  useEffect(() => {
    void ricarica();
  }, [ricarica, sync.pendingCount]);

  const elimina = async (id: string) => {
    setBusy(true);
    try {
      await eliminaMutazioneCoda(id);
      await ricarica();
    } finally {
      setBusy(false);
    }
  };

  const svuota = async () => {
    setBusy(true);
    try {
      await svuotaCodaSync();
      await ricarica();
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldSheet
      title={t("syncPanel.title")}
      onClose={onClose}
      footer={
        coda.length > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void svuota()}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--r-2)] border border-[#dc2626]/40 px-3 py-2 text-sm font-medium text-[#dc2626] hover:bg-[#dc2626]/10 disabled:opacity-50"
          >
            <Trash2 size={15} /> {t("syncPanel.button.clearQueue", { count: coda.length })}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {/* Stato sync + errore */}
        <div className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {t("syncPanel.state.label", { state: sync.state })}
              {sync.target ? ` · ${sync.target}` : ""}
            </span>
            <Button
              variant="outline"
              className="h-8 px-2"
              onClick={() => void syncRouter?.drain()}
            >
              <RefreshCw size={14} className="mr-1.5" /> {t("syncPanel.button.retry")}
            </Button>
          </div>
          {sync.lastError && (
            <p className="mt-2 flex items-start gap-1.5 rounded-[var(--r-1)] bg-[var(--danger-l)] px-2 py-1.5 text-xs text-[var(--danger)]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span className="break-words">{sync.lastError}</span>
            </p>
          )}
        </div>

        {/* Lista coda */}
        {loading ? (
          <p className="py-6 text-center text-sm text-[var(--ink-3)]">
            {t("syncPanel.loading")}
          </p>
        ) : coda.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ink-3)]">
            {t("syncPanel.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {coda.map((m) => {
              const statusEntry = STATUS_KEY[m.sync_status];
              const statusLabel = statusEntry ? t(statusEntry.key as never) : m.sync_status;
              const statusColor = statusEntry?.color ?? "var(--ink-4)";
              const opLabel = OP_KEY[m.operation] ? t(OP_KEY[m.operation] as never) : m.operation;
              const tableLabel = TABELLA_KEY[m.table_name]
                ? t(TABELLA_KEY[m.table_name] as never)
                : m.table_name;
              return (
                <li
                  key={m.mutation_id}
                  className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: statusColor }}
                    title={statusLabel}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {opLabel} ·{" "}
                      {tableLabel}
                    </p>
                    <p className="truncate text-[11px] text-[var(--ink-3)]">
                      <span style={{ color: statusColor }}>{statusLabel}</span>
                      {m.attempts > 0
                        ? ` · ${t("syncPanel.attempts", { count: m.attempts })}`
                        : ""}
                      {m.last_error ? ` · ${m.last_error}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void elimina(m.mutation_id)}
                    title={t("syncPanel.list.removeFromQueue")}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[#dc2626] hover:bg-[#dc2626]/10 disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FieldSheet>
  );
}
