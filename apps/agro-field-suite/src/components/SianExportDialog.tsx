import {
  colturaPerAppezzamento,
  type TipoOperazione,
  useAgroStore,
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
  Select,
} from "@geolibre/ui";
import { ArrowDown, ArrowUp, FileDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  COLONNE_SIAN,
  COLONNE_SIAN_DEFAULT,
  CONFIG_SIAN_DEFAULT,
  esportaSianCsv,
  filtraTrattamentiSian,
  type SeparatoreCsv,
  type SianExportConfig,
  type SianFiltri,
} from "../lib/sianExport";

/**
 * Dialog di configurazione dell'export SIAN (CSV). Espone TUTTI i filtri
 * (temporali e spaziali) e la struttura del tracciato (colonne ordinate,
 * separatore, intestazioni, BOM), così l'export è adattabile a cambiamenti
 * normativi o richieste particolari senza modifiche al codice. Al conferma:
 * filtra → costruisce → scarica → registra il tag di export nel giornale.
 */

const TIPI_OPERAZIONE: TipoOperazione[] = [
  "phytosanitary",
  "fertilization",
  "irrigation",
  "tillage",
  "sowing",
  "harvest",
  "sampling",
];

function etichettaTipo(t: TFunction, tipo: TipoOperazione): string {
  const map: Record<TipoOperazione, string> = {
    phytosanitary: t("sianExportDialog.operationType.phytosanitary"),
    fertilization: t("sianExportDialog.operationType.fertilization"),
    irrigation: t("sianExportDialog.operationType.irrigation"),
    tillage: t("sianExportDialog.operationType.tillage"),
    sowing: t("sianExportDialog.operationType.sowing"),
    harvest: t("sianExportDialog.operationType.harvest"),
    sampling: t("sianExportDialog.operationType.sampling"),
  };
  return map[tipo];
}

function separatori(t: TFunction): { value: SeparatoreCsv; label: string }[] {
  return [
    { value: ";", label: t("sianExportDialog.separator.semicolon") },
    { value: ",", label: t("sianExportDialog.separator.comma") },
    { value: "\t", label: t("sianExportDialog.separator.tab") },
  ];
}

