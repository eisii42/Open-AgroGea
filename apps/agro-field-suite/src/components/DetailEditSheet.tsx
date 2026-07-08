import {
  type InfrastructureAsset,
  type Plot,
  type SoilSample,
  type SelectableKind,
  type SelectedFeatureRef,
  useAgroStore,
} from "@agrogea/core";
import { FieldSheet } from "@agrogea/ui";
import { Button, Input, Label, Select } from "@geolibre/ui";
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useReadOnly } from "@agrogea/core";
import { ComplianceBadges } from "../modules/compliance/ComplianceBadges";
import { SafetyDeleteModal } from "./SafetyDeleteModal";

/**
 * Scheda di dettaglio/editing di un elemento esistente (Modulo 4). Si apre alla
 * selezione sulla mappa, pre-compilata col record del DAL:
 *   * editing alfanumerico → UPDATE su PGlite (preserva i campi non toccati);
 *   * editing spaziale → "Modifica geometria" attiva il trascinamento dei
 *     vertici nell'engine, con area ricalcolata in tempo reale;
 *   * eliminazione → cancellazione protetta (digita il name esatto).
 */

const TIPI_ASSET = [
  "condotta",
  "recinzione",
  "rete-antigrandine",
  "strada",
  "pozzo",
  "trappola",
  "sensore-iot",
  "ingresso",
  "fabbricato",
  "generico",
];

export function DetailEditSheet({
  selected,
}: {
  selected: SelectedFeatureRef;
}) {
  const plots = useAgroStore((s) => s.plots);
  const assets = useAgroStore((s) => s.assets);
  const soilSamples = useAgroStore((s) => s.soilSamples);

  if (selected.kind === "appezzamento") {
    const record = plots.find((a) => a.id === selected.id);
    if (!record) return null;
    return <AppezzamentoEdit record={record} />;
  }
  if (selected.kind === "infrastruttura") {
    const record = assets.find((a) => a.id === selected.id);
    if (!record) return null;
    return <AssetEdit record={record} />;
  }
  const record = soilSamples.find((c) => c.id === selected.id);
  if (!record) return null;
  return <CampionamentoEdit record={record} />;
}

// ---------------------------------------------------------------------------
// Controlli condivisi: editing geometria + zona pericolo (eliminazione)
// ---------------------------------------------------------------------------

/**
 * Avvio/salvataggio/annullo dell'editing spaziale NATIVO di un elemento. Le
 * azioni impostano solo marcatore/richieste nello store: il motore nativo
 * (`startLayerGeometryEdit`/`endLayerGeometryEdit`) e la persistenza sul DAL
 * sono orchestrati da `useFieldPlugins`, l'unico che possiede l'app API mappa.
 */
function useGeomEdit(kind: SelectableKind, id: string) {
  const geomEdit = useAgroStore((s) => s.geomEdit);
  const startGeometryEdit = useAgroStore((s) => s.startGeometryEdit);
  const requestSaveGeometry = useAgroStore((s) => s.requestSaveGeometry);
  const requestCancelGeometry = useAgroStore((s) => s.requestCancelGeometry);
  const openPanels = useAgroStore((s) => s.openPanels);
  const togglePanel = useAgroStore((s) => s.togglePanel);

  const editingThis = geomEdit?.id === id;

  const start = () => {
    // La suite di disegno deve essere attiva perché l'engine carichi la feature.
    if (!openPanels.includes("geoeditor")) togglePanel("geoeditor");
    startGeometryEdit(kind, id);
  };
  const save = () => requestSaveGeometry();
  const cancel = () => requestCancelGeometry();

  return { editingThis, start, save, cancel };
}

function GeometryEditRow({
  ctrl,
  liveAreaLabel,
}: {
  ctrl: ReturnType<typeof useGeomEdit>;
  liveAreaLabel?: string;
}) {
  const { t } = useTranslation();
  if (ctrl.editingThis) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--r-2)] border border-[var(--accent)] bg-[var(--accent-l)] p-2">
        <p className="text-[12px] text-[var(--accent)]">
          {t("detailEditSheet.dragVertices")}
          {liveAreaLabel ? ` ${liveAreaLabel}` : ""}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => void ctrl.cancel()}
          >
            {t("logbook.common.cancel")}
          </Button>
          <Button className="flex-1" onClick={() => void ctrl.save()}>
            {t("detailEditSheet.saveGeometry")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button variant="ghost" className="w-full justify-start" onClick={ctrl.start}>
      <Pencil size={15} className="mr-2" /> {t("detailEditSheet.editGeometry")}
    </Button>
  );
}

