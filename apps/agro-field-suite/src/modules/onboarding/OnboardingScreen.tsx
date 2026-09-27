import { parseCompanyTransfer, useAgroStore } from "@agrogea/core";
import { ISO_3166_1_ALPHA_2 } from "@agrogea/parcel";
import { Button } from "@geolibre/ui";
import { Download, Loader2, Sprout } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  importCompanyData,
  pickCompanyFile,
} from "../../services/companyDataIo";
import {
  companyInputFromDraft,
  companyInputFromSnapshot,
  emptyCompanyDraft,
  validateCompanyDraft,
  type CompanyDraft,
} from "./onboarding";

/**
 * Primo avvio: due strade dalla stessa schermata, come le vuole la specifica.
 *
 *   * **Nuova azienda** — i dati minimi per cominciare.
 *   * **Importa backup** — si riparte da un file AgroGea, e l'azienda rinasce
 *     con il nome e il paese che aveva.
 *
 * Compare solo quando non esiste alcuna azienda: chi ha già un'installazione
 * non se ne accorge nemmeno. Non c'è un "salta": senza un'azienda non c'è nulla
 * su cui lavorare, e inventarne una — com'è stato finora — significa scegliere
 * il paese al posto dell'utente, cioè scegliere quali fonti di particelle
 * vedrà.
 *
 * Nessun geocoder: il comune è testo libero e serve solo a inquadrare, mai a
 * vincolare. Non si scarica niente qui dentro — chiudere questa schermata deve
 * portare alla mappa, non a una barra di avanzamento.
 */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const createCompany = useAgroStore((s) => s.createCompany);
  const dal = useAgroStore((s) => s.dal);

  const [draft, setDraft] = useState<CompanyDraft>(emptyCompanyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const issues = useMemo(() => validateCompanyDraft(draft), [draft]);
  const issueFor = (field: keyof CompanyDraft) =>
    touched ? issues.find((i) => i.field === field) : undefined;

  function set<K extends keyof CompanyDraft>(field: K, value: CompanyDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function createNew() {
    setTouched(true);
    if (issues.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await createCompany(companyInputFromDraft(draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup() {
    const file = await pickCompanyFile();
    if (!file || !dal) return;
    setBusy(true);
    setError(null);
    try {
      const raw: unknown = JSON.parse(await file.text());
      // Si crea PRIMA l'azienda con l'anagrafica del backup, poi vi si
      // ripristinano dentro i dati: al primo avvio non esiste un'azienda in cui
      // riversarli.
      const snapshot = parseCompanyTransfer(raw);
      const company = await createCompany(
        companyInputFromSnapshot(snapshot, t("onboarding.restoredCompany")),
      );
      // Workspace vuoto: nessun conflitto possibile, quindi nessuna domanda da
      // porre. Il risolutore serve ai ripristini su un'azienda già popolata.
      await importCompanyData(dal, raw, company.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-[var(--bg)] p-4">
      <div className="flex w-full max-w-xl flex-col gap-5 rounded-[var(--r-3)] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--sh-pop)]">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t("onboarding.title")}</h1>
          <p className="text-sm text-[var(--ink-2)]">{t("onboarding.intro")}</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t("onboarding.newCompany")}</h2>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.businessName")}
            </span>
            <input
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              value={draft.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              autoFocus
            />
            {issueFor("businessName") && (
              <span className="text-xs text-[var(--danger,#b00)]">
                {t("onboarding.error.nameRequired")}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.country")}
            </span>
            <select
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              value={draft.country}
              onChange={(e) => set("country", e.target.value)}
            >
              <option value="">{t("onboarding.countryPlaceholder")}</option>
              {ISO_3166_1_ALPHA_2.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {issueFor("country") && (
              <span className="text-xs text-[var(--danger,#b00)]">
                {t("onboarding.error.countryInvalid")}
              </span>
            )}
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.countryHint")}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.city")}
            </span>
            <input
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              value={draft.city}
              onChange={(e) => set("city", e.target.value)}
            />
            {/* Detto esplicitamente, perché è il fraintendimento naturale: la
                sede legale non è dove stanno i campi. */}
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.cityHint")}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-2)]">
              {t("onboarding.vatNumber")}
            </span>
            <input
              className="rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel)] p-2"
              value={draft.vatNumber}
              onChange={(e) => set("vatNumber", e.target.value)}
            />
          </label>

          <Button onClick={() => void createNew()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Sprout size={16} />}
            {t("onboarding.start")}
          </Button>
        </section>

        <div className="flex items-center gap-3 text-xs text-[var(--ink-2)]">
          <span className="h-px flex-1 bg-[var(--line)]" />
          {t("onboarding.or")}
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("onboarding.restore")}</h2>
          <p className="text-xs text-[var(--ink-2)]">
            {t("onboarding.restoreHint")}
          </p>
          <Button
            variant="outline"
            onClick={() => void restoreBackup()}
            disabled={busy}
          >
            <Download size={16} />
            {t("onboarding.pickBackup")}
          </Button>
        </section>

        {error && (
          <p className="rounded-[var(--r-2)] bg-[var(--danger-bg,#fee)] p-2 text-sm text-[var(--danger,#b00)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