export function SianExportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trattamenti = useAgroStore((s) => s.trattamenti);
  const appezzamenti = useAgroStore((s) => s.appezzamenti);
  const campiCampagna = useAgroStore((s) => s.campiCampagna);
  const crops = useAgroStore((s) => s.crops);
  const aziende = useAgroStore((s) => s.aziende);
  const aziendaAttivaId = useAgroStore((s) => s.aziendaAttivaId);
  const registraTrasferimento = useAgroStore((s) => s.registraTrasferimento);

  const azienda = aziende.find((a) => a.id === aziendaAttivaId);

  // -- filtri temporali --
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  // -- filtri spaziali --
  const [appIds, setAppIds] = useState<string[]>([]);
  const [colture, setColture] = useState<string[]>([]);
  const [includiSenzaApp, setIncludiSenzaApp] = useState(true);
  // -- filtro operazioni --
  const [tipi, setTipi] = useState<TipoOperazione[]>([]);
  // -- struttura CSV --
  const [colonne, setColonne] = useState<string[]>(COLONNE_SIAN_DEFAULT);
  const [separatore, setSeparatore] = useState<SeparatoreCsv>(";");
  const [intestazioni, setIntestazioni] = useState(true);
  const [bom, setBom] = useState(true);

  const coltureDisponibili = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const a of appezzamenti) {
      const c = colturaPerAppezzamento(a.id, campiCampagna, crops);
      if (c) set.add(c);
    }
    return [...set];
  }, [appezzamenti, campiCampagna, crops]);

  const filtri: SianFiltri = useMemo(
    () => ({
      dal: dal || null,
      al: al || null,
      appezzamentoIds: appIds,
      colture,
      tipiOperazione: tipi,
      includiSenzaAppezzamento: includiSenzaApp,
    }),
    [dal, al, appIds, colture, tipi, includiSenzaApp],
  );

  const righeFiltrate = useMemo(
    () => filtraTrattamentiSian(trattamenti, appezzamenti, filtri),
    [trattamenti, appezzamenti, filtri],
  );

  const colonneNonSelezionate = COLONNE_SIAN.filter(
    (c) => !colonne.includes(c.id),
  );

  function toggleInArray<T>(
    arr: T[],
    value: T,
    set: (next: T[]) => void,
  ): void {
    set(arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
  }

  function spostaColonna(index: number, delta: number): void {
    const next = [...colonne];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setColonne(next);
  }

  function esporta() {
    const config: SianExportConfig = {
      colonne,
      separatore,
      includiIntestazioni: intestazioni,
      bom,
    };
    const nomeFile = esportaSianCsv(
      righeFiltrate,
      appezzamenti,
      azienda?.business_name,
      config,
      campiCampagna,
    );
    void registraTrasferimento({
      operation_type: "export",
      file_format: "csv",
      file_name: nomeFile,
    });
    onClose();
  }

  const labelColonna = (id: string) =>
    COLONNE_SIAN.find((c) => c.id === id)?.label ?? id;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown size={18} className="text-[var(--accent)]" />
            {t("sianExportDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("sianExportDialog.previewIntro")}{" "}
            <strong>{righeFiltrate.length}</strong>{" "}
            {t("sianExportDialog.previewOperations")} ·{" "}
            <strong>{colonne.length}</strong> {t("sianExportDialog.previewColumns")}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ---- Filtri temporali ---- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("sianExportDialog.timeRange")}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="sian-dal">{t("sianExportDialog.from")}</Label>
                <Input
                  id="sian-dal"
                  type="date"
                  value={dal}
                  onChange={(e) => setDal(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="sian-al">{t("sianExportDialog.to")}</Label>
                <Input
                  id="sian-al"
                  type="date"
                  value={al}
                  onChange={(e) => setAl(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <PresetData label={t("sianExportDialog.currentYear")} onClick={() => {
                const y = new Date().getFullYear();
                setDal(`${y}-01-01`);
                setAl(`${y}-12-31`);
              }} />
              <PresetData label={t("sianExportDialog.last12Months")} onClick={() => {
                const oggi = new Date();
                const prima = new Date(oggi);
                prima.setFullYear(oggi.getFullYear() - 1);
                setDal(prima.toISOString().slice(0, 10));
                setAl(oggi.toISOString().slice(0, 10));
              }} />
              <PresetData label={t("sianExportDialog.all")} onClick={() => {
                setDal("");
                setAl("");
              }} />
            </div>
          </section>

          {/* ---- Filtri spaziali ---- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("sianExportDialog.spatialScope")}
            </h3>
            <div>
              <Label>{t("sianExportDialog.plots")} {appIds.length > 0 && `(${appIds.length})`}</Label>
              <div className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
                {appezzamenti.length === 0 ? (
                  <span className="text-xs text-[var(--ink-4)]">
                    {t("sianExportDialog.noPlot")}
                  </span>
                ) : (
                  appezzamenti.map((a) => (
                    <CheckRow
                      key={a.id}
                      checked={appIds.includes(a.id)}
                      onChange={() => toggleInArray(appIds, a.id, setAppIds)}
                      label={`${a.user_plot_name} · ${
                        colturaPerAppezzamento(a.id, campiCampagna, crops) ?? "—"
                      }`}
                    />
                  ))
                )}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink-4)]">
                {t("sianExportDialog.noSelectionAllPlots")}
              </p>
            </div>
            {coltureDisponibili.length > 0 && (
              <div>
                <Label>{t("sianExportDialog.crops")}</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {coltureDisponibili.map((c) => (
                    <Chip
                      key={c}
                      active={colture.includes(c)}
                      onClick={() => toggleInArray(colture, c, setColture)}
                      label={c}
                    />
                  ))}
                </div>
              </div>
            )}
            <CheckRow
              checked={includiSenzaApp}
              onChange={() => setIncludiSenzaApp((v) => !v)}
              label={t("sianExportDialog.includeWholeFarmOps")}
            />
          </section>

          {/* ---- Filtro tipo operazione ---- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("sianExportDialog.operationTypes")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {TIPI_OPERAZIONE.map((tipoOp) => (
                <Chip
                  key={tipoOp}
                  active={tipi.includes(tipoOp)}
                  onClick={() => toggleInArray(tipi, tipoOp, setTipi)}
                  label={etichettaTipo(t, tipoOp)}
                />
              ))}
            </div>
            <p className="text-[11px] text-[var(--ink-4)]">
              {t("sianExportDialog.noSelectionAllTypes")}
            </p>
          </section>

          {/* ---- Struttura colonne ---- */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
                {t("sianExportDialog.csvColumns")}
              </h3>
              <div className="flex gap-1.5">
                <MiniBtn label={t("sianExportDialog.all")} onClick={() => setColonne(COLONNE_SIAN.map((c) => c.id))} />
                <MiniBtn label={t("sianExportDialog.defaults")} onClick={() => setColonne(COLONNE_SIAN_DEFAULT)} />
                <MiniBtn label={t("sianExportDialog.clear")} onClick={() => setColonne([])} />
              </div>
            </div>

            <ul className="flex flex-col gap-1 rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] p-2">
              {colonne.length === 0 ? (
                <li className="px-1 py-2 text-xs text-[var(--ink-4)]">
                  {t("sianExportDialog.noColumnSelected")}
                </li>
              ) : (
                colonne.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-[var(--r-1)] bg-[var(--panel)] px-2 py-1 text-sm"
                  >
                    <span className="w-5 text-right text-[11px] text-[var(--ink-4)]">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate">{labelColonna(id)}</span>
                    <button
                      type="button"
                      title={t("sianExportDialog.moveUp")}
                      disabled={i === 0}
                      onClick={() => spostaColonna(i, -1)}
                      className="text-[var(--ink-3)] disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      title={t("sianExportDialog.moveDown")}
                      disabled={i === colonne.length - 1}
                      onClick={() => spostaColonna(i, 1)}
                      className="text-[var(--ink-3)] disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      title={t("sianExportDialog.remove")}
                      onClick={() => setColonne(colonne.filter((c) => c !== id))}
                      className="text-[var(--danger)]"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))
              )}
            </ul>

            {colonneNonSelezionate.length > 0 && (
              <div>
                <Label htmlFor="sian-add-col">{t("sianExportDialog.addColumn")}</Label>
                <Select
                  id="sian-add-col"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setColonne([...colonne, e.target.value]);
                  }}
                >
                  <option value="">{t("sianExportDialog.chooseField")}</option>
                  {colonneNonSelezionate.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </section>

          {/* ---- Formato file ---- */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
              {t("sianExportDialog.fileFormat")}
            </h3>
            <div>
              <Label htmlFor="sian-sep">{t("sianExportDialog.separatorLabel")}</Label>
              <Select
                id="sian-sep"
                value={separatore}
                onChange={(e) => setSeparatore(e.target.value as SeparatoreCsv)}
              >
                {separatori(t).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <CheckRow
              checked={intestazioni}
              onChange={() => setIntestazioni((v) => !v)}
              label={t("sianExportDialog.includeHeaderRow")}
            />
            <CheckRow
              checked={bom}
              onChange={() => setBom((v) => !v)}
              label={t("sianExportDialog.bomUtf8")}
            />
          </section>

          <div className="flex gap-2 border-t border-[var(--line)] pt-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t("logbook.common.cancel")}
            </Button>
            <Button
              className="flex-1"
              disabled={colonne.length === 0 || righeFiltrate.length === 0}
              onClick={esporta}
            >
              {t("sianExportDialog.exportCsv", { count: righeFiltrate.length })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
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

function PresetData({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--ink-2)] hover:bg-[var(--panel-2)]"
    >
      {label}
    </button>
  );
}
