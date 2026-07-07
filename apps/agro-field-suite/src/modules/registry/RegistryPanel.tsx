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
 * via `aggiornaAzienda` → DAL → outbox: stessa logica di sync di ogni altro dato
 * (mutazione accodata, backup in coda, risoluzione LWW).
 */

/** Chiavi testuali dell'azienda modificabili da questa scheda (schema EN `companies`). */
type CampoChiave =
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
  key: CampoChiave;
  label: string;
  placeholder?: string;
  tipo?: "text" | "email" | "tel" | "url" | "textarea";
}

interface Sezione {
  id: string;
  label: string;
  Icon: LucideIcon;
  campi: Campo[];
}

function getSezioni(t: TFunction): Sezione[] {
  return [
    {
      id: "identita",
      label: t("anagraficaPanel.sections.identity.label"),
      Icon: Building2,
      campi: [
        { key: "business_name", label: t("anagraficaPanel.fields.businessName") },
        {
          key: "legal_form",
          label: t("anagraficaPanel.fields.legalForm"),
          placeholder: t("anagraficaPanel.fields.legalFormPlaceholder"),
        },
        {
          key: "national_company_id",
          label: t("anagraficaPanel.fields.nationalCompanyId"),
          placeholder: t("anagraficaPanel.fields.nationalCompanyIdPlaceholder"),
        },
        { key: "vat_number", label: t("anagraficaPanel.fields.vatNumber") },
      ],
    },
    {
      id: "codici",
      label: t("anagraficaPanel.sections.codes.label"),
      Icon: FileText,
      campi: [
        { key: "sdi_code", label: t("anagraficaPanel.fields.sdiCode") },
        { key: "pec", label: t("anagraficaPanel.fields.pec"), tipo: "email" },
        { key: "farm_file_id", label: t("anagraficaPanel.fields.farmFileId") },
        {
          key: "paying_agency",
          label: t("anagraficaPanel.fields.payingAgency"),
          placeholder: t("anagraficaPanel.fields.payingAgencyPlaceholder"),
        },
      ],
    },
    {
      id: "sede",
      label: t("anagraficaPanel.sections.headquarters.label"),
      Icon: MapPin,
      campi: [
        {
          key: "address",
          label: t("anagraficaPanel.fields.address"),
          placeholder: t("anagraficaPanel.fields.addressPlaceholder"),
        },
        { key: "postal_code", label: t("anagraficaPanel.fields.postalCode") },
        { key: "city", label: t("anagraficaPanel.fields.city") },
        {
          key: "province",
          label: t("anagraficaPanel.fields.province"),
          placeholder: t("anagraficaPanel.fields.provincePlaceholder"),
        },
        { key: "region", label: t("anagraficaPanel.fields.region") },
        {
          key: "country",
          label: t("anagraficaPanel.fields.country"),
          placeholder: t("anagraficaPanel.fields.countryPlaceholder"),
        },
        { key: "email", label: t("anagraficaPanel.fields.email"), tipo: "email" },
      ],
    },
    {
      id: "referente",
      label: t("anagraficaPanel.sections.contact.label"),
      Icon: UserRound,
      campi: [
        { key: "contact_name", label: t("anagraficaPanel.fields.contactName") },
        {
          key: "contact_role",
          label: t("anagraficaPanel.fields.contactRole"),
          placeholder: t("anagraficaPanel.fields.contactRolePlaceholder"),
        },
      ],
    },
  ];
}

const CHIAVI: CampoChiave[] = getSezioni(((k: string) => k) as unknown as TFunction).flatMap((s) =>
  s.campi.map((c) => c.key),
);

type FormState = Record<CampoChiave, string>;

