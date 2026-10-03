import { expiryStatus, loadOperatorMemory, useAgroStore } from "@agrogea/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePlotAlerts } from "../../hooks/usePlotAlerts";
import { buildAttentionEntries } from "../machinery/machinery-view";
import {
  buildTaskCompletenessEntries,
  completenessFieldLabel,
} from "../tasks/task-completeness-view";
import { taskOperationLabel } from "../tasks/TaskForm";

/** Categoria di una voce: decide la sezione e l'ordine nel centro. */
export type AttentionGroup =
  | "records"
  | "declarative"
  | "warehouse"
  | "machinery"
  | "soil";

/** Ordine delle sezioni: prima ciò che pesa sulla conformità del registro. */
export const ATTENTION_GROUP_ORDER: readonly AttentionGroup[] = [
  "records",
  "declarative",
  "warehouse",
  "machinery",
  "soil",
];

export interface AttentionItem {
  id: string;
  group: AttentionGroup;
  /** "critical": già scaduto/superato o bloccante; "warning": da fare presto. */
  severity: "critical" | "warning";
  title: string;
  detail: string | null;
  /** Porta dove la voce si risolve (scheda, form, modulo). */
  resolve: () => void;
}

/**
 * Tutto ciò che nell'azienda attiva è da sistemare, in un solo elenco: i dati
 * mancanti per un registro conforme (operazioni del Quaderno e task), i
 * dichiarativi di campagna incompleti, i lotti di magazzino scaduti o in
 * scadenza, le scadenze del parco macchine e i dati del suolo mancanti.
 *
 * Non calcola nulla di nuovo: riusa gli stessi motori dei segnali già sparsi
 * nell'app (triangolo sugli appezzamenti, cruscotto "Record incompleti", badge
 * del Magazzino, "Richiede attenzione" dei mezzi), così il centro e quei
 * segnali dicono sempre la stessa cosa. Le voci spariscono da sole appena il
 * dato viene sistemato.
 */
export function useAttentionItems(): AttentionItem[] {
  const { t, i18n } = useTranslation();
  const plots = useAgroStore((s) => s.plots);
  const plannedTasks = useAgroStore((s) => s.plannedTasks);
  const recipes = useAgroStore((s) => s.recipes);
  const treatments = useAgroStore((s) => s.treatments);
  const products = useAgroStore((s) => s.products);
  const lots = useAgroStore((s) => s.lots);
  const machines = useAgroStore((s) => s.machines);
  const equipment = useAgroStore((s) => s.equipment);
  const maintenanceSchedules = useAgroStore((s) => s.maintenanceSchedules);
  const machineDocuments = useAgroStore((s) => s.machineDocuments);
  const fuelRefills = useAgroStore((s) => s.fuelRefills);
  const plotAlerts = usePlotAlerts();
  const operatorMemory = useMemo(loadOperatorMemory, []);

  return useMemo(() => {
    const store = useAgroStore.getState;
    const plotName = (id: string | null) =>
      (id ? plots.find((p) => p.id === id)?.user_plot_name : null) ??
      t("logbook.common.wholeFarm");
    const day = (iso: string | Date | null) =>
      iso ? new Date(iso).toLocaleDateString(i18n.language) : null;
    const items: AttentionItem[] = [];

    // 1. Record incompleti: operazioni del Quaderno e task programmate.
    const completeness = buildTaskCompletenessEntries({
      plannedTasks,
      recipes,
      treatments,
      operatorName: operatorMemory.name ?? null,
      operatorLicenseNumber: operatorMemory.license ?? null,
    });
    for (const entry of completeness) {
      const kind =
        entry.kind === "treatmentLog"
          ? t("taskCompleteness.panel.kindTreatmentLog")
          : t("taskCompleteness.panel.kindPlannedTask");
      items.push({
        id: `${entry.kind}:${entry.refId}`,
        group: "records",
        severity: "critical",
        // Il prodotto, se c'è, riconosce l'operazione meglio del solo tipo.
        title: [
          (entry.kind === "treatmentLog"
            ? treatments.find((x) => x.id === entry.refId)?.product_name
            : null) ?? taskOperationLabel(t, entry.operationType),
          plotName(entry.plotId),
          day(entry.date),
        ]
          .filter(Boolean)
          .join(" · "),
        detail: `${kind} — ${t("taskCompleteness.panel.missing", {
          fields: entry.missing.map((m) => completenessFieldLabel(t, m.field)).join(", "),
        })}`,
        resolve: () =>
          entry.kind === "treatmentLog"
            ? store().openLogbookOperation(entry.refId)
            : store().openTasksForPlot(entry.plotId),
      });
    }

    // 2–3. Segnali degli appezzamenti: dichiarativi di campagna e suolo.
    for (const alert of plotAlerts) {
      if (alert.gaps.includes("declarative_fields")) {
        items.push({
          id: `declarative:${alert.plotId}`,
          group: "declarative",
          severity: "critical",
          title: plotName(alert.plotId),
          detail: t("plotAlerts.gap.declarative_fields"),
          resolve: () => store().openCropForPlot(alert.plotId),
        });
      }
      if (alert.gaps.includes("soil_texture")) {
        items.push({
          id: `soil:${alert.plotId}`,
          group: "soil",
          severity: "warning",
          title: plotName(alert.plotId),
          detail: t("plotAlerts.gap.soil_texture"),
          resolve: () =>
            void store().selectFeatureOnMap({ kind: "appezzamento", id: alert.plotId }),
        });
      }
    }

    // 4. Lotti di magazzino scaduti o in scadenza (con giacenza).
    for (const lot of lots) {
      if (lot.deleted_at != null || Number(lot.quantity_on_hand) <= 0) continue;
      const status = expiryStatus(lot.expires_at);
      if (status === "valid") continue;
      const product = products.find((p) => p.id === lot.product_id);
      const expired = status === "expired";
      items.push({
        id: `lot:${lot.id}`,
        group: "warehouse",
        severity: expired ? "critical" : "warning",
        title: [product?.name ?? t("attentionCenter.unknownProduct"), lot.lot_number]
          .filter(Boolean)
          .join(" · "),
        detail: expired
          ? t("attentionCenter.lotExpired", { date: day(lot.expires_at) })
          : t("attentionCenter.lotExpiring", { date: day(lot.expires_at) }),
        resolve: () => store().openWarehouseTab("products"),
      });
    }

    // 5. Parco macchine: manutenzioni, documenti, fermi, consumi anomali.
    const machinery = buildAttentionEntries({
      machines,
      equipment,
      schedules: maintenanceSchedules,
      documents: machineDocuments,
      fuelRefills,
    });
    for (const entry of machinery) {
      const critical =
        entry.kind === "maintenance_overdue" ||
        entry.kind === "document_expired" ||
        entry.kind === "machine_down";
      items.push({
        id: `machinery:${entry.kind}:${entry.refId ?? entry.machineId ?? entry.equipmentId}`,
        group: "machinery",
        severity: critical ? "critical" : "warning",
        title: entry.subject,
        detail: t(`machinery.attention.${entry.kind}` as never),
        resolve: () => store().openWarehouseTab("machines"),
      });
    }

    return items;
  }, [
    t,
    i18n.language,
    plots,
    plannedTasks,
    recipes,
    treatments,
    products,
    lots,
    machines,
    equipment,
    maintenanceSchedules,
    machineDocuments,
    fuelRefills,
    plotAlerts,
    operatorMemory,
  ]);
}