function DangerZone({
  kind,
  id,
  elementName,
}: {
  kind: SelectableKind;
  id: string;
  elementName: string;
}) {
  const { t } = useTranslation();
  const deleteElement = useAgroStore((s) => s.deleteElement);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--r-2)] border border-[#dc2626]/40 px-3 py-2 text-sm font-medium text-[#dc2626] hover:bg-[#dc2626]/10"
      >
        <Trash2 size={15} /> {t("detailEditSheet.deleteElement")}
      </button>
      <SafetyDeleteModal
        open={open}
        elementName={elementName}
        onClose={() => setOpen(false)}
        onConfirm={() => deleteElement(kind, id)}
      />
    </>
  );
}

/** Chiusura pulita: annulla un'eventuale sessione di editing geometria attiva. */
function useCloseDetail(id: string) {
  const clearSelectedFeature = useAgroStore((s) => s.clearSelectedFeature);
  const requestCancelGeometry = useAgroStore((s) => s.requestCancelGeometry);
  return () => {
    // Se si sta editando questo elemento, richiedi l'annullamento: l'editing
    // nativo viene closed da useFieldPlugins (sempre montato) anche dopo che la
    // scheda si chiude.
    if (useAgroStore.getState().geomEdit?.id === id) {
      requestCancelGeometry();
    }
    clearSelectedFeature();
  };
}

// ---------------------------------------------------------------------------
// Form per tipo
// ---------------------------------------------------------------------------

