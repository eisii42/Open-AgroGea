import { useAgroStore } from "@agrogea/core";
import { Button } from "@geolibre/ui";
import { Download, Loader2, ShieldAlert, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  downloadCompanyJson,
  exportCompanyData,
  exportFilename,
  importCompanyData,
  pickCompanyFile,
} from "../../services/companyDataIo";
import { STANDALONE } from "../../standalone";

/**
 * Import/Export dei dati aziendali in GeoJSON Esteso. Componente unico, ma con
 * comportamento e copy diversi per edizione:
 *   - Cloud (SaaS): scope vincolato all'azienda attiva; in import i record sono
 *     riassegnati al tenant corrente (data protection cross-azienda).
 *   - Standalone (OSS): backup/restore dell'istanza locale; l'import è un
 *     ripristino che sovrascrive lo stato corrente, previa conferma.
 *
 * Collocazione: Anagrafica/Impostazioni Company (cloud) e Data Command Center
 * (standalone) — vedi punti d'innesto in AnagraficaPanel / CommandCenter.
 */
type Status =
  | { kind: "idle" }
  | { kind: "busy"; op: "export" | "import" }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

export function CompanyDataIo() {
  const { t } = useTranslation();
  const dal = useAgroStore((s) => s.dal);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const company = useAgroStore((s) =>
    s.aziende.find((a) => a.id === s.aziendaAttivaId),
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const exporting = status.kind === "busy" && status.op === "export";
  const importing = status.kind === "busy" && status.op === "import";
  const disabled = !dal || !company || status.kind === "busy";

  async function handleExport() {
    if (!dal || !company) return;
    setStatus({ kind: "busy", op: "export" });
    try {
      const json = await exportCompanyData(dal, company);
      downloadCompanyJson(exportFilename(company), json);
      setStatus({ kind: "ok", msg: t("companyDataIo.exportSuccess") });
    } catch (e) {
      setStatus({
        kind: "error",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleImport() {
    if (!dal || !company || !aziendaAttivaId) return;
    const file = await pickCompanyFile();
    if (!file) return;
    const conferma = STANDALONE
      ? t("companyDataIo.confirmRestoreLocal")
      : t("companyDataIo.confirmImport");
    if (!window.confirm(conferma)) return;
    setStatus({ kind: "busy", op: "import" });
    try {
      const raw = JSON.parse(await file.text());
      const s = await importCompanyData(dal, raw, aziendaAttivaId);
      setStatus({
        kind: "ok",
        msg: t("companyDataIo.importSuccess", {
          crops: s.crops,
          plots: s.plots,
          campaigns: s.campaigns,
          treatments: s.treatments,
          soilSamples: s.soilSamples,
          harvests: s.harvests,
          assets: s.assets,
          scouting: s.scouting,
        }),
      });
    } catch (e) {
      setStatus({
        kind: "error",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <section className="rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <ShieldAlert size={16} className="text-[var(--accent)]" />
        {STANDALONE ? t("companyDataIo.titleStandalone") : t("companyDataIo.titleCloud")}
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-3)]">
        {STANDALONE
          ? t("companyDataIo.descriptionStandalone")
          : t("companyDataIo.descriptionCloud")}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => void handleExport()}
          disabled={disabled}
          className="min-h-[var(--touch-min)] gap-2"
        >
          {exporting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          {t("companyDataIo.exportCompanyData")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleImport()}
          disabled={disabled}
          className="min-h-[var(--touch-min)] gap-2"
        >
          {importing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {t("companyDataIo.importData")}
        </Button>
      </div>

      {status.kind === "ok" && (
        <p className="mt-3 rounded-[var(--r-2)] bg-[var(--ok-l,var(--accent-l))] px-3 py-2 text-sm text-[var(--ok,var(--accent))]">
          {status.msg}
        </p>
      )}
      {status.kind === "error" && (
        <p className="mt-3 rounded-[var(--r-2)] bg-[var(--danger-l)] px-3 py-2 text-sm text-[var(--danger)]">
          {status.msg}
        </p>
      )}
    </section>
  );
}
