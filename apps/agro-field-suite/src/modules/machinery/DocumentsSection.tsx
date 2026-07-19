import {
  type LotExpiryStatus,
  type MachineDocument,
  type MachineDocumentType,
  useAgroStore,
} from "@agrogea/core";
import { Button, Input, Label, Select, cn } from "@geolibre/ui";
import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateOnly, documentSemaphore } from "./machinery-view";

const DOC_TYPES: MachineDocumentType[] = [
  "inspection",
  "insurance",
  "road_tax",
  "certification",
  "other",
];

const STATUS_STYLE: Record<LotExpiryStatus, string> = {
  valid: "bg-[var(--ok-l)] text-[var(--ok)]",
  expiring: "bg-[var(--warn-l)] text-[var(--warn)]",
  expired: "bg-[var(--danger-l)] text-[var(--danger)]",
};

const STATUS_LABEL_KEY: Record<LotExpiryStatus, string> = {
  valid: "machinery.documents.statusValid",
  expiring: "machinery.documents.statusExpiring",
  expired: "machinery.documents.statusExpired",
};

interface DraftDocument {
  id: string | null;
  type: MachineDocumentType;
  reference: string;
  issuedAt: string;
  expiresAt: string;
  issuer: string;
  amount: string;
  notes: string;
}

const EMPTY_DRAFT: DraftDocument = {
  id: null,
  type: "inspection",
  reference: "",
  issuedAt: "",
  expiresAt: "",
  issuer: "",
  amount: "",
  notes: "",
};

/**
 * Documenti/scadenze del mezzo (§5.4): elenco (dallo store, già filtrato per
 * company) con semaforo di scadenza, e form di creazione/modifica/cancellazione.
 * `machineDocuments` è idratato nello store: nessuna chiamata DAL qui.
 */
export function DocumentsSection({
  kind,
  id,
}: {
  kind: "machine" | "equipment";
  id: string;
}) {
  const { t } = useTranslation();
  const allDocuments = useAgroStore((s) => s.machineDocuments);
  const saveMachineDocument = useAgroStore((s) => s.saveMachineDocument);
  const deleteMachineDocument = useAgroStore((s) => s.deleteMachineDocument);

  const documents = useMemo(
    () =>
      allDocuments
        .filter((d) => (kind === "machine" ? d.machine_id === id : d.equipment_id === id))
        .sort((a, b) => dateOnly(a.expires_at).localeCompare(dateOnly(b.expires_at))),
    [allDocuments, kind, id],
  );

  const [draft, setDraft] = useState<DraftDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
  }

  function startEdit(doc: MachineDocument) {
    setDraft({
      id: doc.id,
      type: doc.type,
      reference: doc.reference ?? "",
      issuedAt: doc.issued_at != null ? dateOnly(doc.issued_at) : "",
      expiresAt: dateOnly(doc.expires_at),
      issuer: doc.issuer ?? "",
      amount: doc.amount != null ? String(doc.amount) : "",
      notes: doc.notes ?? "",
    });
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving || draft.expiresAt.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      await saveMachineDocument({
        id: draft.id ?? undefined,
        machine_id: kind === "machine" ? id : null,
        equipment_id: kind === "equipment" ? id : null,
        type: draft.type,
        reference: draft.reference.trim() || null,
        issued_at: draft.issuedAt || null,
        expires_at: draft.expiresAt,
        issuer: draft.issuer.trim() || null,
        amount: draft.amount.trim() === "" ? null : Number(draft.amount),
        attachment_path: null,
        notes: draft.notes.trim() || null,
      });
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(docId: string) {
    setError(null);
    try {
      await deleteMachineDocument(docId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("machinery.documents.title")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-[36px] px-2 text-xs"
          onClick={startCreate}
        >
          {t("machinery.documents.add")}
        </Button>
      </div>

      {error && (
        <p className="rounded-[var(--r-2)] border border-[var(--danger)] bg-[var(--danger-l)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {draft && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-[var(--r-2)] bg-[var(--panel-2)] p-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-tipo">{t("machinery.documents.type")}</Label>
              <Select
                id="ds-tipo"
                value={draft.type}
                onChange={(e) =>
                  setDraft({ ...draft, type: e.target.value as MachineDocumentType })
                }
              >
                {DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {t(`machinery.docType.${dt}` as never)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-rif">{t("machinery.documents.reference")}</Label>
              <Input
                id="ds-rif"
                value={draft.reference}
                onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                placeholder={t("machinery.documents.referencePlaceholder")}
                className="agro-num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-emesso">{t("machinery.documents.issuedAt")}</Label>
              <Input
                id="ds-emesso"
                type="date"
                value={draft.issuedAt}
                onChange={(e) => setDraft({ ...draft, issuedAt: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-scadenza">{t("machinery.documents.expiresAt")}</Label>
              <Input
                id="ds-scadenza"
                type="date"
                value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-ente">{t("machinery.documents.issuer")}</Label>
              <Input
                id="ds-ente"
                value={draft.issuer}
                onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-importo">{t("machinery.documents.amount")}</Label>
              <Input
                id="ds-importo"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                className="agro-num"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-note">{t("machinery.documents.notes")}</Label>
            <textarea
              id="ds-note"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
              className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
            />
          </div>
          {draft.expiresAt.trim() === "" && (
            <p className="text-[11px] text-[var(--warn)]">
              {t("machinery.documents.expiresAtRequired")}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={saving || draft.expiresAt.trim() === ""}
              className="min-h-[var(--touch-min)] flex-1"
            >
              {saving ? t("logbook.common.saving") : t("machinery.documents.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
              className="min-h-[var(--touch-min)]"
            >
              {t("logbook.common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {documents.length === 0 ? (
        <p className="py-2 text-center text-xs text-[var(--ink-3)]">
          {t("machinery.documents.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {documents.map((doc) => {
            const status = documentSemaphore(doc.expires_at);
            return (
              <li
                key={doc.id}
                className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--line)] p-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {t(`machinery.docType.${doc.type}` as never)}
                    {doc.reference ? (
                      <span className="agro-num truncate font-normal text-[var(--ink-3)]">
                        · {doc.reference}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        STATUS_STYLE[status],
                      )}
                    >
                      {t(STATUS_LABEL_KEY[status] as never)}
                    </span>
                  </span>
                  <span className="block text-[11px] text-[var(--ink-3)]">
                    {t("machinery.documents.expiresAt")}{" "}
                    {new Date(doc.expires_at).toLocaleDateString("it-IT")}
                    {doc.issuer ? ` · ${doc.issuer}` : ""}
                    {doc.amount != null ? ` · ${Number(doc.amount).toFixed(2)} €` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(doc)}
                  aria-label={t("machinery.documents.edit")}
                  title={t("machinery.documents.edit")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(doc.id)}
                  aria-label={t("machinery.documents.delete")}
                  title={t("machinery.documents.delete")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--danger)] hover:bg-[var(--danger-l)]"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