function statoIniziale(azienda: Company | undefined): FormState {
  const out = {} as FormState;
  for (const k of CHIAVI) {
    const v = azienda?.[k];
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

export function RegistryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const readOnly = useReadOnly(aziendaAttivaId);
  const azienda = useAgroStore((s) =>
    s.aziende.find((a) => a.id === s.aziendaAttivaId),
  );
  const aggiornaAzienda = useAgroStore((s) => s.aggiornaAzienda);

  const SEZIONI = getSezioni(t);
  const [sezioneId, setSezioneId] = useState(SEZIONI[0].id);
  const [form, setForm] = useState<FormState>(() => statoIniziale(azienda));
  const [stato, setStato] = useState<"idle" | "salvo" | "fatto" | "errore">(
    "idle",
  );
  const [erroreMsg, setErroreMsg] = useState<string>();

  // Ricarica i campi quando cambia l'azienda attiva (o arriva dal sync).
  useEffect(() => {
    setForm(statoIniziale(azienda));
    setStato("idle");
    // azienda.updated_at copre sia il cambio azienda sia l'idratazione da pull.
  }, [aziendaAttivaId, azienda?.updated_at]);

  const setCampo = (key: CampoChiave, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const salva = async () => {
    if (!azienda) return;
    setStato("salvo");
    setErroreMsg(undefined);
    try {
      const patch: Record<string, string | null> = {};
      for (const k of CHIAVI) {
        const v = form[k].trim();
        // business_name è NOT NULL: se svuotato si conserva il valore esistente.
        patch[k] =
          k === "business_name" ? v || azienda.business_name : v || null;
      }
      await aggiornaAzienda(patch as unknown as Partial<Company>);
      setStato("fatto");
    } catch (err) {
      setStato("errore");
      setErroreMsg(
        err instanceof Error ? err.message : t("anagraficaPanel.saveError"),
      );
    }
  };

  const sezione = SEZIONI.find((s) => s.id === sezioneId) ?? SEZIONI[0];

  return (
    <FieldSheet
      title={t("anagraficaPanel.title")}
      onClose={onClose}
      footer={
        aziendaAttivaId ? (
          <Button
            className="min-h-[var(--touch-min)] w-full"
            disabled={stato === "salvo" || readOnly}
            onClick={() => void salva()}
          >
            {readOnly
              ? t("anagraficaPanel.readOnly")
              : stato === "salvo"
                ? t("logbook.common.saving")
                : stato === "fatto"
                  ? t("anagraficaPanel.saved")
                  : t("anagraficaPanel.save")}
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-[var(--ink-4)]">
        {t("anagraficaPanel.subtitle")}
      </p>

      {!aziendaAttivaId ? (
        <p className="rounded-[var(--r-2)] bg-[var(--panel-2)] p-2 text-sm text-[var(--ink-3)]">
          {t("anagraficaPanel.selectCompany")}
        </p>
      ) : (
        <>
        <div className="flex gap-2">
          {/* Banner laterale a sezioni */}
          <nav className="flex w-[88px] shrink-0 flex-col gap-1">
            {SEZIONI.map((s) => {
              const attivo = s.id === sezioneId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSezioneId(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-[var(--r-2)] px-1.5 py-2 text-[11px] font-medium",
                    attivo
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
              {sezione.campi.map((c) => (
                <label key={c.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-xs font-semibold text-[var(--ink-4)]">
                    {c.label}
                  </span>
                  {c.tipo === "textarea" ? (
                    <textarea
                      value={form[c.key]}
                      onChange={(e) => setCampo(c.key, e.target.value)}
                      rows={3}
                      placeholder={c.placeholder}
                      className="resize-none rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                    />
                  ) : (
                    <input
                      value={form[c.key]}
                      onChange={(e) => setCampo(c.key, e.target.value)}
                      type={c.tipo ?? "text"}
                      placeholder={c.placeholder}
                      className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
                    />
                  )}
                </label>
              ))}
            </div>

            {stato === "errore" && (
              <div className="mt-2 rounded-[var(--r-2)] bg-[var(--danger-l)] p-2 text-sm text-[var(--danger)]">
                {erroreMsg}
              </div>
            )}
          </div>
        </div>
          {/* Trasferimento dati azienda (cloud): l'edizione standalone lo
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
