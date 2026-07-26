import { type FieldOperationSession, type Plot, useAgroStore } from "@agrogea/core";
import { useMemo } from "react";

/**
 * Sessione a bordo campo ATTIVA (IN_PROGRESS o PAUSED) dell'azienda corrente,
 * più il plot su cui insiste — la coppia che decide se montare
 * l'InFieldDashboard (§A: "mounted whenever the store has an active
 * session"). La Modalità Campo ne ammette una sola per azienda (stesso
 * invariante di {@link AgroDalTasks.activeFieldSession}), quindi un filtro
 * client-side su `fieldSessions` (già idratato dallo store) basta: nessun
 * giro DAL aggiuntivo.
 */
export function useActiveFieldSession(): {
  session: FieldOperationSession | null;
  plot: Plot | null;
} {
  const fieldSessions = useAgroStore((s) => s.fieldSessions);
  const plots = useAgroStore((s) => s.plots);

  return useMemo(() => {
    const session =
      fieldSessions.find(
        (f) =>
          f.deleted_at == null &&
          (f.status === "IN_PROGRESS" || f.status === "PAUSED"),
      ) ?? null;
    const plot = session
      ? (plots.find((p) => p.id === session.plot_id) ?? null)
      : null;
    return { session, plot };
  }, [fieldSessions, plots]);
}
