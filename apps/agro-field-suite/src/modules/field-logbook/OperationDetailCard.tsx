/**
 * Scheda dettaglio di un'operazione del Quaderno di Campagna: modale centrale
 * in sola reading con TUTTE le informazioni registrate (anagrafica treatment,
 * dosi, operatore, sicurezza, note). Si apre al tap/click su una voce della
 * lista del Quaderno. Il layout è a griglia adattiva su più colonne: ogni
 * sezione mostra solo i campi valorizzati e sparisce se non ha nulla da dire.
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

/** Campo della griglia: etichetta + valore, con span opzionale su due colonne. */
interface FieldSpec {
  label: string;
  value: string | number | null | undefined;
  /** Allinea a destra e usa il tabular-numbers per i valori numerici. */
  num?: boolean;
  /** Testo lungo (nome prodotto, note brevi…): occupa entrambe le colonne. */
  wide?: boolean;
}

export function OperationDetailCard({
  operation,
  appezzamentoNome,
  onClose,
  onDelete,
}: {
  operation: TreatmentLog;
  appezzamentoNome: string | null;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const o = operation;
  const dose =
    o.dose_value != null ? `${o.dose_value} ${o.dose_unit ?? ""}`.trim() : null;

  const cropPlot: FieldSpec[] = [
    {
      label: t("operazioneDettaglioCard.field.plot"),
      value: appezzamentoNome ?? t("operazioneDettaglioCard.wholeFarm"),
      wide: true,
    },
  ];

  const productDose: FieldSpec[] = [
    { label: t("operazioneDettaglioCard.field.product"), value: o.product_name, wide: true },
    { label: t("operazioneDettaglioCard.field.activeSubstance"), value: o.active_substance, wide: true },
    { label: t("operazioneDettaglioCard.field.targetDisease"), value: o.target_disease, wide: true },
    { label: t("operazioneDettaglioCard.field.registrationNumber"), value: o.registration_number, num: true },
    { label: t("operazioneDettaglioCard.field.dose"), value: dose, num: true },
    { label: t("operazioneDettaglioCard.field.totalQuantity"), value: o.total_quantity, num: true },
    { label: t("operazioneDettaglioCard.field.waterVolume"), value: o.water_volume_l, num: true },
    { label: t("operazioneDettaglioCard.field.fertilizerType"), value: o.fertilizer_type },
    { label: t("operazioneDettaglioCard.field.npkRatio"), value: o.npk_ratio, num: true },
  ];

  const operator: FieldSpec[] = [
    { label: t("operazioneDettaglioCard.field.operatorName"), value: o.operator_name, wide: true },
    { label: t("operazioneDettaglioCard.field.operatorTaxCode"), value: o.operator_tax_code, num: true },
    { label: t("operazioneDettaglioCard.field.licenseNumber"), value: o.license_number, num: true },
    { label: t("operazioneDettaglioCard.field.machineryEquipment"), value: o.machinery_equipment, wide: true },
  ];

  const safety: FieldSpec[] = [
    { label: t("operazioneDettaglioCard.field.reentryInterval"), value: o.reentry_interval_h, num: true },
    { label: t("operazioneDettaglioCard.field.safetyPeriod"), value: o.safety_period_days, num: true },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--sh-pop)]"
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
          <InfoSection title={t("operazioneDettaglioCard.section.cropPlot")} fields={cropPlot} />
          <InfoSection title={t("operazioneDettaglioCard.section.productDose")} fields={productDose} />
          <InfoSection title={t("operazioneDettaglioCard.section.operator")} fields={operator} />
          <InfoSection title={t("operazioneDettaglioCard.section.safety")} fields={safety} />

          {o.note && (
            <Section title={t("operazioneDettaglioCard.section.notes")}>
              <p className="col-span-2 whitespace-pre-wrap rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-1)]">
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

/** Griglia a due colonne di una sezione. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

/**
 * Sezione data-driven: filtra i campi vuoti e non renderizza nulla se non ne
 * resta alcuno, così la scheda mostra SOLO le informazioni effettivamente
 * inserite, disposte su più colonne.
 */
function InfoSection({ title, fields }: { title: string; fields: FieldSpec[] }) {
  const visible = fields.filter((f) => f.value != null && f.value !== "");
  if (visible.length === 0) return null;
  return (
    <Section title={title}>
      {visible.map((f) => (
        <Field key={f.label} {...f} />
      ))}
    </Section>
  );
}

/** Cella etichetta-sopra / valore-sotto. */
function Field({ label, value, num = false, wide = false }: FieldSpec) {
  return (
    <div className={`flex flex-col gap-0.5${wide ? " col-span-2" : ""}`}>
      <span className="text-[11px] text-[var(--ink-3)]">{label}</span>
      <span
        className={`break-words text-[13px] font-medium text-[var(--ink-1)]${num ? " agro-num" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