function AppezzamentoEdit({ record }: { record: Plot }) {
  const { t } = useTranslation();
  const update = useAgroStore((s) => s.updatePlot);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("appezzamento", record.id);

  const [name, setNome] = useState(record.user_plot_name);
  const [irrigazione, setIrrigazione] = useState(record.irrigation_type ?? "");
  const [soil, setSuolo] = useState<SoilForm>(() =>
    readSoilForm(record.metadata),
  );
  const [saving, setSaving] = useState(false);

  // L'area è ricalcolata dal DAL al salvataggio (editing nativo: niente area
  // "live" durante il trascinamento). Unico punto di verità: area_ha.
  const area = record.area_ha;

  const setSoilField = (field: keyof SoilForm, value: string) =>
    setSuolo((s) => ({ ...s, [field]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await update(record.id, {
        user_plot_name: name.trim() || record.user_plot_name,
        irrigation_type: irrigazione.trim() || null,
        metadata: mergeSoilMetadata(record.metadata, soil),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldSheet
      title={record.user_plot_name || t("detailEditSheet.plot")}
      onClose={close}
      footer={
        <div className="flex flex-col gap-2">
          <Button disabled={saving || readOnly} onClick={() => void submit()}>
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("detailEditSheet.saveChanges")}
          </Button>
          <DangerZone
            kind="appezzamento"
            id={record.id}
            elementName={record.user_plot_name}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Badge geo-compliance (ZVN / aree protette / EUDR) dell'appezzamento. */}
        <ComplianceBadges plot={record} />
        <div>
          <Label>{t("dataEntrySheet.areaGeodetic")}</Label>
          <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
            {area != null ? `${area.toFixed(4)} ha` : "—"}
          </div>
        </div>
        <GeometryEditRow ctrl={ctrl} />
        <div>
          <Label htmlFor="ed-nome">{t("dataEntrySheet.plotName")}</Label>
          <Input
            id="ed-nome"
            value={name}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ed-irrig">{t("dataEntrySheet.irrigationType")}</Label>
          <Input
            id="ed-irrig"
            value={irrigazione}
            onChange={(e) => setIrrigazione(e.target.value)}
          />
        </div>
        <SuoloComposizioneSection soil={soil} onChange={setSoilField} />
      </div>
    </FieldSheet>
  );
}

// ---------------------------------------------------------------------------
// Composizione del soil (inserimento manuale → metadata.soil, Tier 3 del
// SoilDataResolver). La tessitura (classe o percentuali) alimenta Saxton-Rawls.
// ---------------------------------------------------------------------------

interface SoilForm {
  tessitura: string;
  sabbia: string;
  limo: string;
  argilla: string;
  sostanza_organica: string;
  ph: string;
  azoto: string;
  fosforo: string;
  potassio: string;
  frazione_deplezione: string;
}

const SOIL_FORM_EMPTY: SoilForm = {
  tessitura: "",
  sabbia: "",
  limo: "",
  argilla: "",
  sostanza_organica: "",
  ph: "",
  azoto: "",
  fosforo: "",
  potassio: "",
  frazione_deplezione: "",
};

/**
 * Classi tessiturali USDA riconosciute dal resolver. Gli id sono le stringhe
 * originali italiane persistite in `metadata.soil.tessitura` (invariate per
 * compatibilità dati); l'etichetta mostrata viene tradotta a runtime tramite
 * `detailEditSheet.textureClass.<id>` (vedi `textureClassLabel`).
 */
const CLASSI_TESSITURA = [
  "sabbioso",
  "sabbioso franco",
  "franco sabbioso",
  "franco",
  "franco limoso",
  "limoso",
  "franco sabbioso argilloso",
  "franco argilloso",
  "franco limoso argilloso",
  "sabbioso argilloso",
  "limoso argilloso",
  "argilloso",
];

const TEXTURE_CLASS_KEYS: Record<string, string> = {
  sabbioso: "sandy",
  "sabbioso franco": "sandyLoam",
  "franco sabbioso": "loamySand",
  franco: "loam",
  "franco limoso": "siltLoam",
  limoso: "silt",
  "franco sabbioso argilloso": "sandyClayLoam",
  "franco argilloso": "clayLoam",
  "franco limoso argilloso": "siltyClayLoam",
  "sabbioso argilloso": "sandyClay",
  "limoso argilloso": "siltyClay",
  argilloso: "clay",
};

/** Etichetta tradotta della classe tessiturale a partire dall'id persistito. */
function textureClassLabel(t: TFunction, id: string): string {
  const key = TEXTURE_CLASS_KEYS[id];
  return key ? t(`detailEditSheet.textureClass.${key}` as never) : id;
}

const NUMERIC_FIELDS: (keyof SoilForm)[] = [
  "sabbia",
  "limo",
  "argilla",
  "sostanza_organica",
  "ph",
  "azoto",
  "fosforo",
  "potassio",
  "frazione_deplezione",
];

/** Idrata il form dai metadata salvati (`metadata.suolo`). */
function readSoilForm(metadata: Record<string, unknown>): SoilForm {
  const raw = metadata?.suolo;
  if (!raw || typeof raw !== "object") return { ...SOIL_FORM_EMPTY };
  const s = raw as Record<string, unknown>;
  const str = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : typeof v === "string"
        ? v
        : "";
  return {
    tessitura: str(s.tessitura),
    sabbia: str(s.sabbia),
    limo: str(s.limo),
    argilla: str(s.argilla),
    sostanza_organica: str(s.sostanza_organica),
    ph: str(s.ph),
    azoto: str(s.azoto),
    fosforo: str(s.fosforo),
    potassio: str(s.potassio),
    frazione_deplezione: str(s.frazione_deplezione),
  };
}

/** Fonde il form nei metadata: rimuove `suolo` se l'utente ha svuotato tutto. */
function mergeSoilMetadata(
  metadata: Record<string, unknown>,
  form: SoilForm,
): Record<string, unknown> {
  const soil: Record<string, unknown> = {};
  if (form.tessitura.trim()) soil.tessitura = form.tessitura.trim();
  for (const field of NUMERIC_FIELDS) {
    const grezzo = form[field].trim().replace(",", ".");
    if (grezzo === "") continue;
    const n = Number(grezzo);
    if (Number.isFinite(n)) soil[field] = n;
  }
  const next = { ...metadata };
  if (Object.keys(soil).length > 0) next.suolo = soil;
  else delete next.suolo;
  return next;
}

function SuoloNumber({
  id,
  label,
  value,
  onChange,
  step,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SuoloComposizioneSection({
  soil,
  onChange,
}: {
  soil: SoilForm;
  onChange: (field: keyof SoilForm, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--line)] pt-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">
          {t("detailEditSheet.soilComposition")}
        </p>
        <p className="text-[11px] text-[var(--ink-4)]">
          {t("detailEditSheet.soilCompositionHint")}
        </p>
      </div>

      <div>
        <Label htmlFor="ed-soil-tess">{t("detailEditSheet.textureClassLabel")}</Label>
        <Select
          id="ed-soil-tess"
          value={soil.tessitura}
          onChange={(e) => onChange("tessitura", e.target.value)}
        >
          <option value="">{t("detailEditSheet.notSpecified")}</option>
          {CLASSI_TESSITURA.map((c) => (
            <option key={c} value={c}>
              {textureClassLabel(t, c)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SuoloNumber
          id="ed-soil-sabbia"
          label={t("detailEditSheet.sandPercent")}
          value={soil.sabbia}
          onChange={(v) => onChange("sabbia", v)}
        />
        <SuoloNumber
          id="ed-soil-limo"
          label={t("detailEditSheet.siltPercent")}
          value={soil.limo}
          onChange={(v) => onChange("limo", v)}
        />
        <SuoloNumber
          id="ed-soil-argilla"
          label={t("detailEditSheet.clayPercent")}
          value={soil.argilla}
          onChange={(v) => onChange("argilla", v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SuoloNumber
          id="ed-soil-so"
          label={t("detailEditSheet.organicMatterPercent")}
          step="0.1"
          value={soil.sostanza_organica}
          onChange={(v) => onChange("sostanza_organica", v)}
        />
        <SuoloNumber
          id="ed-soil-ph"
          label={t("detailEditSheet.ph")}
          step="0.1"
          value={soil.ph}
          onChange={(v) => onChange("ph", v)}
        />
        <SuoloNumber
          id="ed-soil-n"
          label={t("detailEditSheet.nitrogenMgKg")}
          value={soil.azoto}
          onChange={(v) => onChange("azoto", v)}
        />
        <SuoloNumber
          id="ed-soil-p"
          label={t("detailEditSheet.phosphorusMgKg")}
          value={soil.fosforo}
          onChange={(v) => onChange("fosforo", v)}
        />
        <SuoloNumber
          id="ed-soil-k"
          label={t("detailEditSheet.potassiumMgKg")}
          value={soil.potassio}
          onChange={(v) => onChange("potassio", v)}
        />
      </div>
    </section>
  );
}

function AssetEdit({ record }: { record: InfrastructureAsset }) {
  const { t } = useTranslation();
  const update = useAgroStore((s) => s.updateAsset);
  const activeCompanyId = useAgroStore((s) => s.activeCompanyId);
  const readOnly = useReadOnly(activeCompanyId);
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("infrastruttura", record.id);

  const [name, setNome] = useState(record.name ?? "");
  const [tipo, setTipo] = useState(record.asset_type);
  const [categoria, setCategoria] = useState<"fixed" | "mobile">(
    record.category,
  );
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await update(record.id, {
        name: name.trim() || null,
        asset_type: tipo,
        category: categoria,
      });
    } finally {
      setSaving(false);
    }
  };

  const elementName = record.name || record.asset_type;

  return (
    <FieldSheet
      title={elementName || t("detailEditSheet.infrastructure")}
      onClose={close}
      footer={
        <div className="flex flex-col gap-2">
          <Button disabled={saving || readOnly} onClick={() => void submit()}>
            {readOnly
              ? t("dataEntrySheet.readOnly")
              : saving
                ? t("logbook.common.saving")
                : t("detailEditSheet.saveChanges")}
          </Button>
          <DangerZone
            kind="infrastruttura"
            id={record.id}
            elementName={elementName}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {record.length_m != null && (
          <div>
            <Label>{t("dataEntrySheet.lengthGeodetic")}</Label>
            <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
              {record.length_m} m
            </div>
          </div>
        )}
        <GeometryEditRow ctrl={ctrl} />
        <div>
          <Label htmlFor="ed-as-tipo">{t("dataEntrySheet.assetType")}</Label>
          <Select
            id="ed-as-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {[...new Set([tipo, ...TIPI_ASSET])].map((tipoOpt) => (
              <option key={tipoOpt} value={tipoOpt}>
                {tipoOpt}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ed-as-nome">{t("dataEntrySheet.assetName")}</Label>
          <Input
            id="ed-as-nome"
            value={name}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ed-as-cat">{t("detailEditSheet.operationalStatus")}</Label>
          <Select
            id="ed-as-cat"
            value={categoria}
            onChange={(e) =>
              setCategoria(e.target.value as "fixed" | "mobile")
            }
          >
            <option value="fixed">{t("dataEntrySheet.fixed")}</option>
            <option value="mobile">{t("dataEntrySheet.mobile")}</option>
          </Select>
        </div>
      </div>
    </FieldSheet>
  );
}

function CampionamentoEdit({ record }: { record: SoilSample }) {
  const { t } = useTranslation();
  const close = useCloseDetail(record.id);
  const ctrl = useGeomEdit("poi", record.id);
  const elementName = t("detailEditSheet.samplingName", {
    id: record.id.slice(0, 8),
  });
  const [lon, lat] = record.sampling_position.coordinates;

  return (
    <FieldSheet
      title={elementName}
      onClose={close}
      footer={
        <DangerZone kind="poi" id={record.id} elementName={elementName} />
      }
    >
      <div className="flex flex-col gap-3">
        <GeometryEditRow ctrl={ctrl} />
        <Info label={t("detailEditSheet.sampledOn")} value={fmtDate(record.sampled_at)} />
        <Info label={t("detailEditSheet.ph")} value={record.ph != null ? String(record.ph) : "—"} />
        <Info
          label={t("detailEditSheet.organicMatter")}
          value={
            record.organic_matter != null
              ? `${record.organic_matter}%`
              : "—"
          }
        />
        <Info
          label={t("dataEntrySheet.position")}
          value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`}
        />
      </div>
    </FieldSheet>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="agro-num rounded-[var(--r-2)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--ink-2)]">
        {value}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("it-IT");
  } catch {
    return iso;
  }
}
