/**
 * Scheda dettaglio di una harvest: modale centrale in sola lettura con TUTTE le
 * informazioni registrate (cultivar, destinazione, quantità, lot, note).
 * Speculare a {@link OperationDetailCard} del Quaderno; si apre al tap/click
 * su una voce della lista del registro harvests.
 */
import type { Harvest } from "@agrogea/core";
import { Trash2, Wheat, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

function dataEstesa(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export function HarvestDetailCard({
  harvest,
  appezzamentoNome,
  onClose,
  onDelete,
}: {
  harvest: Harvest;
  appezzamentoNome: string | null;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const r = harvest;
  const quantita =
    r.quantity_kg != null
      ? `${(r.quantity_kg / 100).toLocaleString("it-IT")} q · ${r.quantity_kg.toLocaleString("it-IT")} kg`
      : null;
  const lot =
    typeof r.metadata?.destinazione_lotto === "string"
      ? r.metadata.destinazione_lotto
      : null;

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
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              <Wheat size={13} /> {t("raccoltaDettaglioCard.harvest")}
            </p>
            <h3 className="truncate text-base font-semibold">
              {r.cultivar ?? t("raccoltaDettaglioCard.harvest")}
            </h3>
            <p className="mt-0.5 text-xs capitalize text-[var(--ink-3)]">
              {dataEstesa(r.harvested_at)}
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
          <Section title={t("raccoltaDettaglioCard.section.cropPlot")}>
            <Row label={t("raccoltaDettaglioCard.field.plot")} value={appezzamentoNome ?? t("raccoltaDettaglioCard.wholeFarm")} />
            <Row label={t("raccoltaDettaglioCard.field.cultivar")} value={r.cultivar} />
          </Section>

          <Section title={t("raccoltaDettaglioCard.section.delivery")}>
            <Row label={t("raccoltaDettaglioCard.field.destination")} value={r.destination_logistics} />
            <Row label={t("raccoltaDettaglioCard.field.lotCode")} value={lot} />
            <Row label={t("raccoltaDettaglioCard.field.quantity")} value={quantita} num />
          </Section>

          {r.notes && (
            <Section title={t("raccoltaDettaglioCard.section.notes")}>
              <p className="whitespace-pre-wrap rounded-[var(--r-2)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-1)]">
                {r.notes}
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
            <Trash2 size={13} /> {t("raccoltaDettaglioCard.delete")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-2)] border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--panel-2)]"
          >
            {t("raccoltaDettaglioCard.close")}
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

/** Riga etichetta/value. Non renderizza nulla se il value è vuoto. */
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
