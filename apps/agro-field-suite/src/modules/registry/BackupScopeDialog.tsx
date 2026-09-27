import {
  TRANSFER_SECTIONS,
  type TransferPeriod,
  type TransferScope,
  type TransferSection,
} from "@agrogea/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@geolibre/ui";
import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Scelta del PERIMETRO del backup prima di esportarlo: quali blocchi di dati
 * finiscono nel file e a che periodo si riferiscono.
 *
 * Il default è il backup COMPLETO — tutte le sezioni, tutto lo storico: è
 * quello che serve a chi sta mettendo al sicuro l'azienda, e chi vuole un
 * estratto (la campagna scorsa, il solo magazzino) deve poterlo dire, non
 * scoprirlo dopo. Le anagrafiche (appezzamenti, colture, campagne) non sono
 * disattivabili: ogni altra sezione ci si aggancia, e senza il file non
 * sarebbe ripristinabile.
 */

/** Sezione sempre inclusa: è la spina dorsale del documento. */
const BACKBONE: TransferSection = "plots";

function currentYear(): TransferPeriod {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function lastTwelveMonths(): TransferPeriod {
  const today = new Date();
  const from = new Date(today);
  from.setFullYear(today.getFullYear() - 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export function BackupScopeDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (scope: TransferScope) => void;
}) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<TransferSection[]>([
    ...TRANSFER_SECTIONS,
  ]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const period: TransferPeriod | null =
    from || to ? { from: from || null, to: to || null } : null;
  const complete =
    period == null && sections.length === TRANSFER_SECTIONS.length;

  function toggle(section: TransferSection): void {
    if (section === BACKBONE) return;
    setSections((current) =>
      current.includes(section)
        ? current.filter((s) => s !== section)
        : [...current, section],
    );
  }

  function setPeriod(next: TransferPeriod | null): void {
    setFrom(next?.from ?? "");
    setTo(next?.to ?? "");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--accent)]" />
            {t("backupScopeDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {complete
              ? t("backupScopeDialog.completeHint")
              : t("backupScopeDialog.partialHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ---- Periodo di riferimento ---- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("backupScopeDialog.timeRange")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <Preset
                active={period == null}
                label={t("backupScopeDialog.allHistory")}
                onClick={() => setPeriod(null)}
              />
              <Preset
                label={t("backupScopeDialog.currentYear")}
                onClick={() => setPeriod(currentYear())}
              />
              <Preset
                label={t("backupScopeDialog.last12Months")}
                onClick={() => setPeriod(lastTwelveMonths())}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="backup-from">{t("backupScopeDialog.from")}</Label>
                <Input
                  id="backup-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="backup-to">{t("backupScopeDialog.to")}</Label>
                <Input
                  id="backup-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("backupScopeDialog.periodNote")}
            </p>
          </section>

          {/* ---- Contenuto del backup ---- */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("backupScopeDialog.content")}
              </h3>
              <div className="flex gap-1.5">
                <MiniBtn
                  label={t("backupScopeDialog.selectAll")}
                  onClick={() => setSections([...TRANSFER_SECTIONS])}
                />
                <MiniBtn
                  label={t("backupScopeDialog.selectNone")}
                  onClick={() => setSections([BACKBONE])}
                />
              </div>
            </div>
            <ul className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
              {TRANSFER_SECTIONS.map((section) => (
                <li key={section}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-[var(--r-1)] px-1 py-1 text-sm hover:bg-[var(--panel)]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      checked={sections.includes(section)}
                      disabled={section === BACKBONE}
                      onChange={() => toggle(section)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {t(`backupScopeDialog.sections.${section}.label`)}
                        {section === BACKBONE && (
                          <span className="ml-2 text-[11px] font-normal text-[var(--ink-4)]">
                            {t("backupScopeDialog.alwaysIncluded")}
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-[var(--ink-4)]">
                        {t(`backupScopeDialog.sections.${section}.hint`)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex gap-2 border-t border-[var(--line)] pt-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t("logbook.common.cancel")}
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => onConfirm({ sections, period })}
            >
              <Download size={16} />
              {complete
                ? t("backupScopeDialog.exportComplete")
                : t("backupScopeDialog.exportSelection", {
                    count: sections.length,
                  })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Preset({
  label,
  onClick,
  active = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full border border-[var(--accent)] bg-[var(--accent-l)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]"
          : "rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
      }
    >
      {label}
    </button>
  );
}

function MiniBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--r-1)] border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--ink-3)] hover:bg-[var(--panel-2)]"
    >
      {label}
    </button>
  );
}
