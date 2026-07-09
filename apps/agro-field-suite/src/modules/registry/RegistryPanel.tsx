import { type Company, useAgroStore } from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, cn } from "@geolibre/ui";
import {
  Building2,
  FileText,
  type LucideIcon,
  MapPin,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useReadOnly } from "@agrogea/core";
import { STANDALONE } from "../../standalone";
import { CompanyDataIo } from "./CompanyDataIo";

/**
 * Pannello "Anagrafica Company" (scheda dedicata sotto Impostazioni Company).
 * Banner laterale a sezioni per inserire tutti i dati e i codici dell'azienda
 * attiva — identità, codici fiscali/agricoli, sede/contatti, referente. Salva
 * via `updateCompany` → DAL → outbox: stessa logica di sync di ogni altro dato
 * (mutazione accodata, backup in coda, risoluzione LWW).
 */

/** Chiavi testuali dell'azienda modificabili da questa scheda (schema EN `companies`). */
type KeyField =
  | "business_name"
  | "legal_form"
  | "national_company_id"
  | "vat_number"
  | "sdi_code"
  | "pec"
  | "farm_file_id"
  | "paying_agency"
  | "address"
  | "postal_code"
  | "city"
  | "province"
  | "region"
  | "country"
  | "email"
  | "contact_name"
  | "contact_role";

interface Campo {
  key: KeyField;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url" | "textarea";
}

interface Sezione {
  id: string;
  label: string;
  Icon: LucideIcon;
  fields: Campo[];
}

function getSezioni(t: TFunction): Sezione[] {
  return [
    {
      id: "identita",
      label: t("registryPanel.sections.identity.label"),
      Icon: Building2,
      fields: [
        { key: "business_name", label: t("registryPanel.fields.businessName") },
        {
          key: "legal_form",
          label: t("registryPanel.fields.legalForm"),
          placeholder: t("registryPanel.fields.legalFormPlaceholder"),
        },
        {
          key: "national_company_id",
          label: t("registryPanel.fields.nationalCompanyId"),
          placeholder: t("registryPanel.fields.nationalCompanyIdPlaceholder"),
        },
        { key: "vat_number", label: t("registryPanel.fields.vatNumber") },
      ],
    },
    {
      id: "codici",
      label: t("registryPanel.sections.codes.label"),
      Icon: FileText,
      fields: [
        { key: "sdi_code", label: t("registryPanel.fields.sdiCode") },
        { key: "pec", label: t("registryPanel.fields.pec"), type: "email" },
        { key: "farm_file_id", label: t("registryPanel.fields.farmFileId") },
        {
          key: "paying_agency",
          label: t("registryPanel.fields.payingAgency"),
          placeholder: t("registryPanel.fields.payingAgencyPlaceholder"),
        },
      ],
    },
    {
      id: "sede",
      label: t("registryPanel.sections.headquarters.label"),
      Icon: MapPin,
      fields: [
        {
          key: "address",
          label: t("registryPanel.fields.address"),
          placeholder: t("registryPanel.fields.addressPlaceholder"),
        },
        { key: "postal_code", label: t("registryPanel.fields.postalCode") },
        { key: "city", label: t("registryPanel.fields.city") },
        {
          key: "province",
          label: t("registryPanel.fields.province"),
          placeholder: t("registryPanel.fields.provincePlaceholder"),
        },
        { key: "region", label: t("registryPanel.fields.region") },
        {
          key: "country",
          label: t("registryPanel.fields.country"),
          placeholder: t("registryPanel.fields.countryPlaceholder"),
        },
        { key: "email", label: t("registryPanel.fields.email"), type: "email" },
      ],
    },
    {
      id: "referente",
      label: t("registryPanel.sections.contact.label"),
      Icon: UserRound,
      fields: [
        { key: "contact_name", label: t("registryPanel.fields.contactName") },
        {
          key: "contact_role",
          label: t("registryPanel.fields.contactRole"),
          placeholder: t("registryPanel.fields.contactRolePlaceholder"),
        },
      ],
    },
  ];
}

const CHIAVI: KeyField[] = getSezioni(((k: string) => k) as unknown as TFunction).flatMap((s) =>
  s.fields.map((c) => c.key),
);

