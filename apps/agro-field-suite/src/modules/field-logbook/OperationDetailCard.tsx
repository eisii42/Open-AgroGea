/**
 * Scheda dettaglio di un'operazione del Quaderno di Campagna: modale centrale
 * in sola lettura con TUTTE le informazioni registrate (anagrafica trattamento,
 * dosi, operatore, sicurezza, note). Si apre al tap/click su una voce della
 * lista del Quaderno.
 */
import type { TreatmentLog, OperationType } from "@agrogea/core";
import { Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function opLabel(t: TFunction, tipo: OperationType): string {
  return t(`operazioneDettaglioCard.opLabel.${tipo}`);
}

function dataEstesa(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export function OperazioneDettaglioCard({
  operazione,
  appezzamentoNome,
  onClose,
  onDelete,
}: {
  operazione: TreatmentLog;
  appezzamentoNome: string | null;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const o = operazione;
  const dose =
    o.dose_value != null ? `${o.dose_value} ${o.dose_unit ?? ""}`.trim() : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              {opLabel(t, o.operation_type) ?? o.operation_type}
            </p>
            <h3 className="truncate text-base font-semibold">
              {o.product_name ?? opLabel(t, o.operation_type) ?? t("operazioneDettaglioCard.operation")}
            </h3>
            <p className="mt-0.5 text-xs capitalize text-[var(--ink-3)]">
              {dataEstesa(o.executed_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 hover:bg-[var(--panel-2)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <Section title={t("operazioneDettaglioCard.section.cropPlot")}>
            <Row label={t("operazioneDettaglioCard.field.plot")} value={appezzamentoNome ?? t("operazioneDettaglioCard.wholeFarm")} />
          </Section>

          <Section title={t("operazioneDettaglioCard.section.productDose")}>
            <Row label={t("operazioneDettaglioCard.field.product")} value={o.product_name} />
            <Row label={t("operazioneDettaglioCard.field.activeSubstance")} value={o.active_substance} />
            <Row label={t("operazioneDettaglioCard.field.registrationNumber")} value={o.registration_number} num />
            <Row label={t("operazioneDettaglioCard.field.targetDisease")} value={o.target_disease} />
            <Row label={t("operazioneDettaglioCard.field.dose")} value={dose} num />
            <Row label={t("operazioneDettaglioCard.field.totalQuantity")} value={o.total_quantity} num />
            <Row label={t("operazioneDettaglioCard.field.waterVolume")} value={o.water_volume_l} num />
            <Row label={t("operazioneDettaglioCard.field.fertilizerType")} value={o.fertilizer_type} />
            <Row label={t("operazioneDettaglioCard.field.npkRatio")} value={o.npk_ratio} num />
          </Section>

          <Section title={t("operazioneDettaglioCard.section.operator")}>
            <Row label={t("operazioneDettaglioCard.field.operatorName")} value={o.operator_name} />
            <Row label={t("operazioneDettaglioCard.field.operatorTaxCode")} value={o.operator_tax_code} num />
            <Row label={t("operazioneDettaglioCard.field.licenseNumber")} value={o.license_number} num />
            <Row label={t("operazioneDettaglioCard.field.machineryEquipment")} value={o.machinery_equipment} />
          </Section>

          <Section title={t("operazioneDettaglioCard.section.safety")}>
            <Row label={t("operazioneDettaglioCard.field.reentryInterval")} value={o.reentry_interval_h} num />
            <Row label={t("operazioneDettaglioCard.field.safetyPeriod")} value={o.safety_period_days} num />
          </Section>

          {o.note && (
            <Section title={t("operazioneDettaglioCard.section.notes")}>
              <p className="whitespace-pre-wrap rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-1)]">
                {o.note}
              </p>
            </Section>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-[var(--line)] px-4 py-3">
          <button
            type="button"
            onClick={() => void onDelete()}
            className="flex items-center gap-1.5 rounded-[var(--r-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-l,#fee2e2)]"
          >
            <Trash2 size={13} /> {t("operazioneDettaglioCard.delete")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--panel-2)]"
          >
            {t("operazioneDettaglioCard.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Riga etichetta/valore. Non renderizza nulla se il valore è vuoto. */
function Row({
  label,
  value,
  num = false,
}: {
  label: string;
  value: string | number | null | undefined;
  num?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-[var(--ink-3)]">{label}</span>
      <span
        className={`text-right text-[13px] font-medium text-[var(--ink-1)]${num ? " agro-num" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