type FormState = Record<KeyField, string>;

function initialState(company: Company | undefined): FormState {
  const out = {} as FormState;
  for (const k of CHIAVI) {
    const v = company?.[k];
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

export function RegistryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const company = useAgroStore((s) =>
    s.companies.find((a) => a.id === s.activeCompanyId),
  );
  const updateCompany = useAgroStore((s) => s.updateCompany);

  const SEZIONI = getSezioni(t);
  const [sezioneId, setSezioneId] = useState(SEZIONI[0].id);
  const [form, setForm] = useState<FormState>(() => initialState(company));
  const [status, setStatus] = useState<"idle" | "salvo" | "fatto" | "errore">(
    "idle",
  );
  const [erroreMsg, setErroreMsg] = useState<string>();

  // Ricarica i campi quando cambia l'azienda attiva (o arriva dal sync).
  useEffect(() => {
    setForm(initialState(company));
    setStatus("idle");
    // company.updated_at copre sia il cambio company sia l'idratazione da pull.
  }, [activeCompanyId, company?.updated_at]);

  const setField = (key: KeyField, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!company) return;
    setStatus("salvo");
    setErroreMsg(undefined);
    try {
      const patch: Record<string, string | null> = {};
      for (const k of CHIAVI) {
        const v = form[k].trim();
        // business_name è NOT NULL: se svuotato si conserva il value esistente.
        patch[k] =
          k === "business_name" ? v || company.business_name : v || null;
      }
      await updateCompany(patch as unknown as Partial<Company>);
      setStatus("fatto");
    } catch (err) {
      setStatus("errore");
      setErroreMsg(
        err instanceof Error ? err.message : t("registryPanel.saveError"),
      );
    }
  };

  const sezione = SEZIONI.find((s) => s.id === sezioneId) ?? SEZIONI[0];

  return (
    <FieldSheet
      title={t("registryPanel.title")}
      onClose={onClose}
      footer={
        activeCompanyId ? (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            disabled={status === "salvo" || readOnly}
            onClick={() => void save()}
          >
            {readOnly
              ? t("registryPanel.readOnly")
              : status === "salvo"
                ? t("logbook.common.saving")
                : status === "fatto"
                  ? t("registryPanel.saved")
                  : t("registryPanel.save")}
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-[var(--ink-4)]">
        {t("registryPanel.subtitle")}
      </p>

      {!activeCompanyId ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
          {t("registryPanel.selectCompany")}
        </p>
      ) : (
        <>
        <div className="flex gap-2">
          {/* Banner laterale a sezioni */}
          <nav className="flex w-[88px] shrink-0 flex-col gap-1">
            {SEZIONI.map((s) => {
              const active = s.id === sezioneId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSezioneId(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-[var(--r-2)] px-1.5 py-2 text-[11px] font-medium",
                    active
                      ? "bg-[var(--accent-l)] text-[var(--accent)]"
                      : "text-[var(--ink-3)] hover:bg-[var(--panel-2)]",
                  )}
                >
                  <s.Icon size={16} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Campi della sezione attiva */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2">
              {sezione.fields.map((c) => (
                <label key={c.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-xs font-semibold text-[var(--ink-4)]">
                    {c.label}
                  </span>
                  {c.type === "textarea" ? (
                    <textarea
                      value={form[c.key]}
                      onChange={(e) => setField(c.key, e.target.value)}
                      rows={3}
                      placeholder={c.placeholder}
                      className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                    />
                  ) : (
                    <input
                      value={form[c.key]}
                      onChange={(e) => setField(c.key, e.target.value)}
                      type={c.type ?? "text"}
                      placeholder={c.placeholder}
                      className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                    />
                  )}
                </label>
              ))}
            </div>

            {status === "errore" && (
              <div className="mt-2 rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
                {erroreMsg}
              </div>
            )}
          </div>
        </div>
          {/* Trasferimento dati company (cloud): l'edizione standalone lo
              espone invece nel Data Command Center. */}
          {!STANDALONE && (
            <div className="mt-3">
              <CompanyDataIo />
            </div>
          )}
        </>
      )}
    </FieldSheet>
  );
}
